#!/usr/bin/env python3
"""Python mirror of the customer app's place test (test/place_test.dart, spec §19), against the same recorded
fixtures, with lib/features/home/place_logic.dart re-implemented line for line. A stand-in where no Flutter SDK
is available. Usage: python3 scripts/check_place_mirrors.py
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / 'apps' / 'customer-mobile'
fx = lambda n: json.load(open(APP / 'test' / 'fixtures' / f'{n}.json'))['data']
src = (APP / 'lib' / 'features' / 'home' / 'place_logic.dart').read_text()
sheet = (APP / 'lib' / 'features' / 'home' / 'place.dart').read_text()
fails = []
def check(name, cond):
    if not cond: fails.append(name)

NEAR = 'Near you'
def place_label(h):
    c = h.get('city')
    return h['label'] if h['kind'] == 'CITY' or c is None or c == h['label'] or h['label'].endswith(f', {c}') else f"{h['label']}, {c}"
def city_of_label(label):
    if label is None or label == NEAR or label.startswith('Near '): return None
    i = label.rfind(', ')
    return label if i < 0 else label[i + 2:]
near_label = lambda area: NEAR if not area else f'Near {area}'
def worth(q):
    t = q.strip()
    return len(t) == 6 if re.fullmatch(r'\d+', t) else len(t) >= 2

for fn in ('placeLabel(', 'cityOfLabel(', 'nearLabel(', 'worthSearching('):
    check(f'place_logic.dart defines {fn}', fn in src)
check('the sheet searches PetApp and the map provider', 'searchPlaces(q)' in sheet and 'worthSearching(v)' in sheet and 'placeLabel(h)' in sheet)
check('the position is named', 'areaAt(at.lat, at.lng)' in sheet)

pin = fx('location_search_pin')['places'][0]
check('pin', pin['kind'] == 'PINCODE' and pin['pincode'] == '400050' and place_label(pin) == 'Bandra West, Mumbai' and city_of_label(place_label(pin)) == 'Mumbai')
area = next(h for h in fx('location_search_area')['places'] if h['kind'] == 'LOCALITY')
check('area', place_label(area) == 'Bandra West, Mumbai' and area['source'] != 'maps')
city = fx('location_search_city')['places'][0]
check('city', place_label(city) == 'Mumbai' and city_of_label('Mumbai') == 'Mumbai')
check('near', near_label(None) == NEAR and near_label('Koregaon Park') == 'Near Koregaon Park' and city_of_label(NEAR) is None and city_of_label('Near Koregaon Park') is None and city_of_label(None) is None)
check('worth', [worth(x) for x in ('b', 'ba', '4000', '400050')] == [False, True, False, True])

if fails:
    print('FAIL:', *fails, sep='\n  '); sys.exit(1)
print('place mirrors: OK')
