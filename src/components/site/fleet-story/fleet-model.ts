/**
 * The study fleet (ENG-031 W15).
 *
 * One synthetic, seeded fleet that every visual option in the study renders,
 * so the options are judged on rendering and not on data. Three properties
 * are load-bearing:
 *
 * - **Stable under growth.** The fleet is laid out ONCE at its maximum size
 *   and a smaller count is a prefix of that layout. Growing from 10 to 300
 *   adds marks; it never moves one. The operator's brief for the visual is a
 *   territory that expands as the fleet grows and collapses as it shrinks,
 *   which only reads if the agents already there hold still.
 * - **Project-major order.** The first agents all belong to the first
 *   Project, so a fleet of one is one Project with one agent and a little
 *   surrounding territory, not ten Projects with a tenth of an agent each.
 * - **The product's own five signals.** Status is the D40 light vocabulary
 *   (`active`, `needs-you`, `result`, `off`, `fault`), coloured by the same
 *   resolved theme the production board uses. The deck's third highlight,
 *   "queued", has no product status; the study maps it to `off`.
 *
 * Everything here is honest synthetic data and is labelled so on the page.
 */

import type { StatusLightState } from '@/components/status-light/protocol';
import { hexSpiral, type Axial } from './hex';

export const FLEET_MAX = 300;

/** Fleet sizes the study is judged at (operator, 2026-09-11: a first user
 *  has one to ten, not ten thousand). */
const FLEET_COUNTS = [1, 10, 100, 300] as const;
type FleetCount = (typeof FLEET_COUNTS)[number];

interface FleetProject {
  id: number;
  name: string;
  /** Hex axial centre on the shared grid. */
  center: Axial;
  /** Tiles in this Project's spiral at full size, agent tiles first. */
  capacity: number;
  /** Rings the full-size spiral occupies (0 = one tile). */
  rings: number;
  /** Index range into `agents`, project-major. */
  first: number;
  count: number;
}

export interface FleetAgent {
  id: number;
  project: number;
  name: string;
  /** What it says it is doing: the step it is on while it works, or what
   *  it waits for. */
  doing: string;
  /** Its goal's way there, in order (`TASKS`), where the fleet knows it.
   *  While it works `doing` is one of them, and its card steps on from
   *  there. */
  steps?: string[];
  status: StatusLightState;
  source: string;
  /** The model it runs, or null where its vendor names none. */
  model: string | null;
  /** 0..1 share of the plan window this agent has spent. */
  burn: number;
  /** Minutes at work this session. */
  minutes: number;
  /** Hex axial position on the shared grid. */
  tile: Axial;
  /** Ring distance from the Project centre. */
  ring: number;
  /** Delegated children, 0 for most. Children are marks around the parent,
   *  never tiles of their own. */
  children: number;
}

interface FleetTile {
  axial: Axial;
  project: number;
  /** Index into `agents`, or -1 for a territory tile with no agent. */
  agent: number;
  ring: number;
}

export interface FleetModel {
  projects: FleetProject[];
  agents: FleetAgent[];
  /** Every tile any Project can ever claim, at full size. */
  tiles: FleetTile[];
}

const PROJECT_NAMES = [
  'Product launch',
  'Marketing',
  'Sales',
  'Design',
  'Finance',
  'Support',
  'Hiring',
  'Research',
  'Operations',
  'Home',
];

/** Agents per Project at full size. Sums to FLEET_MAX; the first is large
 *  enough that the ten-agent fleet is one Project. */
const PROJECT_SIZES = [34, 22, 46, 18, 28, 40, 31, 26, 35, 20];

/**
 * What the agents are doing, per Project, in the words their owner would
 * use (operator 2026-10-12: "more high-level and less geeky / technical.
 * Like marketing, sales tasks, in addition to product engineering. Maybe
 * personal admin as well... in their own project zone"). The first Project
 * is the one the dissections open on; the personal admin lives in the last.
 *
 * Each goal carries its way there, step by step, as an agent at work would
 * report it (operator 2026-10-14: "show that text scrolling by... the way
 * ChatGPT or Claude clients show thinking... a series of tasks"): the card
 * of a working agent steps through them.
 */
interface Task {
  goal: string;
  steps: string[];
}

