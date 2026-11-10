import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changeText,
  formatMetric,
  isTab,
  istToday,
  niceMax,
  presetRange,
  reportCsv,
} from './analytics';

test('formats figures', () => {
  assert.equal(formatMetric(1234567, 'count'), '12,34,567');
  assert.equal(formatMetric(1490000, 'paise'), '₹14,900');
  assert.equal(formatMetric(12.5, 'pct'), '12.5%');
  assert.equal(formatMetric(50, 'pct'), '50%');
  assert.equal(formatMetric(null, 'pct'), '–');
});
test('compares with the previous period', () => {
  assert.deepEqual(changeText(150, 100, 'count'), { text: '+50%', up: true });
  assert.deepEqual(changeText(90, 100, 'paise'), { text: '−10%', up: false });
  assert.equal(changeText(5, 0, 'count'), null);
  assert.deepEqual(changeText(40, 32.5, 'pct'), { text: '+7.5 pts', up: true });
  assert.equal(changeText(null, 3, 'count'), null);
});
test('picks ranges and axes', () => {
  assert.deepEqual(presetRange(7, '2026-10-20'), { from: '2026-10-14', to: '2026-10-20' });
  assert.equal(istToday(new Date('2026-10-20T19:00:00Z')), '2026-10-21');
  assert.deepEqual(
    [niceMax(0), niceMax(3), niceMax(7), niceMax(120), niceMax(1000)],
    [1, 5, 10, 200, 1000],
  );
  assert.equal(isTab('users') && !isTab('nope') && !isTab(undefined), true);
});
test('exports a report safely', () => {
  const csv = reportCsv({
    tab: 'reels',
    from: '2026-10-01',
    to: '2026-10-02',
    days: 2,
    generatedAt: '',
    kpis: [{ key: 'gmv', label: 'Gross sales', value: 12345, previous: null, format: 'paise' }],
    series: [
      { key: 'v', label: 'Views', format: 'count', points: [{ day: '2026-10-01', value: 3 }] },
    ],
    tables: [
      {
        key: 't',
        label: 'Top',
        columns: [
          { key: 'caption', label: 'Reel', format: 'text' },
          { key: 'rate', label: 'Done', format: 'pct' },
        ],
        rows: [{ caption: '=HYPERLINK("x")', rate: 50 }],
      },
    ],
    notes: [],
  });
  assert.ok(csv.includes('"Gross sales (Rs)","123.45",""'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")","50"`));
  assert.ok(csv.includes('"2026-10-01","3"'));
});
