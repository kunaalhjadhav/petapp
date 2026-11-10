"""Shared helpers for the fixture recorders: talk to a running API the way the app does."""
import json, os, pathlib, re, subprocess, time, urllib.error, urllib.request

APP = pathlib.Path(__file__).resolve().parents[1]
OUT = APP / 'test' / 'fixtures'
API = os.environ.get('API_URL', 'http://localhost:4000') + '/api/v1'
LOG = os.environ.get('API_LOG', '/tmp/api.log')

def call(method, path, body=None, token=None, save=None, expect=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req) as r: status, raw = r.status, r.read()
    except urllib.error.HTTPError as e: status, raw = e.code, e.read()
    j = json.loads(raw)
    if expect and status != expect: raise SystemExit(f'{method} {path} -> {status} {raw[:500]}')
    if save: (OUT / f'{save}.json').write_text(json.dumps(j, indent=2, ensure_ascii=False))
    return j['data'] if isinstance(j, dict) and 'data' in j else j

def unthrottle():
    subprocess.run("redis-cli --scan --pattern 'throttle:*' | xargs -r redis-cli del >/dev/null", shell=True)

def login(phone, name):
    unthrottle()
    call('POST', '/auth/otp/request', {'phone': phone}, expect=200)
    for _ in range(40):
        m = re.findall(r'DEV SMS → \+91\*+' + phone[-4:] + r'\] (\d{6})', open(LOG).read())
        if m: break
        time.sleep(0.25)
    d = call('POST', '/auth/otp/verify', {'phone': phone, 'code': m[-1]}, expect=200)
    t = d['tokens']['accessToken']
    call('PATCH', '/users/me', {'name': name}, t, expect=200)
    return t

def admin_token():
    unthrottle()
    return call('POST', '/admin/auth/login', {'email': os.environ.get('SEED_ADMIN_EMAIL', 'admin@petapp.local'),
                'password': os.environ.get('SEED_ADMIN_PASSWORD', 'ChangeMe-Admin-2026')}, expect=200)['tokens']['accessToken']

def flag(admin, key):
    call('PATCH', f'/admin/flags/{key}', {'enabled': True}, admin, expect=200)
    subprocess.run('redis-cli del platform:flags >/dev/null', shell=True)

def put_bytes(url, headers, body):
    req = urllib.request.Request(url, data=body, method='PUT')
    for k, v in headers.items(): req.add_header(k, v)
    with urllib.request.urlopen(req) as r: return r.status
