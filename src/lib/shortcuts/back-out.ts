/**
 * One Escape owner: the back-out ladder (ENG-016, BUG-302).
 *
 * Escape used to have about forty owners. Each surface caught the key on its
 * own element, decided alone whether to swallow it or let it bubble, and the
 * gaps between those decisions were dead keys: a Team dock tab ignored it,
 * Team's grid yielded keys born in the dock, and the window fallback yielded
 * keys born in Team, so Escape on the tab did nothing while the dock said
 * "esc · back to tiles".
 *
 * Here every surface registers a LAYER on one rung of a single ladder, and
 * one listener resolves the key from wherever focus is, top rung first:
 *
 *   overlay   a dialog, menu or ⌘K. Radix's own dialogs and menus answer
 *             before this listener runs and the ladder yields to them; a
 *             bespoke modal registers here. An overlay is modal: the topmost
 *             one answers wherever focus is and nothing beneath it does.
 *   field     a text field with something to cancel or clear
 *   panel     a panel's own levels (a drilled roadmap item, a Chatter thread)
 *   dock      the dock that holds the panels (back to the tiles)
 *   grid      a board's selection (Fleet's working set)
 *   altitude  leaving the altitude itself (Team to Agent, Fleet one level up,
 *             Settings back) or, at the Agent altitude, back to the Session
 *
 * A layer's `back` returns false when it has nothing left to back out of, and
 * the key falls to the next rung. That fall-through is the point: no focus
 * position leaves Escape dead, and no layer needs to know what is beneath it.
 *
 * The ladder also owns where focus goes when a layer closes or steps aside:
 * `rememberFocus` keeps the invoker's focus, caret and selection, and
 * `restore` puts them back, onto a remounted element if the original is gone.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { isOpenModalShortcutTarget } from './chord-engine';
import {
  getWorkspaceFixedFamily,
  matchFixedFamily,
  type FixedFamilyKeyEvent,
} from './fixed-families';

/** The rungs, top first. Resolution order is this order. */
const BACK_OUT_RUNGS = [
  'overlay',
  'field',
  'panel',
  'dock',
  'grid',
  'altitude',
] as const;
type BackOutRung = (typeof BACK_OUT_RUNGS)[number];

export interface BackOutLayer {
  rung: BackOutRung;
  /** Where the layer lives. A layer answers only for keys born inside it,
   *  unless it is `ambient`. */
  element?: () => Element | null;
  /** Answers wherever focus is (an altitude, a board's selection). Among
   *  ambient layers of one rung, the one whose element sits deeper answers
   *  first: Team's altitude sits inside the workspace's. */
  ambient?: boolean;
  /** One step back. False means nothing is left to back out of here, and
   *  Escape falls to the next layer down. */
  back: (event: KeyboardEvent) => boolean;
}

/**
 * Keys born here belong to what is running there. The Session's terminal
 * hands Escape to its TUI; the ladder never reaches past it.
 */
const OWNS_ESCAPE =
  '.xterm-helper-textarea, [data-workspace-session-focus-owner]';

const BACK_OUT_FAMILY_ID = 'fixed-back-out';

const layers: BackOutLayer[] = [];
let listening = false;

function rungIndex(layer: BackOutLayer): number {
  return BACK_OUT_RUNGS.indexOf(layer.rung);
}

function depth(element: Element | null): number {
  let count = 0;
  for (let node: Node | null = element; node; node = node.parentNode) count++;
  return count;
}

/** Is this the Escape the manifest declares (no modifiers)? The binding is
 *  read from the same fixed family the keyboard help shows. */
function isBackOutKey(event: FixedFamilyKeyEvent): boolean {
  return (
    matchFixedFamily(getWorkspaceFixedFamily(BACK_OUT_FAMILY_ID), event)
      ?.kind === 'back-out'
  );
}

/** The layers that may answer a key born at `target`, in the order they are
 *  asked: rung, then the deeper element, then the later registration. */
function ladderFor(target: Element | null): BackOutLayer[] {
  return layers
    .map((layer, order) => ({
      layer,
      order,
      element: layer.element?.() ?? null,
    }))
    .filter(({ layer, element }) => {
      if (layer.ambient || !layer.element) return true;
      return !!element && !!target && element.contains(target);
    })
    .sort(
      (a, b) =>
        rungIndex(a.layer) - rungIndex(b.layer) ||
        depth(b.element) - depth(a.element) ||
        b.order - a.order
    )
    .map(({ layer }) => layer);
}

/**
 * Resolve one keydown. Returns whether a layer took it (and then prevents
 * its default).
 */
function resolveBackOut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return false;
  // IME composition owns Escape: it cancels the candidate, not a layer.
  if (event.isComposing || event.keyCode === 229) return false;
  if (!isBackOutKey(event)) return false;

  // A registered overlay is modal: the topmost one answers wherever focus
  // is, and Escape never leaks to the page behind it.
  const overlay = [...layers].reverse().find(layer => layer.rung === 'overlay');
  if (overlay) {
    overlay.back(event);
    event.preventDefault();
    return true;
  }

  const target = event.target instanceof Element ? event.target : null;
  // An open dialog or palette the ladder does not own keeps Escape (Radix
  // normally answered already; one that kept the key prevented its default).
  if (target && isOpenModalShortcutTarget(target)) return false;
  if (target?.closest(OWNS_ESCAPE)) return false;

  for (const layer of ladderFor(target)) {
    if (layer.back(event)) {
      event.preventDefault();
      return true;
    }
  }
  return false;
}

