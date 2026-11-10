/**
 * @mentions of pet handles ("@bruno.3fa9c1"). Handles are lower-case letters, numbers and dots.
 * A mention must start the text or follow whitespace/bracket, so emails ("a@b.com") don't count.
 */
export function extractMentions(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(/(^|[\s([{"'“‘])@([a-z0-9][a-z0-9.]{0,40}[a-z0-9])/giu)) {
    out.add(m[2].toLowerCase());
    if (out.size === 10) break;
  }
  return [...out];
}
