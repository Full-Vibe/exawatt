/**
 * A hand-rolled request generation is a defect waiting for its fifth report.
 *
 * BUG-118, BUG-119, BUG-120 and BUG-121 were one stale-async defect fixed
 * four times with four local counters. `useLatestRequest` is the one owner
 * now. This test is the ratchet: every remaining hand-rolled site is listed
 * below with its count, a NEW one fails the suite with the fix named, and
 * removing one requires shrinking the list so the ratchet only turns one way.
 *
 * Two shapes are matched, because they are the two the four bugs wore:
 *
 *   const xSeq = useRef(0)            // a generation counter, by name
 *   let cancelled = false             // an effect's hand-rolled ticket
 *
 * Progress refs and animation state (`const progress = useRef(0)`) are not
 * request generations and are not matched.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..');

/**
 * Sites that predate the primitive and have not been migrated yet. Remove a
 * line when you migrate it; never add one.
 */
const REMAINING_GENERATION_REFS: Record<string, number> = {
  'app/settings/connected-sources-section.tsx': 2,
  // Owned by the connected-source rescue (2026-09-23); migrate with it.
  'components/workspace/remote-agent/use-remote-coworkers.ts': 1,
  'components/workspace/launcher/use-composer-clipboard.ts': 1,
  'components/workspace/launcher/setup-detail.tsx': 1,
};

const REMAINING_CANCELLED_EFFECTS: Record<string, number> = {
  'app/settings/settings-client.tsx': 1,
  'components/feedback/use-untriaged-feedback.ts': 1,
  'components/hud/goal-visual-layout-study.tsx': 1,
  'components/shortcuts/command-palette.tsx': 1,
  'components/workspace/paused-agent-record.tsx': 1,
  'components/workspace/project-opener.tsx': 1,
  'components/workspace/recent-conversations.tsx': 2,
  'components/workspace/remote-agent/use-remote-coworkers.ts': 1,
  'components/workspace/use-closed-session-count.ts': 1,
  'components/workspace/use-workspace-state.ts': 1,
  'components/workspace/workspace-client.tsx': 1,
};

const GENERATION_REF =
  /\b(?:const|let)\s+(\w*(?:[sS]eq|[gG]eneration|[gG]en|[rR]equest|[aA]ttempt|[vV]isit|[eE]poch|[tT]icket))\s*=\s*useRef(?:<\s*number\s*>)?\(\s*0\s*\)/g;
const CANCELLED_EFFECT = /\blet\s+cancelled\s*=\s*false\b/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (
      /\.(?:ts|tsx)$/.test(entry.name) &&
      !/\.(?:test|spec)\.tsx?$/.test(entry.name) &&
      !/\.d\.ts$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

function census(pattern: RegExp): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of sourceFiles(SRC)) {
    const relative = path.relative(SRC, file);
    if (relative === path.join('hooks', 'use-latest-request.ts')) continue;
    const text = fs.readFileSync(file, 'utf8');
    const hits = text.match(pattern)?.length ?? 0;
    if (hits > 0) counts[relative] = hits;
  }
  return counts;
}

describe('stale-async ratchet (BUG-118/119/120/121)', () => {
  it('has no new hand-rolled request generation ref', () => {
    expect(
      census(GENERATION_REF),
      'A new `useRef(0)` generation counter. Use `useLatestRequest` from src/hooks instead; if you migrated a listed site, shrink REMAINING_GENERATION_REFS.'
    ).toEqual(REMAINING_GENERATION_REFS);
  });

  it('has no new `let cancelled = false` effect', () => {
    expect(
      census(CANCELLED_EFFECT),
      'A new `let cancelled = false` effect. Open a `useLatestRequest` ticket and `invalidate()` in the cleanup instead; if you migrated a listed site, shrink REMAINING_CANCELLED_EFFECTS.'
    ).toEqual(REMAINING_CANCELLED_EFFECTS);
  });
});
