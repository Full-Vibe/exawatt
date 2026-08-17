import { bandById, countWords, type BandId } from './manifest';
import { THESIS_LINES } from './narrative-copy';

/**
 * The pinned sequence's panels (ENG-031 W4, rewritten W5, widened W8).
 *
 * ONE graphic, eight explanations. Each panel says what the board is doing
 * WHILE the board does it, and names the thing it is pointing at. The names
 * and the numbers are never written here: `hero-board-highlight.ts` and
 * `hero-board-lens.ts` read them off the frozen capture, so the copy and the
 * picture cannot drift apart, and a regenerated capture can never make a
 * sentence false.
 *
 * WHY THIS FILE GREW (operator, 2026-08-17): "I don't see why we shouldn't
 * keep it onscreen to help communicate some of the other points too, like
 * security, spend, etc. ... the colour section clearly would benefit with that
 * copy appearing alongside the actual product fleet board - why take it away".
 * W5 handed provenance, spend and ownership to card chapters below the board
 * on the reasoning that they "are not spatial". They are: a harness is a
 * property of every mark, burn is a property of every mark, and an approval
 * choice is a property of every mark. Their copy moved here, onto the panels
 * that drive those lenses, and three full screens came off the page.
 *
 * THE ARGUMENT, one panel at a time, each one a claim the board is
 * simultaneously proving:
 *
 * 1. `thesis` WHY. The foil, named: the tools, never the reader. Said over the
 *    counter-example rather than one screen before it.
 * 2. `altitude-fleet` SCALE. A fleet is a thing that fits on one screen, and
 *    it keeps fitting as it grows.
 * 3. `altitude-attention` ATTENTION, and why the colour can be trusted. The
 *    camera holds still; the board recedes to the agents waiting on a person.
 * 4. `altitude-agent` DEPTH. One dive, through the project, down to one agent
 *    whose status changes while it is read.
 * 5. `altitude-delegation` TRAJECTORY. Agents run agents, and the camera opens
 *    back out while the constellations bloom.
 * 6. `any-lab` PROVENANCE. The fleet recolours by the harness running each
 *    agent, so vendor neutrality proves itself.
 * 7. `cost` SPEND. The same marks, read as burn.
 * 8. `trust` OWNERSHIP. Whose machine, whose keys, whose repo.
 *
 * RULES, all inherited and all asserted in `altitude-copy.test.ts`:
 *
 * - each panel's declared `copyBudget`, counted with its heading and cards;
 * - no em dashes (operator: "that's an AI smell");
 * - the reader is never the bottleneck; the tools are (`marketing.md`);
 * - never the five words banned from the fold, on the same merits;
 * - never a Project name, an Agent name, or a count. Those come from the
 *   capture through the panel's subject line and its legend, which is why a
 *   regenerated fixture cannot turn a sentence into a lie.
 *
 * ASPIRATION LEADS (operator, 2026-08-17). Future tense is a first-class
 * register here. The one line the copy does not cross is a false SPECIFIC
 * FACTUAL CLAIM ABOUT PRESENT BEHAVIOUR, and every present-tense mechanism
 * below was read out of the code rather than remembered:
 * `electron/main/pty/attention-monitor.ts`,
 * `src/components/workspace/session-status.ts`,
 * `contracts/agent-sources.json`, `packages/core/src/consumption/`, and the
 * `/download` disclosures.
 */

/** One checkable mechanism under a panel's claim. States a fact or a control,
 *  never a confession (`marketing.md`, "Disclosure is not apology"). */
export interface PanelCard {
  title: string;
  body: string;
}

export interface AltitudePanelCopy {
  /** Band id, so the panel and its declaration cannot separate. */
  id: BandId;
  /** The panel's body, one entry per rendered line. */
  copy: string[];
  /** Up to THREE mechanisms, and three is a hard ceiling rather than a target.
   *  The panel sits over the board, and on a 390px phone it sits over the
   *  board's lower half: a fourth card pushed the claim off the top of the
   *  viewport, which is how a demo surface stops demonstrating anything. */
  cards?: PanelCard[];
  /** One quiet line under the cards. */
  coda?: string;
}

