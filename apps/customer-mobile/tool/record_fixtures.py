#!/usr/bin/env python3
"""Records real API responses into test/fixtures for the Dart tests and contract_check.py.

Needs a running API (SMS_PROVIDER=console, logging to /tmp/api.log), its worker, storage, and
ENABLE_REELS on. Re-run after API changes:  python3 apps/customer-mobile/tool/record_fixtures.py
"""
import json, re, time, subprocess, urllib.request, os
API='http://localhost:4000/api/v1'
import pathlib
APP=pathlib.Path(__file__).resolve().parents[1]
OUT=str(APP/'test'/'fixtures')
FIX=str(APP.parents[1]/'apps'/'backend'/'test'/'fixtures')
API_LOG=os.environ.get('API_LOG','/tmp/api.log')

def call(method, path, body=None, token=None, save=None, expect=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API+path, data=data, method=method)
    req.add_header('Content-Type','application/json')
    if token: req.add_header('Authorization','Bearer '+token)
    try:
        with urllib.request.urlopen(req) as r: status, raw = r.status, r.read()
    except urllib.error.HTTPError as e: status, raw = e.code, e.read()
    j = json.loads(raw)
    if expect and status != expect: raise SystemExit(f'{method} {path} -> {status} {raw[:300]}')
    if save: json.dump(j, open(f'{OUT}/{save}.json','w'), indent=2, ensure_ascii=False)
    return j

def otp(phone):
    for _ in range(40):
        log=open(API_LOG).read()
        m=re.findall(r'DEV SMS → \+91\*+'+phone[-4:]+r'\] (\d{6})', log)
        if m: return m[-1]
        time.sleep(0.25)
    raise SystemExit('no otp for '+phone)

def login(phone, name, save_prefix=None):
    subprocess.run("redis-cli --scan --pattern 'throttle:*' | xargs -r redis-cli del >/dev/null", shell=True)
    call('POST','/auth/otp/request',{'phone':phone[3:]}, save=f'{save_prefix}otp_request' if save_prefix is not None else None, expect=200)
    r=call('POST','/auth/otp/verify',{'phone':phone,'code':otp(phone)}, save=f'{save_prefix}auth_result' if save_prefix is not None else None, expect=200)
    t=r['data']['tokens']['accessToken']
    call('PATCH','/users/me',{'name':name,'city':'Mumbai'},t, save=f'{save_prefix}me' if save_prefix is not None else None, expect=200)
    return t, r['data']['user']['id'], r['data']['tokens']['refreshToken']

def put(url, headers, body):
    req=urllib.request.Request(url, data=body, method='PUT')
    for k,v in headers.items(): req.add_header(k,v)
    with urllib.request.urlopen(req) as r: return r.status

def upload(t, kind, path, mime, prefix=None):
    body=open(path,'rb').read()
    u=call('POST','/media/uploads',{'kind':kind,'mimeType':mime,'sizeBytes':len(body)},t, save=f'{prefix}upload_create' if prefix is not None else None, expect=201)
    put(u['data']['upload']['url'], u['data']['upload']['headers'], body)
    mid=u['data']['media']['id']
    call('POST',f'/media/{mid}/complete',None,t, save=f'{prefix}upload_complete' if prefix is not None else None, expect=200)
    for _ in range(80):
        m=call('GET',f'/media/{mid}',None,t)
        if m['data']['status'] in ('READY','FAILED','REJECTED'): break
        time.sleep(0.25)
    if prefix is not None: json.dump(m, open(f'{OUT}/{prefix}media_ready.json','w'), indent=2)
    return mid