const TASKS: Task[][] = [
  [
    {
      goal: 'Ship passkey sign-in',
      steps: [
        'Reading the brief',
        'Finding the sign-in code',
        'Adding passkey support',
        'Writing the tests',
        'Running the tests',
        'Opening a pull request',
      ],
    },
    {
      goal: 'Rewrite the onboarding',
      steps: [
        'Walking through the current flow',
        'Noting where people drop off',
        'Drafting the new screens',
        'Rewriting the welcome copy',
        'Trying it on a fresh account',
      ],
    },
    {
      goal: 'Fix checkout on Safari',
      steps: [
        'Reproducing the bug in Safari',
        'Reading the checkout code',
        'Finding the cause',
        'Writing the fix',
        'Checking it in Safari and Chrome',
      ],
    },
    {
      goal: 'Make the first load fast',
      steps: [
        'Measuring the first load',
        'Finding the slowest parts',
        'Trimming the bundle',
        'Deferring the heavy scripts',
        'Measuring again',
      ],
    },
    {
      goal: 'Draft the launch post',
      steps: [
        'Reading the launch notes',
        'Outlining the post',
        'Writing the first draft',
        'Adding the screenshots',
        'Tightening the copy',
      ],
    },
    {
      goal: 'Cut the release',
      steps: [
        'Collecting the merged changes',
        'Writing the release notes',
        'Bumping the version',
        'Building the release',
        'Publishing the release',
      ],
    },
    {
      goal: 'Write the migration guide',
      steps: [
        'Listing what changed',
        'Outlining the guide',
        'Writing each step',
        'Testing the code samples',
        'Asking for a review',
      ],
    },
    {
      goal: 'Test the upgrade path',
      steps: [
        'Installing the old version',
        'Adding sample data',
        'Running the upgrade',
        'Checking nothing was lost',
        'Writing up the results',
      ],
    },
    {
      goal: 'Finish the new pricing page',
      steps: [
        'Reading the pricing brief',
        'Laying out the plans',
        'Writing the plan copy',
        'Building the comparison table',
        'Checking it on a phone',
      ],
    },
    {
      goal: 'Close the launch bugs',
      steps: [
        'Sorting the open bugs',
        'Picking the next one',
        'Writing the fix',
        'Running the tests',
        'Closing the ticket',
      ],
    },
    {
      goal: 'Record the product tour',
      steps: [
        'Writing the script',
        'Setting up a clean demo account',
        'Recording each scene',
        'Cutting the takes together',
        'Adding the captions',
      ],
    },
    {
      goal: 'Tidy the settings screen',
      steps: [
        'Auditing every setting',
        'Grouping related options',
        'Rewriting the labels',
        'Cleaning up the layout',
        'Checking it on a phone',
      ],
    },
  ],
  [
    {
      goal: 'Write the launch email',
      steps: [
        'Reading the launch notes',
        'Picking the angle',
        'Drafting the subject lines',
        'Writing the email',
        'Sending a test to the team',
      ],
    },
    {
      goal: 'Refresh the homepage copy',
      steps: [
        'Reading the current page',
        'Reviewing what customers say',
        'Drafting new headlines',
        'Rewriting each section',
        'Marking up the changes',
      ],
    },
    {
      goal: 'Plan the April webinar',
      steps: [
        'Picking the topic',
        'Drafting the agenda',
        'Inviting the speakers',
        'Writing the invitation',
        'Setting up registration',
      ],
    },
    {
      goal: 'Draft three ad variants',
      steps: [
        'Reading the campaign brief',
        'Studying past winners',
        'Writing three headlines',
        'Drafting the body copy',
        'Sizing them for each channel',
      ],
    },
    {
      goal: 'Summarize last week',
      steps: [
        "Pulling last week's numbers",
        'Reading the campaign notes',
        'Finding what moved',
        'Writing the summary',
        'Posting it for the team',
      ],
    },
    {
      goal: 'Post the changelog',
      steps: [
        "Collecting this week's changes",
        'Writing each entry',
        'Adding the screenshots',
        'Proofreading',
        'Publishing the changelog',
      ],
    },
    {
      goal: 'Cut the demo into clips',
      steps: [
        'Watching the full demo',
        'Marking the best moments',
        'Cutting the clips',
        'Adding the captions',
        'Exporting for each channel',
      ],
    },
    {
      goal: 'Pitch two newsletters',
      steps: [
        'Finding the right newsletters',
        'Reading recent issues',
        'Drafting the pitches',
        'Tailoring each one',
        'Sending the pitches',
      ],
    },
    {
      goal: 'Update the case studies',
      steps: [
        'Reviewing each case study',
        'Collecting new results',
        'Updating the numbers',
        'Refreshing the quotes',
        'Sending them for approval',
      ],
    },
  ],
  [
    {
      goal: "Qualify this morning's leads",
      steps: [
        'Reading the new leads',
        'Looking up each company',
        'Scoring the fit',
        'Flagging the best five',
        'Updating the pipeline',
      ],
    },
    {
      goal: 'Draft the Acme proposal',
      steps: [
        'Reading the call notes',
        'Outlining the proposal',
        'Pricing the options',
        'Writing the draft',
        'Sending it for review',
      ],
    },
    {
      goal: 'Prep the Tuesday demo',
      steps: [
        'Reading up on the account',
        'Building a demo workspace',
        'Writing the talk track',
        'Rehearsing the flow',
        'Sending the agenda',
      ],
    },
    {
      goal: 'Follow up with trials',
      steps: [
        'Listing the active trials',
        'Checking who is stuck',
        'Drafting each follow-up',
        'Personalizing the notes',
        'Sending the emails',
      ],
    },
    {
      goal: 'Update the pipeline',
      steps: [
        'Reviewing every open deal',
        'Moving deals to their stage',
        'Logging the latest calls',
        'Flagging the stalled deals',
        'Rolling up the forecast',
      ],
    },
    {
      goal: 'Research ten prospects',
      steps: [
        'Building the list',
        "Reading each company's site",
        'Finding the right contact',
        'Noting a reason to reach out',
        'Adding them to the pipeline',
      ],
    },
    {
      goal: 'Answer the security questionnaire',
      steps: [
        'Reading the questionnaire',
        'Reusing past answers',
        'Drafting the new answers',
        'Flagging two for engineering',
        'Filling in the form',
      ],
    },
    {
      goal: 'Renew the Northwind contract',
      steps: [
        'Reviewing the current contract',
        'Checking their usage',
        'Drafting the renewal terms',
        'Preparing the quote',
        'Sending it for signature',
      ],
    },
    {
      goal: 'Write the quarterly recap',
      steps: [
        "Pulling the quarter's numbers",
        'Listing the big wins',
        'Noting what slipped',
        'Writing the recap',
        'Making the slides',
      ],
    },
    {
      goal: 'Book the conference meetings',
      steps: [
        'Listing who is attending',
        'Picking the accounts to meet',
        'Drafting the invitations',
        'Sending the invitations',
        'Building the schedule',
      ],
    },
  ],
  [
    {
      goal: 'Redesign the settings page',
      steps: [
        'Auditing the current page',
        'Sketching new layouts',
        'Mocking up the best one',
        'Checking it against the design system',
        'Preparing the handoff',
      ],
    },
    {
      goal: 'Mock the mobile flow',
      steps: [
        'Mapping the flow',
        'Sketching each screen',
        'Building the mockups',
        'Linking a prototype',
        'Sharing it for feedback',
      ],
    },
    {
      goal: 'Tidy the icon set',
      steps: [
        'Auditing every icon',
        'Finding the duplicates',
        'Redrawing the odd ones out',
        'Matching the stroke weights',
        'Exporting the set',
      ],
    },
    {
      goal: 'Review the empty states',
      steps: [
        'Finding every empty state',
        'Capturing each one',
        'Noting what is missing',
        'Drafting better copy',
        'Mocking up the fixes',
      ],
    },
    {
      goal: 'Draft the brand refresh',
      steps: [
        'Gathering references',
        'Exploring colour palettes',
        'Trying type pairings',
        'Building a mood board',
        'Drafting the guidelines',
      ],
    },
    {
      goal: 'Audit the colour contrast',
      steps: [
        'Listing every screen',
        'Measuring the contrast',
        'Flagging what fails',
        'Suggesting new colours',
        'Writing up the fixes',
      ],
    },
  ],
  [
    {
      goal: 'Reconcile March invoices',
      steps: [
        'Pulling the March invoices',
        'Matching them to payments',
        'Flagging the mismatches',
        'Fixing the small ones',
        'Writing up the rest',
      ],
    },
    {
      goal: 'Forecast Q2 cash',
      steps: [
        'Pulling the bank balances',
        'Listing expected income',
        'Listing upcoming bills',
        'Building the forecast',
        'Writing the summary',
      ],
    },
    {
      goal: 'Chase overdue invoices',
      steps: [
        'Listing the overdue invoices',
        'Checking past reminders',
        'Drafting each reminder',
        'Sending the reminders',
        'Logging the replies',
      ],
    },
    {
      goal: 'Model the new pricing',
      steps: [
        'Pulling current revenue',
        'Building the model',
        'Running three scenarios',
        'Comparing the outcomes',
        'Writing the recommendation',
      ],
    },
    {
      goal: 'Prepare the board pack',
      steps: [
        'Pulling the monthly numbers',
        'Updating the charts',
        'Writing the commentary',
        'Assembling the deck',
        'Checking every figure',
      ],
    },
    {
      goal: 'Sort the expense reports',
      steps: [
        'Collecting the receipts',
        'Matching each receipt',
        'Flagging the missing ones',
        'Sorting the spend by category',
        'Submitting them for approval',
      ],
    },
    {
      goal: 'Close the books',
      steps: [
        'Reconciling the accounts',
        'Booking the accruals',
        'Checking the balances',
        'Running the reports',
        'Locking the month',
      ],
    },
  ],
  [
    {
      goal: 'Answer the ticket queue',
      steps: [
        'Reading the newest ticket',
        "Checking the customer's history",
        'Drafting a reply',
        'Linking the help article',
        'Sending the reply',
      ],
    },
    {
      goal: 'Find why exports fail',
      steps: [
        'Reading the failed exports',
        'Reproducing the failure',
        'Reading the logs',
        'Finding the cause',
        'Writing up the fix',
      ],
    },
    {
      goal: 'Triage the morning bugs',
      steps: [
        'Reading the new reports',
        'Reproducing each one',
        'Ranking them by impact',
        'Filing the tickets',
        'Assigning owners',
      ],
    },
    {
      goal: 'Write the refund macro',
      steps: [
        'Reading the refund policy',
        'Reviewing past replies',
        'Drafting the macro',
        'Trying it on old tickets',
        'Saving it for the team',
      ],
    },
    {
      goal: 'Call back the enterprise accounts',
      steps: [
        'Listing who asked for a call',
        "Reading each account's history",
        'Preparing the notes',
        'Booking the calls',
        'Logging the outcomes',
      ],
    },
    {
      goal: 'Update the help centre',
      steps: [
        'Finding outdated articles',
        'Checking each one against the app',
        'Rewriting the steps',
        'Updating the screenshots',
        'Publishing the changes',
      ],
    },
    {
      goal: 'Summarize the weekly complaints',
      steps: [
        "Reading this week's tickets",
        'Grouping them by theme',
        'Counting each theme',
        'Pulling example quotes',
        'Writing the summary',
      ],
    },
  ],
  [
    {
      goal: 'Screen the designer applicants',
      steps: [
        'Reading each application',
        'Reviewing the portfolios',
        'Scoring them against the role',
        'Shortlisting the top five',
        'Writing the notes',
      ],
    },
    {
      goal: 'Schedule the panel',
      steps: [
        "Checking everyone's calendar",
        'Finding a shared slot',
        'Booking the room',
        'Sending the invitations',
        'Sharing the interview guide',
      ],
    },
    {
      goal: 'Draft the offer letter',
      steps: [
        'Reading the approved terms',
        'Starting from the template',
        'Filling in the details',
        'Checking the numbers',
        'Sending it for approval',
      ],
    },
    {
      goal: 'Write the job post',
      steps: [
        'Reading the role brief',
        'Studying similar posts',
        'Drafting the post',
        'Tightening the requirements',
        'Sending it for review',
      ],
    },
    {
      goal: 'Check the references',
      steps: [
        'Reading the reference list',
        'Drafting the questions',
        'Booking the calls',
        'Writing up each call',
        'Summarizing what we heard',
      ],
    },
    {
      goal: 'Plan the onboarding week',
      steps: [
        'Listing the first-week tasks',
        'Setting up the accounts',
        'Booking the intro meetings',
        'Writing the welcome note',
        'Sharing the schedule',
      ],
    },
  ],
  [
    {
      goal: 'Compare the three vendors',
      steps: [
        "Reading each vendor's docs",
        'Listing the features',
        'Comparing the prices',
        'Checking the reviews',
        'Writing the comparison',
      ],
    },
    {
      goal: 'Summarize competitor pricing',
      steps: [
        'Visiting each pricing page',
        'Recording every plan',
        'Comparing the tiers',
        'Noting recent changes',
        'Writing the summary',
      ],
    },
    {
      goal: 'Read the new regulation',
      steps: [
        'Reading the regulation',
        'Highlighting what applies to us',
        'Listing the deadlines',
        'Drafting the action list',
        'Writing the brief',
      ],
    },
    {
      goal: 'Survey the churned accounts',
      steps: [
        'Listing the churned accounts',
        'Drafting the survey',
        'Sending it out',
        'Reading the answers',
        'Summarizing the reasons',
      ],
    },
    {
      goal: 'Map the market',
      steps: [
        'Listing the players',
        'Grouping them by segment',
        'Estimating their size',
        'Drawing the map',
        'Writing the takeaways',
      ],
    },
    {
      goal: 'Digest the user interviews',
      steps: [
        'Reading the transcripts',
        'Tagging the key moments',
        'Grouping the themes',
        'Pulling the best quotes',
        'Writing the digest',
      ],
    },
  ],
  [
    {
      goal: 'Renew the domains',
      steps: [
        'Listing every domain',
        'Checking the expiry dates',
        'Renewing the ones due',
        'Turning on auto-renew',
        'Filing the receipts',
      ],
    },
    {
      goal: 'Audit who has admin',
      steps: [
        'Listing every admin account',
        'Checking each one against the team',
        'Flagging the leftovers',
        'Removing stale access',
        'Writing up the audit',
      ],
    },
    {
      goal: 'Move the backups',
      steps: [
        'Checking the current backups',
        'Setting up the new storage',
        'Copying the backups across',
        'Verifying every file',
        'Switching the schedule over',
      ],
    },
    {
      goal: 'Rotate the keys',
      steps: [
        'Listing the keys that are due',
        'Generating new keys',
        'Updating each service',
        'Checking nothing broke',
        'Revoking the old keys',
      ],
    },
    {
      goal: 'Order the new laptops',
      steps: [
        'Confirming who needs one',
        'Comparing the models',
        'Getting the quote approved',
        'Placing the order',
        'Tracking the delivery',
      ],
    },
    {
      goal: 'Review the vendor bills',
      steps: [
        "Pulling this month's bills",
        'Comparing them to the contracts',
        'Flagging the surprises',
        'Finding what to cancel',
        'Writing the summary',
      ],
    },
    {
      goal: 'Plan the office move',
      steps: [
        'Listing what needs to move',
        'Getting moving quotes',
        'Picking the date',
        'Planning the new layout',
        'Sharing the plan',
      ],
    },
  ],
  [
    {
      goal: 'Find a two-bedroom near the office',
      steps: [
        'Setting up the search',
        'Reading the new listings',
        'Checking each commute',
        'Shortlisting five places',
        'Booking the viewings',
      ],
    },
    {
      goal: 'Book the Lisbon flights',
      steps: [
        'Checking your calendar',
        'Comparing the fares',
        'Picking the best times',
        'Holding two seats',
        'Sending you the options',
      ],
    },
    {
      goal: 'Compare car insurance quotes',
      steps: [
        'Gathering your car details',
        'Requesting the quotes',
        'Comparing the cover',
        'Comparing the prices',
        'Writing the recommendation',
      ],
    },
    {
      goal: 'Plan the birthday dinner',
      steps: [
        'Checking the guest list',
        'Finding restaurants nearby',
        'Comparing the menus',
        'Booking a table',
        'Sending the invitations',
      ],
    },
    {
      goal: 'Sort the tax documents',
      steps: [
        "Collecting this year's documents",
        'Sorting them by type',
        'Finding what is missing',
        'Filling in the checklist',
        'Sharing the folder',
      ],
    },
    {
      goal: 'Cancel the unused subscriptions',
      steps: [
        'Listing every subscription',
        'Checking which ones you use',
        'Finding each cancel page',
        'Ending the unused ones',
        'Adding up the savings',
      ],
    },
    {
      goal: 'Find a weekend plumber',
      steps: [
        'Searching for plumbers nearby',
        'Reading the reviews',
        'Checking who works weekends',
        'Comparing the rates',
        'Booking a visit',
      ],
    },
    {
      goal: 'Shortlist the summer camps',
      steps: [
        'Listing the camps nearby',
        'Checking the dates',
        'Comparing the prices',
        'Reading parent reviews',
        'Building the shortlist',
      ],
    },
  ],
];

