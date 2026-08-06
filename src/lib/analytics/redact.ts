/**
 * ENG-030 OS1.2 — the transport-level enforcement of the allowlist.
 *
 * `events.ts` makes it impossible for a *typed* caller to attach content.
 * This module makes it impossible for anything else: it runs as PostHog's
 * `before_send` hook, so every capture — including events the SDK generates on
 * its own — passes through it on the way to the wire.
 *
 * Three rules:
 *  1. An event whose name is not on the allowlist is dropped, not sanitized.
 *  2. A declared event keeps only its declared properties plus SDK-internal
 *     `$` properties that are not on the denylist. There is no path for a
 *     free-form key to survive.
 *  3. `$exception` (the crash signal `capture_exceptions` produces) keeps its
 *     exception type and stack shape and loses its message text and any
 *     absolute source location — an exception message is the one place product
 *     content can leak into a crash report.
 *
 * Person properties (`$set`, `$set_once`) are always dropped: anonymous
 * installation identity stays distinct from account identity (decision `0031`),
 * and we never build a person profile.
 */

import type { CaptureResult } from 'posthog-js';
import {
  ANALYTICS_EVENT_PROPERTIES,
  isAnalyticsEventName,
  POSTHOG_EXCEPTION_EVENT,
} from './events';

/**
 * URL-, title-, and campaign-bearing standard properties. In the desktop
 * renderer `$current_url` is `http://127.0.0.1:<port>/workspace/...`, which
 * can carry Session identifiers — a class decision `0031` excludes outright.
 * Also passed to PostHog as `property_denylist` so they never reach a queue.
 */
export const ANALYTICS_PROPERTY_DENYLIST: readonly string[] = [
  '$current_url',
  '$initial_current_url',
  '$pathname',
  '$initial_pathname',
  '$prev_pageview_pathname',
  '$prev_pageview_last_content',
  '$host',
  '$initial_host',
  '$referrer',
  '$initial_referrer',
  '$referring_domain',
  '$initial_referring_domain',
  '$title',
  '$screen_name',
  '$search_engine',
  '$exception_message',
  '$exception_personURL',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'gclid',
  'fbclid',
];

const DENIED = new Set(ANALYTICS_PROPERTY_DENYLIST);

/**
 * Transport keys the SDK sets without a `$` prefix. Stripping them would break
 * ingestion, and none of them can carry product content: `distinct_id` is the
 * anonymous installation id, `token` is the public project key.
 */
const SDK_TRANSPORT_KEYS = new Set(['token', 'distinct_id', 'uuid', 'timestamp']);

type Properties = Record<string, unknown>;

/**
 * A stack frame's location is a build artifact (`/_next/static/chunks/...`),
 * but its origin is not: in Electron it carries the ephemeral loopback port,
 * and a `file:` frame would carry a real path off the user's disk. Keep the
 * path, drop everything that identifies the machine.
 */
export function redactFrameLocation(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.pathname;
    }
    return `<${url.protocol.replace(':', '')}>`;
  } catch {
    // Not a URL: an absolute or relative filesystem path. Never send it.
    return '<local>';
  }
}

function redactFrame(frame: unknown): unknown {
  if (!frame || typeof frame !== 'object') return frame;
  const source = frame as Properties;
  return {
    function: typeof source.function === 'string' ? source.function : null,
    filename: redactFrameLocation(source.filename),
    lineno: typeof source.lineno === 'number' ? source.lineno : null,
    colno: typeof source.colno === 'number' ? source.colno : null,
    in_app: source.in_app === true,
    platform: typeof source.platform === 'string' ? source.platform : null,
    lang: typeof source.lang === 'string' ? source.lang : null,
  };
}

function redactException(exception: unknown): unknown {
  if (!exception || typeof exception !== 'object') return exception;
  const source = exception as Properties;
  const stacktrace = source.stacktrace as Properties | undefined;
  const frames = Array.isArray(stacktrace?.frames)
    ? stacktrace.frames.map(redactFrame)
    : undefined;
  return {
    type: typeof source.type === 'string' ? source.type : 'Error',
    // The message is the only free-form field in an exception. It is dropped,
    // not truncated: a truncated prompt is still a prompt.
    value: '<redacted>',
    mechanism: source.mechanism,
    ...(stacktrace
      ? { stacktrace: { type: stacktrace.type ?? 'raw', frames: frames ?? [] } }
      : {}),
  };
}

export function redactExceptionProperties(properties: Properties): Properties {
  const redacted: Properties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (DENIED.has(key)) continue;
    if (key === '$exception_list') {
      redacted[key] = Array.isArray(value) ? value.map(redactException) : [];
      continue;
    }
    redacted[key] = value;
  }
  return redacted;
}

/**
 * PostHog's `before_send`. Returning `null` drops the event entirely.
 */
export function scrubAnalyticsCapture(
  result: CaptureResult | null
): CaptureResult | null {
  if (!result) return null;
  const properties = (result.properties ?? {}) as Properties;

  if (result.event === POSTHOG_EXCEPTION_EVENT) {
    return {
      ...result,
      properties: redactExceptionProperties(properties),
      $set: undefined,
      $set_once: undefined,
    };
  }

  if (!isAnalyticsEventName(result.event)) return null;

  const declared = new Set(ANALYTICS_EVENT_PROPERTIES[result.event]);
  const kept: Properties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (DENIED.has(key)) continue;
    // SDK-internal properties are machine metadata the library generates.
    // Everything else must be a property this event declares.
    if (key.startsWith('$') || SDK_TRANSPORT_KEYS.has(key) || declared.has(key)) {
      kept[key] = value;
    }
  }

  return { ...result, properties: kept, $set: undefined, $set_once: undefined };
}
