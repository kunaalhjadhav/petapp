#!/usr/bin/env python3
"""Python mirror of the apps' Phase 6d Dart tests (models_test, money_test, money_text_test), run against the same
recorded fixtures. A stand-in where no Flutter SDK is available: if an expectation here fails, the Dart test would too.
Usage: python3 scripts/check_money_mirrors.py
"""
import json, pathlib, re, sys
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parents[1]
fails = []

def fx(app, name):
    return json.load(open(ROOT / 'apps' / app / 'test' / 'fixtures' / f'{name}.json'))['data']

def check(name, cond):
    if not cond: fails.append(name)

def label(a):  # PayoutAccount.label / Payout.accountLabel
    return (a.get('vpa') or 'UPI') if a['method'] == 'UPI' else f"Bank •••• {a.get('accountLast4') or '????'}"

def ts(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')) if s else None

# ── money_text.dart (same rules in all three apps) ──
IFSC = re.compile(r'^[A-Z]{4}0[A-Z0-9]{6}$'); ACCOUNT = re.compile(r'^\d{9,18}$'); VPA = re.compile(r'^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$')
clean_ifsc = lambda s: re.sub(r'\s', '', s).upper()
clean_acct = lambda s: re.sub(r'[\s-]', '', s)
ifsc_ok = lambda s: bool(IFSC.match(clean_ifsc(s))); acct_ok = lambda s: bool(ACCOUNT.match(clean_acct(s))); vpa_ok = lambda s: bool(VPA.match(s.strip()))
check('ifsc', ifsc_ok('HDFC0001234') and ifsc_ok(' hdfc 000 1234 ') and clean_ifsc(' hdfc 000 1234 ') == 'HDFC0001234' and not ifsc_ok('HDFC1001234') and not ifsc_ok('HDFC000123') and not ifsc_ok(''))
check('account', acct_ok('50100123456789') and acct_ok('5010 0123 4567 89') and clean_acct('5010-0123 456789') == '50100123456789'
      and not acct_ok('12345678') and not acct_ok('1234567890123456789') and not acct_ok('50100ABC56789'))
check('confirm', clean_acct('5010 0123 456789') == clean_acct('50100123456789') and clean_acct('50100123456789') != clean_acct('50100123456788'))
check('vpa', vpa_ok('meera@okhdfcbank') and vpa_ok('meera.shah-1@ybl') and not vpa_ok('meera') and not vpa_ok('meera@ok1'))
check('holder', len(' M '.strip()) < 2 and len('Meera Shah'.strip()) >= 2)
fallback = lambda k: k[0] + k[1:].lower().replace('_', ' ')
check('kind fallback', fallback('SOMETHING_NEW') == 'Something new')
# The Dart IFSC/account/VPA patterns must be the API's (finance.rules.ts).
rules = (ROOT / 'apps' / 'backend' / 'src' / 'modules' / 'finance' / 'finance.rules.ts').read_text()
for app in ['product-partner-mobile', 'service-partner-mobile', 'customer-mobile']:
    dart = (ROOT / 'apps' / app / 'lib' / 'common' / 'money_text.dart').read_text()
    for name, rx in [('IFSC', IFSC), ('ACCOUNT_NUMBER', ACCOUNT), ('VPA', VPA)]:
        api = re.search(name + r"_PATTERN = /(.+?)/;", rules).group(1)
        check(f'{app}: {name} pattern matches the API', api == rx.pattern and f"r'{rx.pattern}'" in dart)

# ── seller app ──
A = 'product-partner-mobile'
check('seller: no account', fx(A, 'vendor_payout_account_none') == {'active': None, 'pending': None})
refused = fx(A, 'vendor_payout_account_failed')
check('seller: refused', refused['active'] is None and refused['pending']['status'] == 'FAILED' and refused['pending']['failureReason'] and label(refused['pending']) == 'Bank •••• 0000')
ok = fx(A, 'vendor_payout_account_verified')['active']
check('seller: verified', ok['status'] == 'VERIFIED' and label(ok) == 'Bank •••• 6789' and ok['ifsc'] == 'HDFC0001234' and ok['verifiedName'] == 'WAG AND CO PVT LTD' and ok['nameMatches'] is True and ok['payableFrom'])
due, paid = fx(A, 'vendor_payouts_due'), fx(A, 'vendor_payouts')
check('seller: due', due['account'] is None and due['balancePaise'] > 0 and due['payouts'] == [])
p = paid['payouts'][0]
check('seller: paid', paid['balancePaise'] == 0 and paid['balancePaise'] - paid['availablePaise'] == 0 and label(paid['account']) == 'Bank •••• 6789' and len(paid['payouts']) == 1
      and p['status'] == 'PROCESSED' and p['purpose'] == 'EARNINGS' and p['amountPaise'] == due['balancePaise'] and p['utr'].startswith('FAKEUTR') and label(p['account']) == 'Bank •••• 6789')
st = fx(A, 'vendor_statement'); t = st['totals']
sale = next(l for l in st['items'] if l['kind'] == 'PARCEL_DELIVERED'); pay = next(l for l in st['items'] if l['kind'] == 'PAYOUT_APPROVED')
check('seller: statement', st['meta']['page'] >= st['meta']['totalPages'] and t['earnedPaise'] == t['paidOutPaise'] and st['balancePaise'] == t['earnedPaise'] - t['paidOutPaise']
      and sale['salePaise'] - sale['feePaise'] - sale['tcsPaise'] - sale['tdsPaise'] == sale['amountPaise'] and sale['feePaise'] == t['feesPaise']
      and pay['salePaise'] is None and pay['amountPaise'] == -t['paidOutPaise'])
inv = fx(A, 'vendor_invoices')[0]; link = fx(A, 'vendor_invoice_link')
check('seller: invoice', inv['kind'] == 'CUSTOMER' and re.match(r'^[A-Z]{3}I/\d{4}/\d{5}$', inv['number']) and inv['issuer']['name'] == 'Wag and Co Pvt Ltd' and inv['recipient']['name'] == 'Ravi Kumar'
      and link['path'].startswith(f"/invoices/{inv['id']}/file?expires=") and link['fileName'] == inv['number'].replace('/', '-') + '.pdf' and link['expiresAt'])

# ── partner app ──
B = 'service-partner-mobile'
check('partner: none', fx(B, 'payout_account_none')['active'] is None)
upi = fx(B, 'payout_account_verified')['active']
check('partner: upi', upi['method'] == 'UPI' and label(upi) == upi['vpa'] and upi['nameMatches'] is True and not (ts(upi['payableFrom']) > ts(upi['payableFrom'])))
rep = fx(B, 'payout_account_replaced')['active']; hold = fx(B, 'payouts_on_hold')
check('partner: replaced', label(rep) == 'Bank •••• 4567' and ts(rep['payableFrom']) > ts(rep['verifiedAt']) and label(hold['account']) == 'Bank •••• 4567'
      and hold['account']['payableFrom'] == rep['payableFrom'] and len(hold['payouts']) == 1 and label(hold['payouts'][0]['account']) == upi['vpa'])
pst = fx(B, 'statement'); visit = next(l for l in pst['items'] if l['kind'] == 'BOOKING_EARNED')
ppaid = fx(B, 'payouts')['payouts']
check('partner: statement', pst['balancePaise'] == pst['totals']['earnedPaise'] - pst['totals']['paidOutPaise'] and visit['salePaise'] - visit['feePaise'] - visit['tcsPaise'] - visit['tdsPaise'] == visit['amountPaise']
      and visit['tcsPaise'] == 0 and visit['tdsPaise'] > 0 and next(l for l in pst['items'] if l['kind'] == 'PAYOUT_APPROVED')['salePaise'] is None
      and len(ppaid) == 1 and ppaid[0]['amountPaise'] == visit['amountPaise'] and ppaid[0]['status'] == 'PROCESSED')
pinv = fx(B, 'invoices')
check('partner: invoice', len(pinv) == 1 and pinv[0]['title'] == 'BILL_OF_SUPPLY' and pinv[0]['recipient']['name'] == 'Ravi Kumar' and fx(B, 'invoice_link')['path'].startswith(f"/invoices/{pinv[0]['id']}/file?"))

# ── customer app ──
C = 'customer-mobile'
refunds = fx(C, 'me_refunds')
bk = next(r for r in refunds if r['about']['kind'] == 'BOOKING'); od = next(r for r in refunds if r['about']['kind'] == 'ORDER')
check('customer: refunds', len(refunds) == 2 and bk['status'] == 'PROCESSED' and bk['reason'] == 'BOOKING_CANCELLED' and bk['about']['title'].startswith('Full groom') and bk['about']['id']
      and bk['reference'].startswith('fake_rfnd_') and bk['processedAt'] and od['about']['title'].startswith('Order PO-') and od['amountPaise'] <= od['paidPaise'] and od['status'] == 'PROCESSED' and od['reason'] == 'SUB_ORDER_CANCELLED')
cinv = fx(C, 'me_invoices')
check('customer: invoices', [i['title'] for i in cinv] == ['BILL_OF_SUPPLY', 'TAX_INVOICE'] and all(i['recipient']['name'] == 'Ravi Kumar' for i in cinv)
      and fx(C, 'invoice_link')['path'].startswith(f"/invoices/{cinv[0]['id']}/file?expires=") and '&sig=' in fx(C, 'invoice_link')['path'])
none, due, paid = fx(C, 'me_payouts_none'), fx(C, 'me_payouts_due'), fx(C, 'me_payouts')
acct = fx(C, 'me_payout_account_verified')['active']
check('customer: prize flow', none['balancePaise'] == 0 and none['account'] is None and fx(C, 'me_payout_account_none')['active'] is None
      and due['balancePaise'] == 1050000 and due['availablePaise'] == 1050000 and acct['method'] == 'UPI' and acct['nameMatches'] is True and label(due['account']) == acct['vpa']
      and paid['balancePaise'] == 0 and len(paid['payouts']) == 1 and paid['payouts'][0]['purpose'] == 'PRIZE' and paid['payouts'][0]['amountPaise'] == 1050000 and paid['payouts'][0]['status'] == 'PROCESSED')
cst = fx(C, 'me_statement'); prize = next(l for l in cst['items'] if l['kind'] == 'PRIZE_APPROVED')
check('customer: prize statement', prize['salePaise'] == 1500000 and prize['tdsPaise'] == 450000 and prize['amountPaise'] == 1050000 and 'Winner' in prize['memo']
      and cst['totals']['tdsPaise'] == 450000 and cst['totals']['paidOutPaise'] == 1050000)

if fails:
    print('FAILED:', *fails, sep='\n  ')
    sys.exit(1)
print('OK: Phase 6d app tests mirrored against the recorded fixtures')
