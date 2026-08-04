// Named as a DOM suite so Vitest provisions browser geometry primitives.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALTITUDE_HANDOFF_BUDGET_MS,
  altitudeHandoffActive,
  captureAltitudeCards,
  claimAltitudeHandoff,
  publishAltitudeHandoff,
  resetAltitudeHandoffForTests,
  solveEntryPose,
  type HandoffSnapshot,
} from './altitude-handoff';

function card(
  key: string,
  rect: { left: number; top: number; width: number; height: number }
) {
  return { key, label: key, color: '#50E6FF', rect };
}

function zone(
  label: string,
  rect: { x: number; y: number; width: number; height: number },
  overrides: Partial<{ visible: boolean; isAggregate: boolean }> = {}
) {
  return {
    id: `project:${label}`,
    label,
    rect,
    visible: true,
    isAggregate: false,
    ...overrides,
  };
}

const CANVAS = { width: 1200, height: 700, left: 0, top: 100 };

/** Cards synthesized by projecting zones through a known pose — the solver
 *  must recover that pose exactly and report ~zero residual. */
function projectCards(
  zones: ReturnType<typeof zone>[],
  pose: { centerX: number; centerY: number; zoom: number }
): HandoffSnapshot {
  const cards = zones.map(entry =>
    card(entry.label, {
      left:
        (entry.rect.x - pose.centerX) * pose.zoom +
        CANVAS.width / 2 +
        CANVAS.left,
      top:
        (entry.rect.y - pose.centerY) * pose.zoom +
        CANVAS.height / 2 +
        CANVAS.top,
      width: entry.rect.width * pose.zoom,
      height: entry.rect.height * pose.zoom,
    })
  );
  return {
    cards,
    viewport: { width: 1200, height: 800 },
    capturedAt: 0,
  };
}

describe('captureAltitudeCards', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function mount(
    entries: Array<{ label: string; color?: string; rect?: Partial<DOMRect> }>
  ) {
    for (const entry of entries) {
      const element = document.createElement('section');
      element.setAttribute('data-handoff-card', '');
      element.setAttribute('data-handoff-label', entry.label);
      element.setAttribute('data-handoff-color', entry.color ?? '#abc');
      element.getBoundingClientRect = () =>
        ({
          left: 10,
          top: 20,
          right: 310,
          bottom: 120,
          width: 300,
          height: 100,
          ...entry.rect,
        }) as DOMRect;
      document.body.appendChild(element);
    }
  }

  it('captures labeled, visible cards with identity and position', () => {
    mount([{ label: 'Dispatch-Engine ' }, { label: 'grid-api' }]);
    const snapshot = captureAltitudeCards();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.cards.map(entry => entry.key)).toEqual([
      'dispatch-engine',
      'grid-api',
    ]);
    expect(snapshot!.cards[0]!.rect).toMatchObject({ left: 10, top: 20 });
  });

  it('drops zero-sized, offscreen, and duplicate-identity cards', () => {
    mount([
      { label: 'ok' },
      { label: 'zero', rect: { width: 0, height: 0 } },
      {
        label: 'offscreen',
        rect: { top: 99_999, bottom: 100_099 },
      },
      { label: 'dup' },
      { label: 'dup' },
    ]);
    const snapshot = captureAltitudeCards();
    expect(snapshot!.cards.map(entry => entry.key)).toEqual(['ok']);
  });

  it('returns null when nothing can carry', () => {
    expect(captureAltitudeCards()).toBeNull();
    mount([{ label: '   ' }]);
    expect(captureAltitudeCards()).toBeNull();
  });
});

describe('handoff store', () => {
  beforeEach(() => resetAltitudeHandoffForTests());

  const snapshot = (): HandoffSnapshot => ({
    cards: [card('a', { left: 0, top: 0, width: 10, height: 10 })],
    viewport: { width: window.innerWidth, height: window.innerHeight },
    capturedAt: 1_000,
  });

  it('claims a fresh snapshot exactly once', () => {
    publishAltitudeHandoff(snapshot());
    expect(altitudeHandoffActive(1_100)).toBe(true);
    expect(claimAltitudeHandoff(1_100)).not.toBeNull();
    expect(claimAltitudeHandoff(1_100)).toBeNull();
  });

  it('declines a snapshot older than the frame budget', () => {
    publishAltitudeHandoff(snapshot());
    expect(
      claimAltitudeHandoff(1_000 + ALTITUDE_HANDOFF_BUDGET_MS + 1)
    ).toBeNull();
    expect(altitudeHandoffActive(1_000 + ALTITUDE_HANDOFF_BUDGET_MS + 1)).toBe(
      false
    );
  });

  it('declines when the viewport changed since capture', () => {
    publishAltitudeHandoff({
      ...snapshot(),
      viewport: { width: window.innerWidth + 300, height: window.innerHeight },
    });
    expect(claimAltitudeHandoff(1_100)).toBeNull();
  });

  it('stays active briefly after a claim so the viewport restore yields', () => {
    publishAltitudeHandoff(snapshot());
    claimAltitudeHandoff(1_100);
    expect(altitudeHandoffActive(1_200)).toBe(true);
    expect(altitudeHandoffActive(10_000)).toBe(false);
  });
});

