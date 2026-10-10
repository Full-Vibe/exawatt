/**
 * The scroll story (ENG-031 W15), taken from the design partner's structure
 * (Figma "Exawatt Website Structure", slides 15 to 21, 2026-09-11): a landing
 * over one globe, three dissections of it by agent state with a panel pointed
 * at a real agent, a zoom-out to the whole fleet, a launch band, and the
 * download. Her order starts inside one Project and arrives at the Fleet
 * last; the shipped `/v2` runs the other way. Per the operator (2026-09-13)
 * the order was hers to resolve, so this study follows the deck.
 *
 * Two copy sets, switchable on the page:
 * - `deck`  the deck's own lines, verbatim where it has them. Its third
 *           dissection is "queued", which is not a product status; the study
 *           lights the `off` signal for it.
 * - `canon` the same beats on the operator's frame and the product's own
 *           five-signal grammar (working, needs you, done). The third
 *           dissection becomes Done, which the product can actually show.
 *
 * No em dashes. The reader is never the bottleneck.
 */

import type { StatusLightState } from '@/components/status-light/protocol';

type StageId =
  | 'landing'
  | 'working'
  | 'needs-you'
  | 'third'
  | 'fleet'
  | 'launch'
  | 'download';

export type CopySetId = 'deck' | 'canon';

interface StageCopy {
  kicker?: string;
  headline: string[];
  body?: string[];
}

export interface Stage {
  id: StageId;
  /** Where the reading column sits while the stage is on screen. */
  panel: 'center-top' | 'right' | 'left' | 'center' | 'none';
  /** Which signal the visual lifts and the panel points at, if any. */
  highlight: Partial<Record<CopySetId, StatusLightState>>;
  /** Whether an agent card is shown, pointed at an exemplar. */
  card: boolean;
  /** What the camera fits: the whole fleet, or the first Project close.
   *  The page opens on the fleet, the dissections go in, the fleet stage
   *  comes all the way back out (operator 2026-10-09). */
  focus: 'fleet' | 'project';
  /** Project names over the world. Off under centred type. */
  labels: boolean;
  copy: Record<CopySetId, StageCopy>;
}

export const STAGES: Stage[] = [
  {
    id: 'landing',
    panel: 'center-top',
    highlight: {},
    card: false,
    focus: 'fleet',
    labels: false,
    copy: {
      deck: {
        headline: ['Today you run 10 agents.', 'Tomorrow you will run 10,000.'],
        body: ['Exawatt is the command interface for your agent fleet.'],
      },
      canon: {
        headline: ['Today you run 10 agents.', 'Tomorrow you will run 10,000.'],
        body: ['Exawatt is the command interface for your agent fleet.'],
      },
    },
  },
  {
    id: 'working',
    panel: 'right',
    highlight: { deck: 'active', canon: 'active' },
    card: true,
    focus: 'project',
    labels: true,
    copy: {
      deck: {
        headline: ["Easily see each agent's", 'working status'],
        body: ['From credit usage, to time spent.'],
      },
      canon: {
        headline: ['Every agent, at a glance.'],
        body: [
          'What it is doing, on which model, and what it has spent.',
          'Without opening a single one.',
        ],
      },
    },
  },
  {
    id: 'needs-you',
    panel: 'left',
    highlight: { deck: 'needs-you', canon: 'needs-you' },
    card: true,
    focus: 'project',
    labels: true,
    copy: {
      deck: {
        headline: ['The agents that need', 'you, surfaced.'],
        body: ['Flags the moment an agent needs a human to take actions.'],
      },
      canon: {
        headline: ['The ones waiting on you', 'light up.'],
        body: [
          'A question, a permission, a decision.',
          'The rest keep working.',
        ],
      },
    },
  },
  {
    id: 'third',
    panel: 'right',
    highlight: { deck: 'off', canon: 'result' },
    card: true,
    focus: 'project',
    labels: true,
    copy: {
      deck: {
        headline: ['Queued agents orbit', 'the core'],
        body: [
          'Work that is waiting stays in plain sight, and drops into the fleet the moment capacity frees up.',
        ],
      },
      canon: {
        headline: ['Finished is not', 'an interruption.'],
        body: [
          'Results wait in plain sight until you are ready to look.',
          'Never a green check that lies.',
        ],
      },
    },
  },
  {
    id: 'fleet',
    panel: 'center-top',
    highlight: {},
    card: false,
    focus: 'fleet',
    labels: true,
    copy: {
      deck: {
        headline: ['All your fleets in one view.'],
        body: [
          'Zoom out and every project is there. Zoom in and nothing is hidden.',
        ],
      },
      canon: {
        headline: ['Every project. One board.'],
        body: ['This is how ten becomes ten thousand.'],
      },
    },
  },
  {
    id: 'launch',
    panel: 'center',
    highlight: {},
    card: false,
    focus: 'fleet',
    labels: false,
    copy: {
      deck: {
        headline: ['Choose your own model across', 'GPT, Grok, and Claude.'],
        body: [
          'Instead of hunting through ten browser tabs and different apps to remember what you set running.',
        ],
      },
      canon: {
        headline: ['Launch from one place.'],
        body: [
          'Claude Code, Codex, OpenCode, Grok Build and OpenClaw, on the plan you already pay for.',
        ],
      },
    },
  },
  {
    id: 'download',
    panel: 'center',
    highlight: {},
    card: false,
    focus: 'fleet',
    labels: false,
    copy: {
      deck: {
        headline: ['Try Exawatt for free'],
        body: ['Be first in line when Exawatt opens.'],
      },
      canon: {
        headline: ['The economy is refactoring.'],
        body: ['Your tools need to keep up.'],
      },
    },
  },
];

