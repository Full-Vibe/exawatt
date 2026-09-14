import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isCameraKey } from '@/components/hud/webgl/agent-field-motion';
import { BOARD_KEY_FAMILIES } from '@/lib/shortcuts/fixed-families';
import { BOARD_KEYMAP } from './board-keymap';

/**
 * The keymap is the single description of the board's keyboard surface. These
 * tests hold it to that: the help modal's board entries must be a projection
 * of it, the glide keys it documents must be real camera keys, and the
 * surface handler may not compare against a key the map does not describe.
 * The modal shipped for weeks claiming the arrow keys pan; this is what makes
 * that class of drift a test failure instead of a discovery.
 */

const surfaceSource = readFileSync(
  fileURLToPath(new URL('./operations-board-surface.tsx', import.meta.url)),
  'utf8'
);

/** Length-one keycaps a keymap entry documents, lowercased ('N / P' → n, p). */
function documentedSingleKeys(
  entries: readonly (typeof BOARD_KEYMAP)[number][]
): Set<string> {
  const keys = new Set<string>();
  for (const entry of entries) {
    for (const token of entry.keys.key.split(/[\s/]+/)) {
      if (token.length === 1) keys.add(token.toLowerCase());
    }
  }
  return keys;
}

describe('board keymap contract', () => {
  it('has unique ids and production-voice labels', () => {
    const ids = BOARD_KEYMAP.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of BOARD_KEYMAP) {
      expect(entry.label.trim()).not.toBe('');
      expect(entry.keys.key.trim()).not.toBe('');
      expect(entry.label, `${entry.id} label carries an em dash`).not.toContain(
        '—'
      );
      expect(
        /\b[A-Z]{2,}\b/.test(entry.label),
        `${entry.id} label shouts a word`
      ).toBe(false);
    }
  });

  it('is exactly what the help modal renders for the board', () => {
    expect(
      BOARD_KEY_FAMILIES.map(family => ({
        id: family.id,
        label: family.label,
        keys: family.keys,
      }))
    ).toEqual(
      BOARD_KEYMAP.map(entry => ({
        id: entry.id,
        label: entry.label,
        keys: entry.keys,
      }))
    );
    for (const family of BOARD_KEY_FAMILIES) {
      expect(family.category).toBe('view');
    }
  });

  it('documents the glide with keys the glide actually holds', () => {
    const glideKeys = documentedSingleKeys(
      BOARD_KEYMAP.filter(entry => entry.owner === 'glide')
    );
    // The display minus sign stands for the '-' key.
    for (const key of glideKeys) {
      expect(isCameraKey(key === '−' ? '-' : key), `glide key ${key}`).toBe(
        true
      );
    }
    expect(glideKeys.has('w')).toBe(true);
    expect(glideKeys.has('+')).toBe(true);
    // Q and E reach the glide but the board camera has no orbit verb, so the
    // map deliberately leaves them out: it describes effects, not listeners.
    expect(glideKeys.has('q')).toBe(false);
    expect(glideKeys.has('e')).toBe(false);
  });

  it('covers every key literal the surface handler compares against', () => {
    const compared = new Set<string>();
    for (const match of surfaceSource.matchAll(
      /event\.key(?:\.toLowerCase\(\))? === '(.+?)'/g
    )) {
      compared.add(match[1]!.toLowerCase());
    }
    const documented = documentedSingleKeys(
      BOARD_KEYMAP.filter(entry => entry.owner === 'surface')
    );
    for (const key of compared) {
      expect(documented.has(key), `handler answers undocumented key ${key}`)
        .toBe(true);
    }
    for (const key of ['0', 'n', 'p', 'v']) {
      expect(compared.has(key), `keymap documents lost binding ${key}`).toBe(
        true
      );
    }
    // Range and pattern triggers, pinned structurally: digit ordinals,
    // shifted digits, and the arrow walk each need their keymap entry.
    expect(surfaceSource).toContain("event.key >= '1' && event.key <= '9'");
    expect(BOARD_KEYMAP.some(e => e.id === 'fixed-board-project-ordinals'))
      .toBe(true);
    expect(surfaceSource).toContain('Digit[1-9]');
    expect(
      BOARD_KEYMAP.some(
        e =>
          e.id === 'fixed-board-project-multi' &&
          e.keys.modifiers?.includes('shift')
      )
    ).toBe(true);
    expect(surfaceSource).toContain("event.key.startsWith('Arrow')");
    expect(BOARD_KEYMAP.some(e => e.id === 'fixed-board-agent-walk')).toBe(
      true
    );
  });
});
