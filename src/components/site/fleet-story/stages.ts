/**
 * The scroll story (ENG-031 W15), taken from the design partner's structure
 * (Figma "Exawatt Website Structure", slides 15 to 21, 2026-09-11): a landing
 * over one globe, three dissections of it by agent state with a panel pointed
 * at a real agent, and a zoom-out to the whole fleet that ends the story with
 * the download over it. (The deck's launch band, a composer and a row of
 * harness names, is gone: the operator, 2026-10-13, "doesn't seem to
 * communicate much", and the harness is now the mark on every tile. Its
 * download scene is folded into the fleet: "Combine the last two slides. We
 * don't need zoom level 6. Instead end at zoom level 5. With the CTA overlay
 * atop.") Her order starts inside one Project and
 * arrives at the Fleet last; the band homepage (deleted in W31) ran the other way. Per the
 * operator (2026-09-13) the order was hers to resolve, so this study follows
 * the deck.
 *
 * Two copy sets, switchable on the page:
 * - `deck`  the deck's own lines, verbatim where it has them. Its third
 *           dissection is "queued", which is not a product status; the study
 *           lights the `off` signal for it.
 * - `canon` the same beats on the operator's frame: one agent at work, the
 *           agents that need you, then every kind of agent at work side by
 *           side (operator 2026-10-14: "use these slides to explain other
 *           value props"), each lifted by the product's own signals.
 *
 * No em dashes. The reader is never the bottleneck.
 */

import type { StatusLightState } from '@/components/status-light/protocol';
import type { FleetAgent } from './fleet-model';

export type StageId = 'landing' | 'working' | 'needs-you' | 'third' | 'fleet';

export type CopySetId = 'deck' | 'canon';

interface StageCopy {
  kicker?: string;
  headline: string[];
  body?: string[];
}

export interface Stage {
  id: StageId;
  /** Where the reading column sits while the stage is on screen. */
  panel: 'center-top' | 'right' | 'left';
  /** Which signal the visual lifts and the panel points at, if any. */
  highlight: Partial<Record<CopySetId, StatusLightState>>;
  /** The harness the card's agent runs, where the scene is about the kind
   *  of agent rather than its signal alone. */
  exemplarSource?: Partial<Record<CopySetId, string>>;
  /** Whether the agent card is shown: the stage's exemplar until the reader
   *  picks another agent, which it then shows instead (W15i). */
  card: boolean;
  /** Whether the download stands under the copy. */
  cta: boolean;
  /** What the camera fits: the whole fleet, or the first Project close.
   *  The page opens on the fleet, the dissections go in, the fleet stage
   *  comes all the way back out (operator 2026-10-09). */
  focus: 'fleet' | 'project';
  /** Project names over the world. Off under centred type. */
  labels: boolean;
  /** Agents on screen. The story opens on ten, closes in on one, and grows
   *  from there to the whole fleet (operator 2026-10-12: "show 10 agents in
   *  the very first slide... zoom in and cut the count down to just one...
   *  zoom out and subsequently pop up 100... some narrative that can also
   *  visually illustrate the quantity expanding"). */
  count: number;
  copy: Record<CopySetId, StageCopy>;
}

