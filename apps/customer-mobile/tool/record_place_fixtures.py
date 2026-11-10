#!/usr/bin/env python3
"""Records real place-search responses (spec §19, final release) for the customer app: a PIN code, an area and a
city from the seeded location database. With MAP_PROVIDER=none locally, no map answers are recorded; the model's
map-only keys are optional in tool/contract_check.py.

Needs: API running with the seeded location database (Mumbai's Bandra West, 400050).
Run:  python3 apps/customer-mobile/tool/record_place_fixtures.py
"""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixture_api import call, unthrottle  # noqa: E402

unthrottle()
pin = call('GET', '/locations/search?q=400050', save='location_search_pin', expect=200)
assert pin['places'][0]['kind'] == 'PINCODE', pin
area = call('GET', '/locations/search?q=bandra', save='location_search_area', expect=200)
assert any(p['kind'] == 'LOCALITY' for p in area['places']), area
city = call('GET', '/locations/search?q=mumb', save='location_search_city', expect=200)
assert city['places'][0]['kind'] == 'CITY', city
r = call('GET', '/locations/resolve?lat=19.0596&lng=72.8295', save='location_resolve', expect=200)
print('recorded place search:', pin['places'][0]['label'], '|', area['places'][0]['label'], '|', city['places'][0]['label'], '| resolve:', (r.get('locality') or {}).get('name'))
