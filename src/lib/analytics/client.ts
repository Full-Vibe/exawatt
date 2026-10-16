/**
 * ENG-030 OS1.1/OS1.2 — the analytics runtime.
 *
 * Everything policy-bearing lives in the siblings: `config.ts` decides whether
 * and where, `events.ts` decides what, `redact.ts` enforces both at the wire.
 * This module only wires them to PostHog and to persisted per-installation
 * state.
 *
 * Two properties worth stating plainly, because decision `0031` requires them:
 *
 * - The off switches suppress *initialization and emission*. When analytics
 *   are off, `posthog-js` is never even imported, so there is no queue, no
 *   local buffer, and nothing to flush later.
 * - Identity is an anonymous per-installation UUID (`identity.ts`: the
 *   browser's storage on the website, Electron main's settings in the app).
 *   We never call `identify()`, never set person properties, and never send
 *   an Exawatt account id. Installation identity and account identity stay
 *   separate.
 */

import {
  detectElectron,
  resolveDistributionAnalyticsDecision,
  type AnalyticsDecision,
} from './config';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import { isAnalyticsId } from '@exawatt/core/desktop-bridge';
import { startAccountStream, type AccountStream } from './account-stream';
import {
  isInstallationStreamEvent,
  toAnalyticsPayload,
  type AnalyticsEvent,
} from './events';
import { loadAnalyticsIdentity, persistAnalyticsOptOut } from './identity';
import { INGEST_LIBS, sendToIngest, type IngestTarget } from './ingest';
import { ANALYTICS_PROPERTY_DENYLIST, scrubAnalyticsCapture } from './redact';

/** The slice of `posthog-js` this module uses. */
interface AnalyticsSink {
  capture: (name: string, properties?: Record<string, unknown>) => unknown;
  opt_out_capturing?: () => void;
  reset?: (resetDeviceId?: boolean) => void;
}

let sink: AnalyticsSink | null = null;
/** Where the direct sends go (`ingest.ts`), and as whom. Set while emitting. */
let target: IngestTarget | null = null;
let installationId: string | null = null;
/** ENG-047 F5: the signed-in account's stream, desktop only. */
let accountStream: AccountStream | null = null;
let emitting = false;
/** Between a configured build's start and the device's identity answering. */
let deciding = false;
let started: Promise<AnalyticsDecision> | null = null;
/**
 * Set by an opt-out and never cleared in this launch (opting back in takes
 * effect on the next one). The start awaits main's identity answer and then
 * the SDK's import; it re-checks this after each, so an opt-out that lands
 * while either is in flight is never overtaken by the start finishing.
 */
let optedOutThisLaunch = false;
const OPTED_OUT: AnalyticsDecision = { enabled: false, reason: 'opted_out' };
/** Events captured between the decision and the SDK finishing its import. */
const pending: AnalyticsEvent[] = [];
const MAX_PENDING = 20;

function send(event: AnalyticsEvent): void {
  const payload = toAnalyticsPayload(event);
  if (!payload || !sink) return;
  try {
    if (isInstallationStreamEvent(payload.name)) {
      sink.capture(payload.name, payload.properties);
    }
    accountStream?.capture(event);
  } catch {
    // Analytics never propagate a failure into product behavior.
  }
}

function flushPending(): void {
  while (pending.length > 0) {
    const event = pending.shift();
    if (event) send(event);
  }
}

/**
 * Initialize PostHog if, and only if, this is a production build whose
 * distribution configures analytics, the device's identity can be read, and
 * the runtime opt-out is off. Safe to call more than once.
 */
