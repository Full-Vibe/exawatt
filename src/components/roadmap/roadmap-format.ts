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

/** "2nd", "11th", "23rd": a queue place as the operator says it. */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "just now", "4m ago", "3h ago", "2d ago". */
export function relativeTime(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
