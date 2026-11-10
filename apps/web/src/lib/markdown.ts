// A small Markdown reader for legal documents: headings, paragraphs, lists (one level of nesting) and bold.
// It returns plain data, so the page renders it as React elements and no HTML from the text is ever injected.

export type Inline = { text: string; bold?: boolean };
export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: Inline[] }
  | { kind: 'paragraph'; lines: Inline[][] }
  | { kind: 'list'; items: Array<{ text: Inline[]; children: Inline[][] }> };

/** Splits **bold** runs out of a line. An unmatched ** stays as text. */
export function inline(line: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: Inline[][] | null = null;
  let list: Extract<Block, { kind: 'list' }> | null = null;
  const close = () => {
    if (para) blocks.push({ kind: 'paragraph', lines: para });
    if (list) blocks.push(list);
    para = null;
    list = null;
  };
  for (const raw of src.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      close();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      close();
      blocks.push({ kind: 'heading', level: h[1].length as 1 | 2 | 3, text: inline(h[2]) });
      continue;
    }
    const item = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (para) close();
      list ??= { kind: 'list', items: [] };
      const nested = item[1].length >= 2 && list.items.length > 0;
      if (nested) list.items[list.items.length - 1].children.push(inline(item[2]));
      else list.items.push({ text: inline(item[2]), children: [] });
      continue;
    }
    if (list) close();
    para ??= [];
    para.push(inline(line.trim()));
  }
  close();
  return blocks;
}
