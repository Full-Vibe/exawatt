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

export type StageId =
  | 'landing'
  | 'working'
  | 'needs-you'
  | 'third'
  | 'fleet'
  | 'launch'
  | 'download';

export type CopySetId = 'deck' | 'canon';

export interface StageCopy {
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
  /** The visual grows to the full fleet on this stage. */
  growToFleet: boolean;
  copy: Record<CopySetId, StageCopy>;
}

export const STAGES: Stage[] = [
  {
    id: 'landing',
    panel: 'center-top',
    highlight: {},
    card: false,
    growToFleet: false,
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
    growToFleet: false,
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
    growToFleet: false,
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
    growToFleet: false,
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
    growToFleet: true,
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
    growToFleet: true,
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
    growToFleet: true,
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
