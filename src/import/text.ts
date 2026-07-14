/**
 * Split a pasted memory list into one fact per line. This is the shape you get
 * copying out of ChatGPT's "Manage memories" panel, claude.ai's memory summary,
 * or any hand-kept notes file: one fact per line, maybe bulleted or numbered.
 * Headings and separators are dropped; bullets and numbering are stripped.
 */
export function parseFactLines(raw: string): string[] {
  const facts: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line
      .replace(/^\s*(?:[-*•‣▪]|\d{1,3}[.)])\s+/, '')
      .trim();
    if (!text) continue;
    if (/^#{1,6}\s/.test(text)) continue; // markdown heading
    if (/^[-=_*\s]+$/.test(text)) continue; // separator line
    facts.push(text);
  }
  return facts;
}
