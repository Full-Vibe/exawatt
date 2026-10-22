'use client';

import { useState } from 'react';

/** Copies a guide's prompt or command, so the reader pastes it as written. */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // A refused clipboard leaves the text on screen to select by hand.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      onBlur={() => setCopied(false)}
      className="shrink-0 rounded-md border border-white/15 px-2.5 py-1 text-xs font-medium text-white/70 transition-colors hover:border-white/30 hover:text-white"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