/** What an agent that is not at work says it is doing: waiting on you, done
 *  and waiting for you, or idle. */
const WAITING = [
  'Waiting on your approval',
  'Needs a decision from you',
  'Blocked on a login',
];
const FINISHED = ['Ready for your review', 'Finished, waiting for you'];
const IDLE = 'Idle until the next turn';

/** The harnesses in the study fleet: the five the site names, each with
 *  the product's own adapter id so a surface can draw the vendor's mark. */
const SOURCES: { id: string; label: string }[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'grok', label: 'Grok Build' },
  { id: 'openclaw', label: 'OpenClaw' },
];

/**
 * Agents the product does not run yet (ENG-031 W15n, operator 2026-10-14:
 * "Homepage is aspirational and illustrative and I'll add support for them
 * soon"), each with the id its mark has in `concept-marks.ts`. They work in
 * Projects of their own kind, two harnesses to a Project as a team would
 * settle on: dots and Instinct book and chase for Sales, inside the
 * hundred, and Muse and Grok Bot answer for Support, the large Project the
 * close faces, so the scene with the download shows all four (W15m: in
 * Marketing they sat behind the globe there). The first Project, which the
 * landing and the close-ups show, runs the product's own five, and from the
 * hundred-agent scene on two Grok Bots work among them (`PROJECT_GUESTS`).
 */
