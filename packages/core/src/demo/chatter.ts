/**
 * Voltaic's agent chatter (ENG-029 B3, decision `0052`): the messages the
 * Demo Workspace's Agents have sent each other, and the operator's own, so
 * the Chatter tab in Team renders through the same components the live bus
 * feeds. Data only; the renderer's Demo bus client turns each entry into a
 * stamped message on the shell's clock.
 *
 * Every delivery result the ledger can record appears at least once
 * (`delivered`, `queued`, `held`, `terminal`, `undeliverable`, `expired`,
 * `unknown`), each on a recipient whose harness and status make it the true
 * outcome: Codex queues to the turn boundary, OpenCode has no message door so
 * a message is typed into its terminal, an ended Session is undeliverable, a
 * Claude Code tab whose own settings ask first holds a peer message and lets
 * it lapse, and an OpenClaw gateway accepts without saying more.
 *
 * Nothing here is a debate, a round or a verdict: two Agents ask and answer
 * about the work in front of them, and the operator says one thing to one
 * Agent.
 */

/** Exactly the ledger's delivery vocabulary (`src/lib/bus/types.ts`). */
export type DemoChatterDeliveryState =
  | 'delivered'
  | 'queued'
  | 'held'
  | 'terminal'
  | 'undeliverable'
  | 'expired'
  | 'unknown';

export interface DemoChatterEntry {
  id: string;
  /** a `DEMO_PROJECTS` key */
  projectKey: string;
  /** a `DEMO_BASE_AGENTS` id, or `operator` for the human's own message */
  from: string;
  /** a `DEMO_BASE_AGENTS` id in the same Project */
  to: string;
  minutesAgo: number;
  text: string;
  delivery: { state: DemoChatterDeliveryState; reason?: string };
}

