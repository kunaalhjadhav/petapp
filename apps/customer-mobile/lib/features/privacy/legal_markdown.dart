import 'package:flutter/material.dart';

import '../../theme.dart';

/// A run of text, bold or not.
class MdRun {
  const MdRun(this.text, {this.bold = false});
  final String text;
  final bool bold;
}

/// A block of a legal document: heading (level 1–3), paragraph (lines), or list (items, each with sub-items).
class MdBlock {
  MdBlock.heading(this.level, List<MdRun> text)
      : kind = 'heading',
        lines = [text],
        items = const [];
  MdBlock.paragraph(this.lines)
      : kind = 'paragraph',
        level = 0,
        items = const [];
  MdBlock.list(this.items)
      : kind = 'list',
        level = 0,
        lines = const [];
  final String kind;
  final int level;
  final List<List<MdRun>> lines;
  final List<MdItem> items;
}

class MdItem {
  MdItem(this.text);
  final List<MdRun> text;
  final List<List<MdRun>> children = [];
}

/// Splits **bold** runs out of a line. An unmatched ** stays as text.
List<MdRun> mdInline(String line) {
  final out = <MdRun>[];
  var last = 0;
  for (final m in RegExp(r'\*\*(.+?)\*\*').allMatches(line)) {
    if (m.start > last) out.add(MdRun(line.substring(last, m.start)));
    out.add(MdRun(m.group(1)!, bold: true));
    last = m.end;
  }
  if (last < line.length) out.add(MdRun(line.substring(last)));
  return out;
}

/// The small Markdown subset legal documents use: #–### headings, paragraphs, "-" lists with one level of nesting, **bold**.
/// Same rules as the admin dashboard's preview, so what staff see is what people read.
List<MdBlock> parseLegalMarkdown(String src) {
  final blocks = <MdBlock>[];
  List<List<MdRun>>? para;
  List<MdItem>? list;
  void close() {
    if (para != null) blocks.add(MdBlock.paragraph(para!));
    if (list != null) blocks.add(MdBlock.list(list!));
    para = null;
    list = null;
  }

  for (final raw in src.replaceAll('\r\n', '\n').split('\n')) {
    final line = raw.trimRight();
    if (line.trim().isEmpty) {
      close();
      continue;
    }
    final h = RegExp(r'^(#{1,3})\s+(.*)$').firstMatch(line);
    if (h != null) {
      close();
      blocks.add(MdBlock.heading(h.group(1)!.length, mdInline(h.group(2)!)));
      continue;
    }
    final item = RegExp(r'^(\s*)[-*]\s+(.*)$').firstMatch(line);
    if (item != null) {
      if (para != null) close();
      list ??= <MdItem>[];
      final nested = item.group(1)!.length >= 2 && list!.isNotEmpty;
      if (nested) {
        list!.last.children.add(mdInline(item.group(2)!));
      } else {
        list!.add(MdItem(mdInline(item.group(2)!)));
      }
      continue;
    }
    if (list != null) close();
    para ??= <List<MdRun>>[];
    para!.add(mdInline(line.trim()));
  }
  close();
  return blocks;
}

/// Renders a legal document. Text is selectable so people can copy parts of it.
class LegalMarkdown extends StatelessWidget {
  const LegalMarkdown(this.source, {super.key});
  final String source;

  TextSpan _span(List<MdRun> runs, TextStyle base) =>
      TextSpan(style: base, children: [for (final r in runs) TextSpan(text: r.text, style: r.bold ? const TextStyle(fontWeight: FontWeight.w700) : null)]);

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final body = (t.bodyMedium ?? const TextStyle()).copyWith(height: 1.5, color: Brand.ink);
    final children = <Widget>[];
    for (final b in parseLegalMarkdown(source)) {
      switch (b.kind) {
        case 'heading':
          final style = (b.level == 1 ? t.headlineSmall : b.level == 2 ? t.titleMedium : t.titleSmall)?.copyWith(fontWeight: FontWeight.w700, color: Brand.ink);
          children.add(Padding(
            padding: EdgeInsets.only(top: b.level == 1 ? 0 : 16, bottom: 6),
            child: Semantics(header: true, child: SelectableText.rich(_span(b.lines.first, style ?? body))),
          ));
        case 'list':
          for (final it in b.items) {
            children.add(_Bullet(depth: 0, child: SelectableText.rich(_span(it.text, body))));
            for (final c in it.children) {
              children.add(_Bullet(depth: 1, child: SelectableText.rich(_span(c, body))));
            }
          }
          children.add(const SizedBox(height: 8));
        default:
          final runs = <MdRun>[];
          for (var i = 0; i < b.lines.length; i++) {
            if (i > 0) runs.add(const MdRun('\n'));
            runs.addAll(b.lines[i]);
          }
          children.add(Padding(padding: const EdgeInsets.only(bottom: 10), child: SelectableText.rich(_span(runs, body))));
      }
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: children);
  }
}

class _Bullet extends StatelessWidget {
  const _Bullet({required this.depth, required this.child});
  final int depth;
  final Widget child;
  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(left: 4.0 + depth * 18, bottom: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(padding: const EdgeInsets.only(top: 1, right: 8), child: Text(depth == 0 ? '•' : '◦', style: const TextStyle(color: Brand.muted))),
          Expanded(child: child),
        ]),
      );
}