const CONCEPT_SOURCES: { id: string; label: string }[] = [
  { id: 'grok-bot', label: 'Grok Bot' },
  { id: 'muse', label: 'Muse' },
  { id: 'instinct', label: 'Instinct' },
  { id: 'dots', label: 'dots' },
];

/** The concept harnesses a Project runs: the first its core, the second
 *  the rest. */
const CONCEPT_PROJECTS: Partial<Record<number, readonly [string, string]>> = {
  2: ['dots', 'Instinct'],
  5: ['Muse', 'Grok Bot'],
};
/** The share of a concept Project its first harness takes. */
const CONCEPT_CORE = 0.6;

/**
 * Concept agents at work in a Project of the product's harnesses, by
 * Project and the agent's place in it. Two Grok Bots work in the first
 * Project (operator 2026-10-14, on the scene that puts every species of
 * agent side by side: "add in a couple of Grok Bot agents"), so the close-up
 * that says so shows them among the product's five. Both are past the first
 * ten, which the landing and the close-ups were tuned on, so they arrive with
 * the hundred; both are at work, so the scene that lifts the agents at work
 * lifts them; and they stand one to a side of the Project's near edge, clear
 * of the Codex agent the scene's card points at and of the reading column.
 */
const PROJECT_GUESTS: Partial<
  Record<number, Readonly<Record<number, string>>>
