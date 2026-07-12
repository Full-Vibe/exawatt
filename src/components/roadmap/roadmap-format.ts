// No 'use client': pure formatting shared by the roadmap lens components.

/** The checkmark already says landed — drop the redundant text marker from
 *  displayed milestone titles (the roadmap file keeps it, of course). */
export function cleanMilestoneTitle(title: string): string {
  return title.replace(/\s*\((landed|shipped)[^)]*\)\s*$/i, '');
}

/** "1 of 2 done" — words for the label; the compact pill keeps "1/2". */
export function milestoneFractionSentence(done: number, total: number): string {
  return `${done} of ${total} done`;
}

/** `statusNote` is the whole `Status:` line, token included ("active-build —
 *  in flight"). Keep only the prose after the token — a bare token is jargon
 *  the pill already communicates. */
export function statusNoteProse(note: string | null): string | null {
  if (!note) return null;
  const prose = note.replace(/^[\w✅-]+\s*[—:-]*\s*/, '').replace(/[.\s]+$/, '');
  return prose.length > 0 ? prose : null;
}