export const DEMO_CHATTER: readonly DemoChatterEntry[] = Object.freeze([
  /* ---------------- dispatch-engine (Web Platform) ---------------- */
  {
    id: 'chat-dsp-1',
    projectKey: 'dispatch-engine',
    from: 'vg-dsp-forecast',
    to: 'vg-dsp-bidrails',
    minutesAgo: 38,
    text: 'Your replay diverged on day seven at 14:05, and my shadow bids spike in the same hour. Is the monotonicity check reading the raw offer curve or the smoothed one?',
    delivery: { state: 'delivered' },
  },
  {
    id: 'chat-dsp-2',
    projectKey: 'dispatch-engine',
    from: 'vg-dsp-bidrails',
    to: 'vg-dsp-forecast',
    minutesAgo: 31,
    text: 'Raw curve. The step at 14:05 is in the fixture market data itself, not in your inputs.\n\nI noted it on DSP-32 and I am excluding 14:00 to 15:00 from the replay until the fixture is regenerated.',
    delivery: { state: 'delivered' },
  },
  {
    id: 'chat-dsp-3',
    projectKey: 'dispatch-engine',
    from: 'vg-dsp-forecast',
    to: 'vg-dsp-bidrails',
    minutesAgo: 29,
    text: 'Thanks. I will score day six without that hour and say so at the top of the report.',
    delivery: { state: 'delivered' },
  },
  {
    id: 'chat-dsp-4',
    projectKey: 'dispatch-engine',
    from: 'operator',
    to: 'vg-dsp-forecast',
    minutesAgo: 12,
    text: 'Hold the day-seven score until the fixture is regenerated.',
    delivery: { state: 'delivered' },
  },
  {
    id: 'chat-dsp-5',
    projectKey: 'dispatch-engine',
    from: 'vg-dsp-ancillary',
    to: 'vg-dsp-holdout',
    minutesAgo: 9,
    text: 'Can you rerun the holdout week with co-optimized ancillary prices included? I want to see whether the spread survives.',
    delivery: {
      state: 'undeliverable',
      reason: 'Holdout eval rerun has ended. Resume it to message it.',
    },
  },
  {
    id: 'chat-dsp-6',
    projectKey: 'dispatch-engine',
    from: 'vg-dsp-ancillary',
    to: 'vg-dsp-forecast',
    minutesAgo: 3,
    text: 'Your refit still reads the June regulation-up price series. The July series is in data/ancillary/2026-07.parquet.',
    delivery: {
      state: 'held',
      reason: 'Claude Code asks before accepting peer messages in that tab.',
    },
  },

  /* ---------------- grid-api (Partner API) ---------------- */
  {
    id: 'chat-api-1',
    projectKey: 'grid-api',
    from: 'vg-api-signing',
    to: 'vg-api-verifylib',
    minutesAgo: 52,
    text: 'The cutover renames the header to X-Voltaic-Signature-256 and drops the v1 fallback on the 20th. The verification library docs still show the v1 header.',
    delivery: { state: 'delivered' },
  },
  {
    id: 'chat-api-2',
    projectKey: 'grid-api',
    from: 'vg-api-verifylib',
    to: 'vg-api-signing',
    minutesAgo: 47,
    text: 'Updated the docs and the Node and Python examples. Should the v1 header stay in a migration note until the 20th?',
    delivery: { state: 'terminal' },
  },
  {
    id: 'chat-api-3',
    projectKey: 'grid-api',
    from: 'vg-api-signing',
    to: 'vg-api-verifylib',
    minutesAgo: 44,
    text: 'Yes. Keep it until the 20th, then remove it with the fallback.',
    delivery: { state: 'delivered' },
  },
  {
    id: 'chat-api-4',
    projectKey: 'grid-api',
    from: 'vg-api-verifylib',
    to: 'vg-api-sandbox',
    minutesAgo: 20,
    text: 'Does the sandbox reset rotate the test signing keys too? The docs promise they survive a reset.',
    delivery: {
      state: 'unknown',
      reason: 'The gateway accepted it and reported nothing back.',
    },
  },
  {
    id: 'chat-api-5',
    projectKey: 'grid-api',
    from: 'operator',
    to: 'vg-api-signing',
    minutesAgo: 6,
    text: 'Ship the cutover behind the flag first. We flip it on Monday.',
    delivery: { state: 'terminal' },
  },

  /* ---------------- voltaic-home (Customer App) ---------------- */
  {
    id: 'chat-home-1',
    projectKey: 'voltaic-home',
    from: 'vg-home-onboard',
    to: 'vg-home-transparency',
    minutesAgo: 74,
    text: 'I am adding a step_state column to the enrollment table you read for event history. Any objection before I migrate?',
    delivery: {
      state: 'expired',
      reason: 'Held in that tab for five minutes, then expired.',
    },
  },
  {
    id: 'chat-home-2',
    projectKey: 'voltaic-home',
    from: 'vg-home-onboard',
    to: 'vg-home-transparency',
    minutesAgo: 66,
    text: 'Sending again: a nullable step_state column on enrollment, no backfill. Any objection?',
    delivery: { state: 'delivered' },
  },
  {
    id: 'chat-home-3',
    projectKey: 'voltaic-home',
    from: 'vg-home-transparency',
    to: 'vg-home-onboard',
    minutesAgo: 61,
    text: 'None. I only read event_id and created_at, so a nullable column is invisible to the spike.',
    delivery: { state: 'delivered' },
  },
  {
    id: 'chat-home-4',
    projectKey: 'voltaic-home',
    from: 'vg-home-onboard',
    to: 'vg-home-pushopt',
    minutesAgo: 15,
    text: 'Onboarding now resumes at the last completed step. Your opt-in prompt should fire after step three, not on first launch.',
    delivery: {
      state: 'queued',
      reason: 'Codex runs it as the next turn.',
    },
  },
  {
    id: 'chat-home-5',
    projectKey: 'voltaic-home',
    from: 'operator',
    to: 'vg-home-pushopt',
    minutesAgo: 4,
    text: 'Pause the opt-in prompt test until onboarding lands.',
    delivery: {
      state: 'queued',
      reason: 'Codex runs it as the next turn.',
    },
  },

  /* ---------------- telemetry-ingest (Data Pipeline) ---------------- */
  {
    id: 'chat-tel-1',
    projectKey: 'telemetry-ingest',
    from: 'vg-tel-dedupe',
    to: 'vg-tel-drift',
    minutesAgo: 25,
    text: 'Duplicate writes are now rejected at the ingest edge. Drift alerts that counted duplicates as readings will drop by about three percent.',
    delivery: { state: 'terminal' },
  },
  {
    id: 'chat-tel-2',
    projectKey: 'telemetry-ingest',
    from: 'vg-tel-drift',
    to: 'vg-tel-dedupe',
    minutesAgo: 22,
    text: 'Good to know. I will rebaseline the alert thresholds after your change merges.',
    delivery: { state: 'queued', reason: 'Codex runs it as the next turn.' },
  },
]);