> = {
  0: { 22: 'Grok Bot', 26: 'Grok Bot' },
};

function sourceFor(project: FleetProject, local: number, index: number) {
  const pair = CONCEPT_PROJECTS[project.id];
  if (pair)
    return pair[local < Math.round(project.count * CONCEPT_CORE) ? 0 : 1];
  return (
    PROJECT_GUESTS[project.id]?.[local] ??
    SOURCES[(index * 7 + project.id) % SOURCES.length].label
  );
}

const ALL_SOURCES = [...SOURCES, ...CONCEPT_SOURCES];

/** The adapter id behind a study agent's harness label, for the mark. */
export function sourceAdapterId(label: string): string {
  return ALL_SOURCES.find(source => source.label === label)?.id ?? label;
}

/** What each harness runs. For the concepts, only what the vendors say,
 *  and no version they have not named: Grok Bot runs xAI's Grok, Muse
 *  Meta's Muse Spark, each of OpenAI's dots GPT-6 Astra, and Instinct names
 *  no model. */
const MODELS: Record<string, string[]> = {
  'Claude Code': ['Fable 5.1', 'Opus 5.5', 'Sonnet 5.5'],
  Codex: ['GPT-6', 'GPT-6 mini'],
  OpenCode: ['Sonnet 5.5', 'Haiku 5.5'],
  'Grok Build': ['Grok 5'],
  OpenClaw: ['Opus 5.5'],
  'Grok Bot': ['Grok'],
  Muse: ['Muse Spark'],
  dots: ['GPT-6 Astra'],
};