describe('solveEntryPose', () => {
  const grid = [
    zone('a', { x: 0, y: 0, width: 24, height: 11.5 }),
    zone('b', { x: 29, y: 0, width: 24, height: 11.5 }),
    zone('c', { x: 0, y: 16.5, width: 24, height: 11.5 }),
    zone('d', { x: 29, y: 16.5, width: 24, height: 11.5 }),
  ];

  it('recovers an exact pose from consistent cards', () => {
    const pose = { centerX: 26.5, centerY: 14, zoom: 18 };
    const solution = solveEntryPose(projectCards(grid, pose), grid, CANVAS);
    expect(solution).not.toBeNull();
    expect(solution!.pose.x).toBeCloseTo(26.5, 4);
    expect(solution!.pose.y).toBeCloseTo(-14, 4);
    expect(solution!.pose.zoom).toBeCloseTo(18, 4);
    expect(solution!.residual).toBeLessThan(1e-9);
    // Targets are the zone rects projected under the recovered pose — here
    // they coincide with the cards themselves.
    const target = solution!.targets.find(entry => entry.key === 'a')!;
    expect(target.to.left).toBeCloseTo(target.from.left, 3);
    expect(target.to.width).toBeCloseTo(target.from.width, 3);
  });

  it('tolerates layout mismatch and reports the residual', () => {
    // Cards stacked vertically (Team altitude) against a 2×2 board grid.
    const stacked: HandoffSnapshot = {
      cards: ['a', 'b', 'c', 'd'].map((key, index) =>
        card(key, { left: 200, top: 60 + index * 180, width: 640, height: 150 })
      ),
      viewport: { width: 1200, height: 800 },
      capturedAt: 0,
    };
    const solution = solveEntryPose(stacked, grid, CANVAS);
    expect(solution).not.toBeNull();
    expect(solution!.residual).toBeGreaterThan(0);
    expect(solution!.residual).toBeLessThanOrEqual(0.8);
    expect(solution!.targets).toHaveLength(4);
    // Uncorrelated orders fall back to scale-matching: zones arrive at
    // roughly card size, never as a collapsed distant board.
    const cardScale = Math.sqrt((640 * 150) / (24 * 11.5));
    expect(solution!.pose.zoom).toBeGreaterThan(cardScale * 0.6);
    expect(solution!.pose.zoom).toBeLessThan(cardScale * 1.7);
  });

  it('honors zoom bounds from the rig', () => {
    const pose = { centerX: 26.5, centerY: 14, zoom: 18 };
    const solution = solveEntryPose(projectCards(grid, pose), grid, CANVAS, {
      min: 20,
      max: 40,
    });
    expect(solution).not.toBeNull();
    expect(solution!.pose.zoom).toBe(20);
  });

  it('requires at least two matches', () => {
    const pose = { centerX: 26.5, centerY: 14, zoom: 18 };
    const one = projectCards([grid[0]!], pose);
    expect(solveEntryPose(one, grid, CANVAS)).toBeNull();
  });

  it('requires the matched majority of cards', () => {
    const pose = { centerX: 26.5, centerY: 14, zoom: 18 };
    const snapshot = projectCards(grid, pose);
    const foreign = ['x', 'y', 'z', 'w'].map(key =>
      card(key, { left: 0, top: 0, width: 10, height: 10 })
    );
    expect(
      solveEntryPose(
        { ...snapshot, cards: [...snapshot.cards, ...foreign] },
        grid,
        CANVAS
      )
    ).toBeNull();
  });

  it('ignores hidden and aggregate zones', () => {
    const pose = { centerX: 26.5, centerY: 14, zoom: 18 };
    const zones = [
      ...grid,
      zone('a', { x: 500, y: 500, width: 24, height: 11.5 }, {
        isAggregate: true,
      }),
      zone('hidden', { x: 900, y: 0, width: 24, height: 11.5 }, {
        visible: false,
      }),
    ];
    const solution = solveEntryPose(projectCards(grid, pose), zones, CANVAS);
    expect(solution).not.toBeNull();
    expect(solution!.pose.zoom).toBeCloseTo(18, 4);
  });

  it('declines degenerate geometry instead of emitting NaN', () => {
    const samePoint = [
      zone('a', { x: 10, y: 10, width: 4, height: 4 }),
      zone('b', { x: 10, y: 10, width: 4, height: 4 }),
    ];
    const snapshot: HandoffSnapshot = {
      cards: [
        card('a', { left: 100, top: 100, width: 40, height: 40 }),
        card('b', { left: 100, top: 100, width: 40, height: 40 }),
      ],
      viewport: { width: 1200, height: 800 },
      capturedAt: 0,
    };
    expect(solveEntryPose(snapshot, samePoint, CANVAS)).toBeNull();
  });

  it('anti-correlated orders use scale + centroid, never a negative zoom', () => {
    // Mirror-imaged card order relative to the zones: the least-squares
    // zoom would be negative, so the pose must come from the size ratio.
    const mirrored: HandoffSnapshot = {
      cards: [
        card('a', { left: 1000, top: 600, width: 100, height: 40 }),
        card('b', { left: 100, top: 600, width: 100, height: 40 }),
        card('c', { left: 1000, top: 100, width: 100, height: 40 }),
        card('d', { left: 100, top: 100, width: 100, height: 40 }),
      ],
      viewport: { width: 1200, height: 800 },
      capturedAt: 0,
    };
    const solution = solveEntryPose(mirrored, grid, CANVAS);
    expect(solution).not.toBeNull();
    const cardScale = Math.sqrt((100 * 40) / (24 * 11.5));
    expect(solution!.pose.zoom).toBeCloseTo(cardScale, 4);
  });
});
