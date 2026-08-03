/**
 * Authored hero-Session transcripts (ENG-027 W3).
 *
 * The Demo Workspace forbids fabricated liveness: no simulated streaming, no
 * scripted agent replies, no LLM calls. What a demo Terminal pane may render
 * is a FIXED transcript buffer through W2's pane content source — these are
 * those buffers, for the three Sessions a demo audience is most likely to
 * open. Every other Session renders its goal, subtitle, and status truthfully
 * without a transcript, which is exactly what a real fleet looks like when
 * you have not opened the tab.
 *
 * `vg-res-nprr` belongs to a `preview` Project (research is not a shipped
 * capability). Its transcript exists so the Agent Types vision is readable,
 * and any surface rendering it MUST carry the ENG-026 preview marker.
 */

import type { DemoTranscriptLine } from './types';
import { DEMO_WORKSPACE_NOW_MS, HOUR_MS, MIN_MS } from './startup';

const NOW = DEMO_WORKSPACE_NOW_MS;
const m = (n: number) => NOW - n * MIN_MS;
const h = (n: number) => NOW - n * HOUR_MS;

export const DEMO_TRANSCRIPTS: Readonly<
  Record<string, DemoTranscriptLine[]>
> = Object.freeze({
  /* Active coding Session with delegation — voltaic-home onboarding. */
  'vg-home-onboard': [
    {
      atMs: h(4),
      role: 'operator',
      text: 'Implement HOME-24 O3: resumable enrollment state plus abandonment telemetry. The flag flow from O1 is the base. Leaving the flow must never lose progress — that is the exit criterion that matters.',
    },
    {
      atMs: h(3.9),
      role: 'agent',
      text: 'Reading the O1 flow first. Three screens: address, hardware, utility account. Current state lives in component state only — closing the app on screen two loses everything, which matches the 38% abandonment finding.',
    },
    {
      atMs: h(3.6),
      role: 'tool',
      text: 'Task(Explore): map every write to enrollment state across the app → agent-9a01',
    },
    {
      atMs: h(3.1),
      role: 'agent',
      text: 'Explore found 11 write sites; 9 go through useEnrollment, two bypass it from the installer-prefill path (O2). I will route those two through the store so resume has one source of truth.',
    },
    {
      atMs: h(2.8),
      role: 'agent',
      text: 'Design: enrollment state persists to local storage under a versioned key on every mutation, with a server-side resume token minted at screen one. Local wins offline; the token lets a reinstalled app resume from the server copy.',
    },
    {
      atMs: h(2.2),
      role: 'tool',
      text: 'Task(general-purpose): draft the abandonment telemetry event schema → agent-9a17',
    },
    {
      atMs: h(1.9),
      role: 'agent',
      text: 'Telemetry schema drafted: enrollment_step_entered, _completed, _abandoned with step id, elapsed, and prefill coverage. Abandoned fires from the resume path when a stale session is superseded, not from a heartbeat — no phantom abandons.',
    },
    {
      atMs: h(1.1),
      role: 'tool',
      text: 'Task(fork): enumerate resume-token expiry edge cases → agent-9a2c',
    },
    {
      atMs: m(38),
      role: 'agent',
      text: 'Fork came back with the nasty case: token expires while the local copy has newer screens. Resolution: local state always wins and re-mints; the server copy is a fallback, never an authority. Writing tests for the three expiry cases now.',
    },
    {
      atMs: m(1),
      role: 'agent',
      text: 'Resume-path tests green for kill-and-relaunch on screens one to three. Remaining: wire the O3 flag into the rollout config and run the abandonment funnel against replayed pilot traffic.',
    },
  ],

  /* Needs-you Session — grid-api sandbox reset, waiting at a real gate. */
  'vg-api-sandbox': [
    {
      atMs: h(6),
      role: 'operator',
      text: 'API-19: partners should reset their own sandbox without filing a ticket. Reset the data, keep the audit trail. Check what a reset means for their keys before you build anything.',
    },
    {
      atMs: h(5.7),
      role: 'agent',
      text: 'Reading the sandbox provisioning path. A sandbox is a partner-scoped schema plus a key pair. Reset options: truncate the schema only, or reprovision — which rotates keys as a side effect.',
    },
    {
      atMs: h(5.2),
      role: 'agent',
      text: 'Built the reset endpoint against a schema truncate. Problem found in review: truncate leaves webhook delivery state pointing at rows that no longer exist, and two partners have integrations mid-flight against that state.',
    },
    {
      atMs: h(4.1),
      role: 'agent',
      text: 'The clean design is reprovision — fresh schema, fresh delivery state, fresh keys. But key rotation on self-service reset is a policy decision: both mid-flight partners would need to re-pull credentials, and the program manager owns that relationship.',
    },
    {
      atMs: h(2),
      role: 'agent',
      text: 'Stopping here for a decision rather than guessing: should self-service reset rotate partner keys? Implementation is ready either way — reprovision-with-rotation is built; data-only reset needs the delivery-state fix, about a day more.',
    },
  ],

  /* Research desk (PREVIEW) — market-intel NPRR briefs. */
  'vg-res-nprr': [
    {
      atMs: h(4),
      role: 'operator',
      text: 'RES-7 N2: impact briefs for the three open storage-relevant filings. One page each, every claim cited to the filing text. Dispatch needs these before the Thursday bid-strategy review.',
    },
    {
      atMs: h(3.8),
      role: 'agent',
      text: 'Tracker has three open storage-relevant filings: revision to state-of-charge telemetry obligations, a proposal changing ancillary performance measurement windows, and a small-fleet aggregation threshold change.',
    },
    {
      atMs: h(3.2),
      role: 'agent',
      text: 'Brief one drafted (telemetry obligations). Key finding: the proposed per-resource telemetry cadence matches what our gateways already report, so compliance cost is near zero — but the attestation requirement would need INF-21’s evidence trail to cover dispatch telemetry too. Cited sections 3.2 and 5.1 of the filing.',
    },
    {
      atMs: h(1.4),
      role: 'agent',
      text: 'Brief two in progress (performance measurement windows). The shorter window penalizes slow-ramping resources; our battery fleet ramps inside it comfortably. Modeled July performance against the proposed window: zero events would have scored differently. Flagging one open question for legal on the measurement start trigger.',
    },
    {
      atMs: m(15),
      role: 'agent',
      text: 'Brief two drafted with the legal question highlighted. Starting brief three (aggregation threshold) — this is the one that could matter most: the proposed floor sits above our current pilot fleet size, which would change when we can register.',
    },
  ],
});