export const STAGES: Stage[] = [
  {
    id: 'landing',
    panel: 'center-top',
    highlight: {},
    card: false,
    // the download waits for the end of the story (operator 2026-10-14:
    // "Remove the CTA from the first slide")
    cta: false,
    focus: 'fleet',
    labels: false,
    count: 10,
    // The promise, then what it is (operator 2026-10-14, keeping the scale
    // angle for the homepage: "Make the scene 1 H1 'Scale your agent
    // fleet'"; and on the line under it, which read as a list: "Maybe in
    // scene 1 it should be: Exawatt is the command surface for your agent
    // fleet", then, so it does not repeat the title, "for every agent you
    // run": "yes I like that"). The deck keeps the line it had, to compare.
    copy: {
      deck: {
        headline: ['The command interface for your agent fleet.'],
        body: ['Today you run 10 agents.', 'Tomorrow you will run 10,000.'],
      },
      canon: {
        headline: ['Scale your agent fleet.'],
        body: ['Exawatt is the command surface for every agent you run.'],
      },
    },
  },
  {
    id: 'working',
    panel: 'right',
    highlight: { deck: 'active', canon: 'active' },
    card: true,
    cta: false,
    focus: 'project',
    labels: true,
    count: 1,
    copy: {
      deck: {
        headline: ["Easily see each agent's", 'working status'],
        body: ['From credit usage, to time spent.'],
      },
      // what the card shows, and nothing after it (operator 2026-10-14:
      // "Remove the copy 'Without opening a single one.'")
      canon: {
        headline: ['Every agent, at a glance.'],
        body: ['What it is doing, on which model, and what it has spent.'],
      },
    },
  },
  {
    id: 'needs-you',
    panel: 'left',
    highlight: { deck: 'needs-you', canon: 'needs-you' },
    card: true,
    cta: false,
    focus: 'project',
    labels: true,
    count: 10,
    copy: {
      deck: {
        headline: ['The agents that need', 'you, surfaced.'],
        body: ['Flags the moment an agent needs a human to take actions.'],
      },
      // why it matters, not what happens (operator 2026-10-14: "the ones
      // waiting on you light up... change the word ones to something more
      // specific or... mention why that matters")
      canon: {
        headline: ['Never leave an agent waiting.'],
        body: [
          'When one needs an answer, a permission, or a decision, it lights up.',
          'Answer it and it gets straight back to work.',
        ],
      },
    },
  },
  {
    id: 'third',
    panel: 'right',
    highlight: { deck: 'off', canon: 'active' },
    // the agent in the card runs another harness than the one before it
    exemplarSource: { canon: 'Codex' },
    card: true,
    cta: false,
    focus: 'project',
    labels: true,
    count: 100,
    copy: {
      deck: {
        headline: ['Queued agents orbit', 'the core'],
        body: [
          'Work that is waiting stays in plain sight, and drops into the fleet the moment capacity frees up.',
        ],
      },
      // any harness, side by side (operator 2026-10-14: "a huge value prop
      // of Exawatt to be able to bring your own agents of any type, run
      // them all together, and see them all executing in the same place";
      // and on its title, "Every kind of agent -> 'Every species of
      // agent'")
      //
      // ENG-031 W23 (operator 2026-10-19: "yes if succinct - not too much
      // copy"): Gemini by name, and the messaging only as far as it is
      // proven. Claude Code and Codex were measured messaging each other in
      // the app (2026-10-15), and Gemini and Codex both ways (2026-10-19).
      canon: {
        headline: ['Every species of agent,', 'side by side.'],
        body: [
          'Bring Claude Code, Codex, Gemini, OpenClaw, or your own.',
          'Your Claude Code, Codex and Gemini agents message each other.',
        ],
      },
    },
  },
  {
    id: 'fleet',
    panel: 'center-top',
    highlight: {},
    card: false,
    cta: true,
    focus: 'fleet',
    labels: true,
    count: 300,
    copy: {
      deck: {
        headline: ['All your fleets in one view.'],
        body: [
          'Zoom out and every project is there. Zoom in and nothing is hidden.',
        ],
      },
      // the close: what it is at scale, and what it costs to start
      // (operator 2026-10-14: "Maybe say Fleet command for thousands of
      // agents")
      canon: {
        headline: ['Fleet command for thousands of agents.'],
        body: [
          'Free and open source. Works with the plans you already pay for.',
        ],
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
 * camera, the tile states and the fleet growth all read this one blend, so
 * nothing changes on a schedule of its own.
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

/**
 * A stage blend leaned toward the scene a push asks for (W15i): `lean` is a
 * signed share of the move in the blend's own eased terms. Forward from a
 * scene the camera starts toward the next one; back from a scene it starts
 * toward the one before, which is the blend that ends here, run backward.
 * A lean never pulls the camera behind where a move has already taken it.
 */
export function leanBlend(
  b: StageBlend,
  lean: number,
  out: StageBlend
): StageBlend {
  out.from = b.from;
  out.to = b.to;
  out.t = b.t;
  if (lean > 0) {
    // a scene reached from below is the end of the blend before it: lean
    // from the scene itself into the next (the camera's eased progress
    // settles a hair short of a whole scene and never reaches it)
    if (b.t === 1 && b.to < STAGES.length - 1) {
      out.from = b.to;
      out.to = b.to + 1;
      out.t = lean;
    } else out.t = Math.max(b.t, lean);
  } else if (lean < 0) {
    if (b.t === 0 && b.from > 0) {
      out.from = b.from - 1;
      out.to = b.from;
      out.t = 1 + lean;
    } else out.t = Math.min(b.t, 1 + lean);
  }
  return out;
}

/**
 * How much of a lean a push shows: steep at first, so the first few pixels
 * of a gesture already move the page (Android's predictive back shapes its
 * preview the same way, "so that the gesture is more apparent in the
 * beginning"), and level as it nears a whole move.
 */
export function leanCurve(intent: number): number {
  const x = Math.min(1, Math.abs(intent));
  return 1 - (1 - x) ** 3;
}

/** The stage on screen: the next one from the middle of the move. */
export function stageAt(progress: number): number {
  const b = stageBlend(progress);
  return b.t < 0.5 ? b.from : b.to;
}

export function panelSide(stage: Stage): -1 | 0 | 1 {
  return stage.panel === 'right' ? 1 : stage.panel === 'left' ? -1 : 0;
}

/** The agent a scene's card shows until the reader picks one: the first
 *  in the first Project with the scene's signal (and the scene's harness,
 *  where it names one), so it is always in the frame the camera fits. */
export function exemplarFor(
  agents: FleetAgent[],
  count: number,
  status: StatusLightState | null,
  source?: string
): number {
  if (!status) return -1;
  const n = Math.min(count, agents.length);
  const fits = (agent: FleetAgent) =>
    agent.status === status && (!source || agent.source === source);
  for (let i = 0; i < n; i += 1)
    if (fits(agents[i]) && agents[i].project === 0) return i;
  for (let i = 0; i < n; i += 1) if (fits(agents[i])) return i;
  return source ? exemplarFor(agents, count, status) : -1;
}