export const ALTITUDE_PANELS: AltitudePanelCopy[] = [
  {
    // THE FOIL, THEN THE ANSWER, in one panel (W8).
    //
    // `THESIS_LINES` is the only abstract passage on the page and it exists to
    // name the foil before the board becomes evidence: without a claim in the
    // reader's head, every panel afterwards is a caption. W5 spent a whole
    // screen on it. It does the same job as the lede of the first panel over
    // the board, and it does it better, because the reader meets "a terminal
    // tab still holds one agent" while looking at 173 of them at once.
    id: 'altitude-fleet',
    copy: [
      ...THESIS_LINES,
      'Each mark is one agent on one real assignment. Add a hundred more and it is still one screen.',
    ],
  },
  {
    id: 'altitude-attention',
    copy: [
      'The board tells you where to look, so you never go looking.',
      'Agents waiting on a person are the only loud thing on it. Every colour here is a claim, and a wrong one costs you a trip.',
    ],
    cards: [
      {
        title: 'Needs you means a gate',
        body: 'A question, a permission prompt, or a tool waiting on an answer. Reported by the agent, not guessed from its output.',
      },
      {
        title: 'Finished is not an interruption',
        body: 'A completed turn is a result you can read later. It never jumps the queue ahead of work that is blocked.',
      },
      {
        title: 'Silence gets corrected',
        body: 'Interrupt an agent and its harness may never close the turn. Exawatt notices the quiet and stops the light spinning.',
      },
    ],
    coda: 'Reported outranks inferred, in both directions.',
  },
  {
    id: 'altitude-agent',
    copy: [
      'Drop into one project and its agents are still individuals, not a count.',
      'Down to one: a name, the work it is on, and a status that changes while you read it.',
      'Working, needs you, done. Never a green check that lies.',
    ],
  },
  {
    id: 'altitude-delegation',
    copy: [
      'Some of these agents are running agents of their own.',
      'The work fans out and comes back under the one that asked for it. This is how ten becomes ten thousand.',
    ],
    cards: [
      {
        title: 'A parent waits for its children',
        body: 'Work that fanned out keeps reading as working until the last delegated run stops.',
      },
    ],
  },
  {
    id: 'any-lab',
    copy: [
      'Every lab will sell you agents. None of them will sell you the seat you command them from.',
      'The same board, coloured by what is running each agent.',
    ],
    cards: [
      {
        title: 'Four harnesses today',
        body: 'Claude Code, Codex, OpenCode and Grok Build. Launch one, resume it, and watch the subagents it spawns appear underneath it.',
      },
      {
        title: 'OpenClaw lands next',
        body: 'The adapter lane is open, and one harness across many providers means changing model is not changing your workflow.',
      },
      {
        title: 'Start one in a keystroke',
        body: 'Press ⌘T and type. Change the whole engine with ⌥ and the arrow keys before you type a word.',
      },
    ],
    coda: 'Bring the plan you already have. Exawatt never asks you for a token balance of its own.',
  },
  {
    id: 'cost',
    copy: [
      'A fleet spends whether or not you are watching.',
      'Same marks, read as burn. Exawatt parses the usage records your harnesses already write to your own disk. Read only, no credentials, no call to a billing API.',
    ],
    cards: [
      {
        title: 'Per agent, subagents included',
        body: 'A parent that delegates spends more than it reports, so its delegated runs are counted with it.',
      },
      {
        title: 'One unit across harnesses',
        body: 'Three harnesses disagree about what an input token even is. Exawatt normalizes them before adding anything up.',
      },
      {
        title: 'Modelled money says so',
        body: 'A dollar figure is an estimate with its price table printed beside it. Plan credits are read separately and never summed into it.',
      },
    ],
    coda: 'Absent is never zero. A harness that records nothing reads as unmetered, not as free.',
  },
  {
    id: 'trust',
    copy: [
      'Every one of these agents runs on your Mac, under your own account, on the keys you already pay for.',
      'Signing in does not change that arrangement.',
    ],
    cards: [
      {
        title: 'Your agents talk to providers directly',
        body: 'Your code, your prompts, and your agents output never pass through Exawatt.',
      },
      {
        title: 'Every outbound feature has a switch',
        body: 'Naming and summarizing sessions sends short excerpts with secrets redacted first, and it turns off in Settings under Privacy.',
      },
      {
        title: 'Approval is a per-agent choice',
        body: 'Agents start with approvals off so a fleet keeps moving. Ask first and Auto review are one choice away, on any agent.',
      },
    ],
    coda: 'Shared project memory is plain git files you already own. Every line here names something you can switch off or take with you.',
  },
];

export function altitudePanel(id: BandId): AltitudePanelCopy | undefined {
  return ALTITUDE_PANELS.find(panel => panel.id === id);
}

/** Reading words in a panel: its heading, body, cards and coda. */
export function panelWords(panel: AltitudePanelCopy): number {
  return countWords(
    [
      bandById(panel.id).heading ?? '',
      ...panel.copy,
      ...(panel.cards ?? []).flatMap(card => [card.title, card.body]),
      panel.coda ?? '',
    ].join(' ')
  );
}

/** Every word a reader reads across the whole pinned run. */
export function pinnedRunWords(): number {
  return ALTITUDE_PANELS.reduce((total, panel) => total + panelWords(panel), 0);
}

/** Everything a reader reads in the panel layer, for a lint pass. */
export function panelProse(): string {
  return ALTITUDE_PANELS.flatMap(panel => [
    ...panel.copy,
    ...(panel.cards ?? []).flatMap(card => [card.title, card.body]),
    panel.coda ?? '',
  ]).join(' ');
}
