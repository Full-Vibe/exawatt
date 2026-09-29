import type { KeyBinding } from '@/types/shortcuts';

/**
 * The board's keyboard surface, as one piece of data.
 *
 * Three window listeners answer these keys today -- the surface's hotkey
 * handler, the shared WASD camera glide, and the client's Escape -- and the
 * keyboard help modal describes them. Each used to describe the bindings
 * independently, and the modal drifted into fiction: it claimed the arrow
 * keys pan when they walk Agent selection. The help modal's board entries now
 * derive from this map and `board-keymap.test.ts` pins the derivation, so a
 * binding change that skips this file fails a test instead of shipping a
 * modal that lies.
 *
 * Q and E ask the shared glide for orbit, but the board camera has no orbit
 * verb (`nudge` drops the term), so they are deliberately absent: this map
 * describes what a key does on this board, not what a listener happens to
 * swallow.
 */
interface BoardKeymapEntry {
  /** Stable family id; the help modal's board entry carries the same id. */
  id: string;
  /** Keycaps as the help modal renders them. */
  keys: KeyBinding;
  /** What pressing it does, in production voice. */
  label: string;
  /** The listener that answers the key today. */
  owner: 'surface' | 'glide' | 'client' | 'controls';
}

export const BOARD_KEYMAP: readonly BoardKeymapEntry[] = [
  {
    id: 'fixed-board-project-ordinals',
    keys: { key: '1…9' },
    label: 'Fleet: open Project 1–9',
    owner: 'surface',
  },
  {
    id: 'fixed-board-project-multi',
    keys: { key: '1…9', modifiers: ['shift'] },
    label: 'Fleet: toggle Project in selection',
    owner: 'surface',
  },
  {
    id: 'fixed-board-overview',
    keys: { key: '0' },
    label: 'Fleet: recenter / overview',
    owner: 'surface',
  },
  {
    id: 'fixed-board-attention',
    keys: { key: 'N / P' },
    label: 'Fleet: next / previous attention',
    owner: 'surface',
  },
  {
    id: 'fixed-board-agent-walk',
    keys: { key: '← ↑ ↓ →' },
    label: 'Fleet: walk selection across Agents',
    owner: 'surface',
  },
  {
    id: 'fixed-board-pan',
    keys: { key: 'W A S D' },
    label: 'Fleet: pan board',
    owner: 'glide',
  },
  {
    id: 'fixed-board-zoom',
    keys: { key: '+ / −' },
    label: 'Fleet: zoom board',
    owner: 'glide',
  },
  {
    id: 'fixed-board-projection',
    keys: { key: 'V' },
    label: 'Fleet: toggle projection',
    owner: 'surface',
  },
  {
    id: 'fixed-board-activate',
    keys: { key: 'Enter / Space' },
    label: 'Fleet: activate the focused control',
    owner: 'controls',
  },
  {
    id: 'fixed-board-escape',
    keys: { key: 'Escape' },
    label: 'Fleet: clear selection, then zoom out',
    owner: 'client',
  },
];