/** Mulberry32: tiny, seeded, deterministic. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function statusFor(index: number, local: number, random: () => number) {
  // The ten-agent fleet must already show every signal the story needs.
  if (local === 0) return 'active';
  if (local === 2) return 'needs-you';
  if (local === 4) return 'result';
  if (local === 6) return 'off';
  const roll = random();
  if (roll < 0.55) return 'active';
  if (roll < 0.68) return 'needs-you';
  if (roll < 0.85) return 'result';
  if (roll < 0.97) return 'off';
  return index % 11 === 3 ? 'fault' : 'active';
}

/** Rings a spiral needs for `n` tiles: 1 + 3k(k+1) tiles fit in k rings. */
function ringsFor(n: number): number {
  let k = 0;
  while (1 + 3 * k * (k + 1) < n) k += 1;
  return k;
}

/** Planar centre of an axial tile, pointy-top, circumradius 1. */
export function axialToPlane(a: Axial): [number, number] {
  return [Math.sqrt(3) * (a.q + a.r / 2), 1.5 * a.r];
}

function planeToAxial(x: number, y: number): Axial {
  const r = y / 1.5;
  const q = x / Math.sqrt(3) - r / 2;
  // cube round
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

/**
 * Pack the Projects on the plane as circles, biggest first at the origin,
 * each next one walked around the cluster on a golden-angle spiral until it
 * clears every placed circle. Then snap to the hex grid.
 */
function packProjects(): FleetProject[] {
  const placed: { x: number; y: number; r: number }[] = [];
  const projects: FleetProject[] = [];
  let first = 0;
  const GAP = 1.4;
  for (let i = 0; i < PROJECT_SIZES.length; i += 1) {
    const count = PROJECT_SIZES[i];
    const rings = ringsFor(count) + 1; // one ring of territory around the agents
    const capacity = 1 + 3 * rings * (rings + 1);
    const radius = (rings + 0.5) * Math.sqrt(3);
    let center: Axial = { q: 0, r: 0 };
    if (i > 0) {
      // walk outward on a spiral until clear
      let distance = radius + placed[0].r;
      let angle = i * 2.399963; // golden angle, so neighbours spread
      let found = false;
      while (!found) {
        for (let step = 0; step < 48 && !found; step += 1) {
          const x = Math.cos(angle) * distance;
          const y = Math.sin(angle) * distance;
          const snapped = planeToAxial(x, y);
          const [sx, sy] = axialToPlane(snapped);
          const clear = placed.every(
            p => Math.hypot(p.x - sx, p.y - sy) >= p.r + radius + GAP
          );
          if (clear) {
            center = snapped;
            found = true;
          } else {
            angle += (Math.PI * 2) / 48;
          }
        }
        distance += Math.sqrt(3);
      }
    }
    const [cx, cy] = axialToPlane(center);
    placed.push({ x: cx, y: cy, r: radius });
    projects.push({
      id: i,
      name: PROJECT_NAMES[i],
      center,
      capacity,
      rings,
      first,
      count,
    });
    first += count;
  }
  return projects;
}

let cached: FleetModel | null = null;

export function fleetModel(): FleetModel {
  if (cached) return cached;
  const random = rng(20261008);
  const projects = packProjects();
  const agents: FleetAgent[] = [];
  const tiles: FleetTile[] = [];
  for (const project of projects) {
    const spiral = hexSpiral(project.center, project.rings);
    for (let local = 0; local < project.count; local += 1) {
      const index = project.first + local;
      const tile = spiral[local];
      const source = sourceFor(project, local, index);
      const models = MODELS[source] as string[] | undefined;
      const status = statusFor(index, local, random);
      // a stride prime to every Project's list hands each of its goals out
      // (a stride of 5 gave Sales, with ten, two of them)
      const tasks = TASKS[project.id];
      const task = tasks[(local * 11 + project.id) % tasks.length];
      // at work (or stopped at a fault) it is somewhere on its way; waiting
      // on you, done or idle, it says so
      const doing =
        status === 'needs-you'
          ? WAITING[index % WAITING.length]
          : status === 'result'
            ? FINISHED[index % FINISHED.length]
            : status === 'off'
              ? IDLE
              : task.steps[index % task.steps.length];
      agents.push({
        id: index,
        project: project.id,
        name: task.goal,
        doing,
        steps: task.steps,
        status,
        source,
        model: models ? models[index % models.length] : null,
        burn: Math.min(0.96, 0.08 + random() * 0.8),
        minutes: Math.round(6 + random() * 420),
        tile: tile.axial,
        ring: tile.ring,
        children: status === 'active' && local % 7 === 3 ? 2 + (index % 3) : 0,
      });
      tiles.push({
        axial: tile.axial,
        project: project.id,
        agent: index,
        ring: tile.ring,
      });
    }
    for (let i = project.count; i < spiral.length; i += 1) {
      tiles.push({
        axial: spiral[i].axial,
        project: project.id,
        agent: -1,
        ring: spiral[i].ring,
      });
    }
  }
  cached = { projects, agents, tiles };
  return cached;
}

/**
 * Which Projects and tiles are present at a given fleet size. Agents are a
 * prefix; a Project is present once its first agent is; a territory tile is
 * present when its ring is within one of the Project's outermost present
 * agent, so the territory hugs a small fleet and grows with it.
 */
const fleetAtCache = new WeakMap<FleetModel, Map<number, FleetView>>();

/**
 * The fleet at a size, memoised per model: every visual asks for it every
 * frame, and almost always for the size it asked for last frame, so the
 * answer (and the closures in it) is built once per size.
 */
export function fleetAt(model: FleetModel, count: number): FleetView {
  const n = Math.max(0, Math.min(FLEET_MAX, Math.round(count)));
  let bySize = fleetAtCache.get(model);
  if (!bySize) {
    bySize = new Map();
    fleetAtCache.set(model, bySize);
  }
  let view = bySize.get(n);
  if (!view) {
    view = buildFleetView(model, n);
    bySize.set(n, view);
  }
  return view;
}

function buildFleetView(model: FleetModel, n: number) {
  const presentProjects = model.projects.filter(p => p.first < n);
  const outermost = new Map<number, number>();
  for (const project of presentProjects) {
    const last = Math.min(n, project.first + project.count) - 1;
    outermost.set(project.id, model.agents[last].ring);
  }
  return {
    count: n,
    projects: presentProjects,
    /** Drawn at all: an agent tile whose agent is here, or any tile inside
     *  the territory (one ring past the outermost present agent). */
    tilePresent: (tile: FleetTile): boolean => {
      const edge = outermost.get(tile.project);
      if (edge === undefined) return false;
      if (tile.agent >= 0 && tile.agent < n) return true;
      return tile.ring <= edge + 1;
    },
    /** Outlined as a slot a click would fill: an empty agent slot inside the
     *  territory, or the next ring out. */
    tileGhost: (tile: FleetTile): boolean => {
      const edge = outermost.get(tile.project);
      if (edge === undefined) return false;
      if (tile.agent >= 0 && tile.agent < n) return false;
      return (
        tile.ring === edge + 2 || (tile.agent >= 0 && tile.ring <= edge + 1)
      );
    },
    /** True when the tile holds an agent that is here. */
    tileAgent: (tile: FleetTile): boolean => tile.agent >= 0 && tile.agent < n,
  };
}

type FleetView = ReturnType<typeof buildFleetView>;

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const STATUS_LABEL: Record<StatusLightState, string> = {
  active: 'Working',
  'needs-you': 'Needs you',
  result: 'Done',
  off: 'Idle',
  fault: 'Fault',
};