/**
 * The rail (W15d, operator 2026-10-09: "it definitely does not feel like
 * it's on rails, predictable, or smooth as I scroll between states").
 *
 * Every stage holds still for the first and last quarter of its screen and
 * the move to the next stage runs through the middle half on one ease. The
 * camera, the tile states, the fleet growth and the recede all read this one
 * blend, so nothing changes on a schedule of its own. Growth gets a wider
 * window because three hundred agents arriving in half a screen is a jolt.
 */
interface RailWindow {
  start: number;
  end: number;
}

/** How much of a stage's screen holds still on each side of the move. The
 *  scroll maps pinned travel from the end of the first dwell to the start of
 *  the last, so there is no dead scroll at either end of the page. */
export const RAIL_DWELL = 0.25;
const RAIL_WINDOW: RailWindow = { start: RAIL_DWELL, end: 1 - RAIL_DWELL };

interface StageBlend {
  from: number;
  to: number;
  /** 0 at `from`, 1 at `to`, eased. */
  t: number;
}

export function stageBlend(
  progress: number,
  window: RailWindow = RAIL_WINDOW,
  out: StageBlend = { from: 0, to: 0, t: 0 }
): StageBlend {
  const last = STAGES.length - 1;
  const p = Math.max(0, Math.min(last, progress));
  const from = Math.min(last - 1, Math.floor(p));
  const frac = p - from;
  const x = Math.max(
    0,
    Math.min(1, (frac - window.start) / (window.end - window.start))
  );
  out.from = from;
  out.to = from + 1;
  out.t = x * x * (3 - 2 * x);
  return out;
}

/** The stage on screen: the next one from the middle of the move. */
export function stageAt(progress: number): number {
  const b = stageBlend(progress);
  return b.t < 0.5 ? b.from : b.to;
}

export function panelSide(stage: Stage): -1 | 0 | 1 {
  return stage.panel === 'right' ? 1 : stage.panel === 'left' ? -1 : 0;
}

export function stageIndex(id: StageId): number {
  return STAGES.findIndex(stage => stage.id === id);
}

/** Launch band chips: the sources the shipped page already names. */
export const LAUNCH_SOURCES = [
  'Claude Code',
  'Codex',
  'OpenCode',
  'Grok Build',
  'OpenClaw',
];
