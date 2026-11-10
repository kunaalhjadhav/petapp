import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inline, parseMarkdown } from './markdown';

test('bold runs', () => {
  assert.deepEqual(inline('a **b** c'), [
    { text: 'a ' },
    { text: 'b', bold: true },
    { text: ' c' },
  ]);
  assert.deepEqual(inline('no ** close'), [{ text: 'no ** close' }]);
});

test('headings, paragraphs and nested lists', () => {
  const b = parseMarkdown(
    '# Title\n\nFirst line\nsecond line\n\n## Rights\n- **See** data\n  - in the app\n- delete it\nAfter',
  );
  assert.deepEqual(
    b.map((x) => x.kind),
    ['heading', 'paragraph', 'heading', 'list', 'paragraph'],
  );
  assert.deepEqual(b[1], {
    kind: 'paragraph',
    lines: [[{ text: 'First line' }], [{ text: 'second line' }]],
  });
  const list = b[3] as Extract<(typeof b)[number], { kind: 'list' }>;
  assert.equal(list.items.length, 2);
  assert.deepEqual(list.items[0].children, [[{ text: 'in the app' }]]);
});

test('html in the text stays text', () => {
  const b = parseMarkdown('<script>alert(1)</script>');
  assert.deepEqual(b, [{ kind: 'paragraph', lines: [[{ text: '<script>alert(1)</script>' }]] }]);
});