stamp=str(int(time.time()))[-4:]
call('GET','/config/flags', save='flags', expect=200)
a, aid, arefresh = login(f'+91984440{stamp}'[:13], 'Aanya Test', save_prefix='')
b, bid, _ = login(f'+91985550{stamp}'[:13], 'Riya Test')
call('POST','/auth/refresh',{'refreshToken':arefresh}, save='auth_refresh', expect=200)
sp=call('GET','/species', save='species', expect=200)
dog=[s for s in sp['data'] if s['key']=='dog'][0]
br=call('GET',f"/species/{dog['id']}/breeds", save='breeds', expect=200)
pet=call('POST','/pets',{'name':'Bruno','speciesId':dog['id'],'breedId':br['data'][0]['id'],'gender':'MALE','dateOfBirth':'2023-08-14','weightKg':31.5,'about':'Beach walks.','personality':['playful'],'microchipId':'985100001234567'},a, save='pet_create', expect=201)['data']
call('GET','/pets/mine',None,a, save='pets_mine', expect=200)
call('GET',f"/pets/{pet['handle']}",None,b, save='pet_view_public', expect=200)
call('GET',f"/pets/{pet['id']}",None,a, save='pet_view_owner', expect=200)
img=upload(a,'IMAGE',f'{FIX}/photo-gps.jpg','image/jpeg', prefix='image_')
post=call('POST','/posts',{'type':'PHOTO','mediaIds':[img],'caption':'Beach day with @'+pet['handle']+' #beach','petIds':[pet['id']]},a, save='post_create', expect=201)['data']
vid=upload(a,'VIDEO',f'{FIX}/reel-3s.mp4','video/mp4', prefix='video_')
reel=call('POST','/posts',{'type':'REEL','mediaIds':[vid],'caption':'Zoomies #zoomies'},a, save='reel_create', expect=201)['data']
call('POST',f"/users/{aid}/follow",None,b, save='follow', expect=200)
call('POST',f"/pets/{pet['id']}/follow",None,b, save='pet_follow', expect=200)
call('POST',f"/posts/{post['id']}/like",None,b, save='like', expect=200)
call('POST',f"/posts/{post['id']}/save",None,b, save='save', expect=200)
call('POST',f"/posts/{post['id']}/share",{'channel':'whatsapp'},b, save='share', expect=200)
call('POST',f"/posts/{post['id']}/view",None,b, save='view', expect=200)
c=call('POST',f"/posts/{post['id']}/comments",{'body':'So cute!'},b, save='comment_create', expect=201)['data']
call('POST',f"/posts/{post['id']}/comments",{'body':'Thank you!','parentId':c['id']},a, expect=201)
call('GET',f"/posts/{post['id']}/comments?limit=20",None,b, save='comments', expect=200)
call('GET',f"/comments/{c['id']}/replies",None,b, save='replies', expect=200)
call('GET',f"/posts/{post['id']}",None,b, save='post_get', expect=200)
call('GET','/feed?limit=10',None,b, save='feed', expect=200)
call('GET','/feed/trending?limit=10',None,b, save='trending', expect=200)
call('GET','/feed/trending?limit=10&kind=reels',None,b, save='reels', expect=200)
call('GET','/hashtags/beach/posts',None,b, save='hashtag_posts', expect=200)
call('GET','/hashtags/trending',None,b, save='hashtags_trending', expect=200)
call('GET',f"/users/{aid}/posts",None,b, save='user_posts', expect=200)
call('GET',f"/pets/{pet['id']}/posts",None,b, save='pet_posts', expect=200)
call('GET','/users/me/saved',None,b, save='saved', expect=200)
call('GET',f"/users/{aid}",None,b, save='user_profile', expect=200)
call('PUT','/notifications/preferences',{'mentions':True},a, save='notification_prefs', expect=200)
call('POST','/devices',{'token':'fixture-device-token-0000000000','platform':'ANDROID','appVersion':'1.0.0'},a, save='device_register', expect=200)
time.sleep(2.5)
call('GET','/notifications?limit=20',None,a, save='notifications', expect=200)
call('GET','/notifications/unread-count',None,a, save='notifications_unread', expect=200)
call('POST','/notifications/read',{},a, save='notifications_read', expect=200)
cc=call('POST',f"/posts/{post['id']}/comments",{'body':'spam spam'},b, expect=201)['data']
call('POST','/reports',{'targetType':'COMMENT','targetId':cc['id'],'reason':'SPAM'},a, save='report', expect=201)
call('POST',f"/users/{bid}/block",None,a, save='block', expect=200)
call('GET','/users/me/blocks',None,a, save='blocks', expect=200)
call('DELETE',f"/users/{bid}/block",None,a, expect=200)
call('POST','/pets',{'name':''},a, save='error_validation', expect=400)
call('GET','/users/me',None,'not-a-token', save='error_unauthorized', expect=401)
print('fixtures:', len(os.listdir(OUT)))