// Bubble phase on window: after Radix's dialogs and menus (document capture)
// and after every element's own handler, so a surface that has not joined the
// ladder still keeps a key it prevents.
function onKeyDown(event: KeyboardEvent): void {
  resolveBackOut(event);
}

/** Join the ladder. Returns the leave function. */
export function registerBackOut(layer: BackOutLayer): () => void {
  layers.push(layer);
  if (!listening && typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
    listening = true;
  }
  return () => {
    const index = layers.indexOf(layer);
    if (index !== -1) layers.splice(index, 1);
    if (layers.length === 0 && listening) {
      window.removeEventListener('keydown', onKeyDown);
      listening = false;
    }
  };
}

/** Test seam: the rungs of every layer on the ladder, registration order. */
export function backOutLayersForTest(): readonly BackOutRung[] {
  return layers.map(layer => layer.rung);
}

// ── Focus return ─────────────────────────────────────────────────────────

type TextControl = HTMLInputElement | HTMLTextAreaElement;

interface TextPosition {
  start: number;
  end: number;
  direction: 'forward' | 'backward' | 'none';
  scrollTop: number;
  scrollLeft: number;
}

function textControl(element: Element | null): TextControl | null {
  if (
    !(element instanceof HTMLTextAreaElement) &&
    !(element instanceof HTMLInputElement)
  ) {
    return null;
  }
  try {
    // inputs without a caret (checkbox, email, number) report null or throw
    return element.selectionStart === null ? null : element;
  } catch {
    return null;
  }
}

function readPosition(control: TextControl): TextPosition {
  return {
    start: control.selectionStart ?? 0,
    end: control.selectionEnd ?? 0,
    direction: control.selectionDirection ?? 'none',
    scrollTop: control.scrollTop,
    scrollLeft: control.scrollLeft,
  };
}

export interface FocusReturn {
  /** The element focus will return to, if it is still connected. */
  readonly element: HTMLElement | null;
  /**
   * Put focus, caret and selection back. `onto` names the element that now
   * stands where the remembered one stood (a field that remounted while its
   * layer was away); without it the original element is used if it is still
   * connected. Returns whether focus landed.
   */
  restore(onto?: HTMLElement | null): boolean;
}

/**
 * Remember where the operator was: the focused element (or the named one,
 * for a field whose position matters even while a button holds focus) and,
 * for a text field, its caret, selection and scroll.
 */
export function rememberFocus(
  element: Element | null = typeof document === 'undefined'
    ? null
    : document.activeElement
): FocusReturn {
  const remembered =
    element instanceof HTMLElement && element !== element.ownerDocument.body
      ? element
      : null;
  const control = textControl(remembered);
  const position = control ? readPosition(control) : null;
  return {
    element: remembered,
    restore(onto) {
      const destination = onto ?? (remembered?.isConnected ? remembered : null);
      if (!destination?.isConnected) return false;
      destination.focus({ preventScroll: true });
      const target = textControl(destination);
      if (position && target) {
        const length = target.value.length;
        target.setSelectionRange(
          Math.min(position.start, length),
          Math.min(position.end, length),
          position.direction
        );
        target.scrollTop = position.scrollTop;
        target.scrollLeft = position.scrollLeft;
      }
      return destination.ownerDocument.activeElement === destination;
    },
  };
}

// ── React ────────────────────────────────────────────────────────────────

interface UseBackOutOptions {
  rung: BackOutRung;
  /** Where the layer lives; omit for an altitude with no element. */
  element?: RefObject<Element | null>;
  ambient?: boolean;
  back: (event: KeyboardEvent) => boolean;
  /** Off the ladder while false (a closed disclosure, a hidden search). */
  enabled?: boolean;
  /** When the layer leaves the ladder and focus went nowhere, return it to
   *  the element that held it when the layer joined (a confirm's invoker). */
  returnFocus?: boolean;
}

/**
 * Join the ladder for as long as the component is mounted and `enabled`.
 * `back` and `element` are read at the moment Escape arrives, so a layer
 * never re-registers (and never changes its place) as its handlers change.
 */
export function useBackOut({
  rung,
  element,
  ambient = false,
  back,
  enabled = true,
  returnFocus = false,
}: UseBackOutOptions): void {
  const backRef = useRef(back);
  const elementRef = useRef(element);
  useLayoutEffect(() => {
    backRef.current = back;
    elementRef.current = element;
  });
  // Layout phase: joins before any passive effect moves focus, so a layer
  // that returns focus remembers its real invoker, not its own first button.
  useLayoutEffect(() => {
    if (!enabled) return;
    const invoker = returnFocus ? rememberFocus() : null;
    const leave = registerBackOut({
      rung,
      ambient,
      element: () => elementRef.current?.current ?? null,
      back: event => backRef.current(event),
    });
    return () => {
      leave();
      if (!invoker) return;
      // After the commit that removed the layer: return focus only if it
      // went nowhere, so a close that moved focus on purpose keeps it there.
      queueMicrotask(() => {
        const active = document.activeElement;
        if (!active || active === document.body) invoker.restore();
      });
    };
  }, [rung, ambient, enabled, returnFocus]);
}