export function initAnalytics(): Promise<AnalyticsDecision> {
  if (started) return started;

  // The build decides before the device is asked anything: a community build
  // neither reads nor creates analytics identity.
  const configured = resolveDistributionAnalyticsDecision(
    resolvedDistribution(),
    { optedOut: false },
    process.env.NODE_ENV
  );
  if (!configured.enabled) {
    pending.length = 0;
    started = Promise.resolve(configured);
    return started;
  }

  deciding = true;
  started = (async (): Promise<AnalyticsDecision> => {
    const identity = await loadAnalyticsIdentity({ ensureId: true });
    if (optedOutThisLaunch) return OPTED_OUT;
    if (!identity?.installationId) {
      deciding = false;
      pending.length = 0;
      return identity?.optedOut
        ? { enabled: false, reason: 'opted_out' }
        : { enabled: false, reason: 'identity_unavailable' };
    }
    deciding = false;
    emitting = true;
    target = { apiHost: configured.apiHost, key: configured.key };
    installationId = identity.installationId;
    // The account stream is the desktop app's: Sessions live there.
    if (detectElectron()) accountStream = startAccountStream(target);
    // ─────────────────────────────────────────────────────────────────────
    // READ THIS BEFORE DEBUGGING "analytics are not arriving" (2026-08-06).
    //
    // PostHog drops every capture from a browser it considers a bot, and a
    // HEADLESS BROWSER IS A BOT. `capture()` returns `undefined` before
    // `before_send` ever runs, with no log, no network request, and no error
    // — `__loaded` is true and the instance looks perfectly healthy.
    //
    // This repo's standing rule is that evals run headless, so the default
    // way to check this feature will always show zero events. That is the
    // harness, not the product. Confirmed by setting
    // `opt_out_useragent_filter: true`, after which the identical build
    // emitted `app_launched` to `/ingest/e/` normally.
    //
    // Do NOT ship `opt_out_useragent_filter: true` to silence it: filtering
    // bots is correct, and the alternative is paying to store crawler noise.
    // Verify from a real browser, or flip the flag in a scratch build only.
    // ─────────────────────────────────────────────────────────────────────
    //
    // `.full.no-external` bundles every extension instead of fetching one at
    // runtime. The desktop renderer's CSP is `script-src 'self'` against a
    // loopback origin, so a remotely loaded extension could never execute
    // there — and loosening CSP in a privileged renderer to gain exception
    // capture would be a bad trade.
    const { default: posthog } =
      await import('posthog-js/dist/module.full.no-external');
    // The opt-out already stopped the account stream and dropped the queue.
    if (optedOutThisLaunch) return OPTED_OUT;
    posthog.init(configured.key, {
      api_host: configured.apiHost,
      // No `ui_host`: decision `0034` keeps PostHog hostnames out of ordinary
      // builds, and the toolbar is never loaded.
      defaults: '2025-05-24',
      // The whole surface area, stated as configuration.
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_web_experiments: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      // The crash signal. Messages are stripped in `before_send`.
      capture_exceptions: true,
      // Nothing about this stream needs a cookie. The desktop renderer keeps
      // nothing on its loopback origin at all (BUG-171): the id is main's,
      // so the SDK's own state lives in memory for the launch.
      persistence: detectElectron() ? 'memory' : 'localStorage',
      person_profiles: 'never',
      mask_personal_data_properties: true,
      property_denylist: [...ANALYTICS_PROPERTY_DENYLIST],
      before_send: scrubAnalyticsCapture,
      // Anonymous, per-installation, generated locally. Never an account id.
      bootstrap: { distinctID: identity.installationId },
    });
    sink = posthog as unknown as AnalyticsSink;
    flushPending();
    return configured;
  })().catch(() => {
    stopEmission();
    return { enabled: false, reason: 'load_failed' } as AnalyticsDecision;
  });

  return started;
}

/**
 * The only way to emit. A caller with a non-allowlisted event cannot express
 * it in the type system, and a caller with garbage at runtime gets a no-op.
 */
export function captureAnalyticsEvent(event: AnalyticsEvent): void {
  if (!emitting && !deciding) return;
  if (sink) {
    send(event);
    return;
  }
  if (pending.length < MAX_PENDING) pending.push(event);
}

/** True when this installation is currently emitting. */
export function isAnalyticsEmitting(): boolean {
  return emitting;
}

/** The persisted opt-out. A device whose identity cannot be read reads as
 *  off, which is what it is: nothing is collected on that launch. */
export async function readAnalyticsOptOut(): Promise<boolean> {
  const identity = await loadAnalyticsIdentity({ ensureId: false });
  return identity?.optedOut ?? true;
}

/**
 * The runtime opt-out. Opting out stops emission immediately, drops anything
 * queued, clears the SDK's state, and forgets the installation id; opting
 * back in takes effect on the next launch, so the choice is never ambiguous
 * mid-session. Resolves to the opt-out now in force.
 */
export async function setAnalyticsOptOut(optedOut: boolean): Promise<boolean> {
  if (optedOut) {
    optedOutThisLaunch = true;
    try {
      sink?.opt_out_capturing?.();
      sink?.reset?.(true);
    } catch {
      // Nothing to recover: emission is already off.
    }
    stopEmission();
  }
  // An unpersisted opt-out still holds for this session (emission stopped
  // above); an unpersisted opt-in changes nothing until it can be kept.
  const persisted = await persistAnalyticsOptOut(optedOut);
  return persisted?.optedOut ?? true;
}

function stopEmission(): void {
  emitting = false;
  deciding = false;
  pending.length = 0;
  sink = null;
  target = null;
  installationId = null;
  accountStream?.stop();
  accountStream = null;
}

/**
 * The website visitor's anonymous id, while analytics are on in this
 * browser; otherwise null. The download page hands it to the artifact route
 * (so the server's `download_requested` is the same visitor's) and to
 * `exawatt://welcome` (so the app can record the one alias, ENG-047 F2).
 */
export function currentWebAnalyticsId(): string | null {
  return emitting && !detectElectron() ? installationId : null;
}

/**
 * ENG-047 F2: alias the visitor's web id to this installation, once (main
 * decides "once"). The only join between two anonymous ids, made by the
 * user's own click on "Open Exawatt"; the account identity is never part of
 * it. `posthog-js` refuses an alias without person profiles, so this posts
 * `$create_alias` directly to the same ingest endpoint.
 */
export function recordWebAlias(webId: unknown): void {
  if (!emitting || !target || !installationId) return;
  if (!isAnalyticsId(webId) || webId === installationId) return;
  void sendToIngest(target, [
    {
      event: '$create_alias',
      distinctId: installationId,
      properties: {
        distinct_id: installationId,
        alias: webId,
        $lib: INGEST_LIBS.webLink,
      },
    },
  ]);
}

/** Test seam: forget initialization so a suite can exercise a fresh launch. */
export function __resetAnalyticsForTests(): void {
  stopEmission();
  started = null;
  optedOutThisLaunch = false;
}
