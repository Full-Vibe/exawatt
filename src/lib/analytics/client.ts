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
 * - Identity is an anonymous per-installation UUID held in this machine's
 *   local storage. We never call `identify()`, never set person properties,
 *   and never send an Exawatt account id. Installation identity and account
 *   identity stay separate.
 */

import {
  detectElectron,
  readAnalyticsEnv,
  resolveAnalyticsDecision,
  type AnalyticsDecision,
} from './config';
import { toAnalyticsPayload, type AnalyticsEvent } from './events';
import { ANALYTICS_PROPERTY_DENYLIST, scrubAnalyticsCapture } from './redact';

export const ANALYTICS_OPT_OUT_STORAGE_KEY = 'exawatt.analytics.opt-out.v1';
export const ANALYTICS_INSTALLATION_ID_STORAGE_KEY =
  'exawatt.analytics.installation-id.v1';

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function localStorageOrNull(): MinimalStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Blocked storage (private mode, embedded contexts) is not an error here.
    return null;
  }
}

/** Opt-out is sticky and defaults to false; unreadable storage means opted in. */
export function readAnalyticsOptOut(
  storage: MinimalStorage | null = localStorageOrNull()
): boolean {
  try {
    return storage?.getItem(ANALYTICS_OPT_OUT_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeAnalyticsOptOut(
  optedOut: boolean,
  storage: MinimalStorage | null = localStorageOrNull()
): void {
  try {
    if (optedOut) storage?.setItem(ANALYTICS_OPT_OUT_STORAGE_KEY, 'true');
    else storage?.removeItem(ANALYTICS_OPT_OUT_STORAGE_KEY);
  } catch {
    // An unpersisted preference still takes effect for this session.
  }
}

/**
 * The anonymous installation identity. Distinct from any account: it is
 * generated locally, never derived from a user id, and cleared by an opt-out.
 */
export function readInstallationId(
  storage: MinimalStorage | null = localStorageOrNull(),
  generate: () => string = () => crypto.randomUUID()
): string | null {
  try {
    const existing = storage?.getItem(ANALYTICS_INSTALLATION_ID_STORAGE_KEY);
    if (existing) return existing;
    const created = generate();
    storage?.setItem(ANALYTICS_INSTALLATION_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return null;
  }
}

/** The slice of `posthog-js` this module uses. */
interface AnalyticsSink {
  capture: (name: string, properties?: Record<string, unknown>) => unknown;
  opt_out_capturing?: () => void;
  reset?: (resetDeviceId?: boolean) => void;
}

let sink: AnalyticsSink | null = null;
let emitting = false;
let started: Promise<AnalyticsDecision> | null = null;
/** Events captured between the decision and the SDK finishing its import. */
const pending: AnalyticsEvent[] = [];
const MAX_PENDING = 20;

function send(event: AnalyticsEvent): void {
  const payload = toAnalyticsPayload(event);
  if (!payload || !sink) return;
  try {
    sink.capture(payload.name, payload.properties);
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
 * Initialize PostHog if — and only if — this is a production build with a key,
 * no build switch, and no runtime opt-out. Safe to call more than once.
 */
export function initAnalytics(): Promise<AnalyticsDecision> {
  if (started) return started;

  const decision = resolveAnalyticsDecision(readAnalyticsEnv(), {
    isElectron: detectElectron(),
    optedOut: readAnalyticsOptOut(),
  });

  if (!decision.enabled) {
    pending.length = 0;
    started = Promise.resolve(decision);
    return started;
  }

  emitting = true;
  started = (async () => {
    // `.full.no-external` bundles every extension instead of fetching one at
    // runtime. The desktop renderer's CSP is `script-src 'self'` against a
    // loopback origin, so a remotely loaded extension could never execute
    // there — and loosening CSP in a privileged renderer to gain exception
    // capture would be a bad trade.
    const { default: posthog } = await import(
      'posthog-js/dist/module.full.no-external'
    );
    posthog.init(decision.key, {
      api_host: decision.apiHost,
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
      // localStorage, not cookies: nothing about this stream needs a cookie.
      persistence: 'localStorage',
      person_profiles: 'never',
      mask_personal_data_properties: true,
      property_denylist: [...ANALYTICS_PROPERTY_DENYLIST],
      before_send: scrubAnalyticsCapture,
      // Anonymous, per-installation, generated locally. Never an account id.
      bootstrap: { distinctID: readInstallationId() ?? undefined },
    });
    sink = posthog as unknown as AnalyticsSink;
    flushPending();
    return decision;
  })().catch(() => {
    emitting = false;
    pending.length = 0;
    return { enabled: false, reason: 'load_failed' } as AnalyticsDecision;
  });

  return started;
}

/**
 * The only way to emit. A caller with a non-allowlisted event cannot express
 * it in the type system, and a caller with garbage at runtime gets a no-op.
 */
export function captureAnalyticsEvent(event: AnalyticsEvent): void {
  if (!emitting) return;
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

/**
 * The runtime opt-out. Opting out stops emission immediately, drops anything
 * queued, and clears the SDK's local state; opting back in takes effect on the
 * next launch, so the choice is never ambiguous mid-session.
 */
export function setAnalyticsOptOut(optedOut: boolean): void {
  writeAnalyticsOptOut(optedOut);
  if (!optedOut) return;
  emitting = false;
  pending.length = 0;
  try {
    sink?.opt_out_capturing?.();
    sink?.reset?.(true);
  } catch {
    // Nothing to recover: emission is already off.
  }
  sink = null;
}

/** Test seam: forget initialization so a suite can exercise a fresh launch. */
export function __resetAnalyticsForTests(): void {
  sink = null;
  emitting = false;
  started = null;
  pending.length = 0;
}
