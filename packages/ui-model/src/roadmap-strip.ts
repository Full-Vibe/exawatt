import type { RoadmapItemView, RoadmapLensView } from './roadmap-lens';

/**
 * Roadmap strip model (ENG-017 S6): the collapsed rail as a readable spine.
 * Pure and geometry-free like the lens itself — the workspace strip is the
 * first consumer; any future compact expression (status strip, spatial
 * badge) consumes the same nodes.
 *
 * Semantics (operator decisions, 2026-07-11):
 * - "current" is the item with a live session ATTACHED (first now item with
 *   chips), falling back to the now station when nothing is attached
 * - blocked / starving / unmapped are the loud states; everything nominal
 *   stays quiet
 * - the spine reads top-to-bottom as the queue reads: shipped history, then
 *   now, next, later; parked never appears
 */

export type RoadmapStripNode =
  | {
      kind: 'item';
      id: string;
      /** tooltip line: id, title, status word, fraction when present */
      label: string;
      role: 'shipped' | 'current' | 'now' | 'next' | 'later';
      blocked: boolean;
      /** a linked live session exists */
      attached: boolean;
      /** an attached session needs the operator */
      needsAttention: boolean;
    }
  | { kind: 'aggregate'; group: 'shipped' | 'later'; count: number; label: string }
  | { kind: 'unmapped'; count: number; label: string }
  | { kind: 'starving'; label: string };

/** hard cap so the spine always fits beside a terminal without scrolling */
export const ROADMAP_STRIP_MAX_NODES = 14;

function itemLabel(item: RoadmapItemView, role: string): string {
  const id = item.declaredId ?? item.title;
  const fraction =
    item.milestones.length > 0
      ? ` · ${item.milestonesDone}/${item.milestones.length}`
      : '';
  const state = item.blocked ? 'blocked' : role;
  return `${id} — ${item.title} · ${state}${fraction}`;
}

function itemNode(
  item: RoadmapItemView,
  role: 'shipped' | 'current' | 'now' | 'next' | 'later'
): RoadmapStripNode {
  return {
    kind: 'item',
    id: item.id,
    label: itemLabel(item, role),
    role,
    blocked: item.blocked,
    attached: item.chips.length > 0,
    needsAttention: item.chips.some(chip => chip.needsAttention),
  };
}

export function buildRoadmapStrip(
  view: RoadmapLensView,
  maxNodes = ROADMAP_STRIP_MAX_NODES
): RoadmapStripNode[] {
  if (view.status !== 'ok') return [];

  const nodes: RoadmapStripNode[] = [];
  if (view.unmappedSessions.length > 0) {
    nodes.push({
      kind: 'unmapped',
      count: view.unmappedSessions.length,
      label: `${view.unmappedSessions.length} session${
        view.unmappedSessions.length === 1 ? '' : 's'
      } not linked to an item`,
    });
  }

  if (view.queueEmpty) {
    if (view.shipped.length > 0) {
      nodes.push({
        kind: 'aggregate',
        group: 'shipped',
        count: view.shipped.length,
        label: `${view.shipped.length} shipped`,
      });
    }
    nodes.push({
      kind: 'starving',
      label: 'Queue empty — agents here will starve when they finish',
    });
    return nodes;
  }

  // current = attached (operator decision); fall back to the now station
  const current =
    view.now.find(item => item.chips.length > 0) ??
    view.now.find(item => item.isNowStation) ??
    null;

  // budget: shipped compresses first, then the later tail; now/next survive
  let budget = maxNodes;
  const shippedIndividually = view.shipped.length <= 2;
  budget -= shippedIndividually ? view.shipped.length : 1;
  budget -= view.now.length + view.next.length;
  const laterShown = budget > view.later.length ? view.later.length : Math.max(0, budget - 1);

  if (view.shipped.length > 0) {
    if (shippedIndividually) {
      for (const item of view.shipped) nodes.push(itemNode(item, 'shipped'));
    } else {
      nodes.push({
        kind: 'aggregate',
        group: 'shipped',
        count: view.shipped.length,
        label: `${view.shipped.length} shipped`,
      });
    }
  }
  for (const item of view.now) {
    nodes.push(itemNode(item, item === current ? 'current' : 'now'));
  }
  for (const item of view.next) nodes.push(itemNode(item, 'next'));
  for (const item of view.later.slice(0, laterShown)) {
    nodes.push(itemNode(item, 'later'));
  }
  const laterHidden = view.later.length - laterShown;
  if (laterHidden > 0) {
    nodes.push({
      kind: 'aggregate',
      group: 'later',
      count: laterHidden,
      label: `${laterHidden} more later`,
    });
  }
  return nodes;
}
