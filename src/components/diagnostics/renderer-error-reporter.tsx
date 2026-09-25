'use client';

import { useEffect } from 'react';
import type { RenderErrorReport } from '@exawatt/core/desktop-bridge';

/**
 * Errors no boundary catches reach `logs/main.jsonl` (BUG-129).
 *
 * The route error boundaries report a render that threw. Everything else in
 * the window, a rejected `invoke` nobody awaited, a failed effect, an xterm
 * callback that throws, used to vanish, so an "I saw something weird" report
 * had no trail. This reports the window's `error` and `unhandledrejection`
 * events through the same desktop channel. Browser noise that is not a
 * defect is skipped; repeats are dropped; and the page sends at most
 * `MAX_PER_MINUTE`, with main bounding the channel again on its side.
 */

const MAX_PER_MINUTE = 10;

/** Messages a browser raises that are not the app failing. */
const NOISE = [
  /^ResizeObserver loop/,
  // A cross-origin script's error, which the browser strips to this.
  /^Script error\.?$/,
];

type Kind = NonNullable<RenderErrorReport['kind']>;

function describe(value: unknown): { message: string; stack: string | null } {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack ?? null };
  }
  return { message: String(value), stack: null };
}

export function RendererErrorReporter() {
  useEffect(() => {
    const report = window.electron?.app?.reportRenderError;
    if (!report) return;
    let minuteStartedAt = 0;
    let sentThisMinute = 0;
    let lastKey = '';

    const send = (
      kind: Kind,
      message: string,
      stack: string | null,
      source: string | null
    ) => {
      if (!message || NOISE.some(pattern => pattern.test(message))) return;
      const key = `${kind}\n${message}`;
      if (key === lastKey) return;
      const now = Date.now();
      if (now - minuteStartedAt >= 60_000) {
        minuteStartedAt = now;
        sentThisMinute = 0;
      }
      if (sentThisMinute >= MAX_PER_MINUTE) return;
      sentThisMinute += 1;
      lastKey = key;
      void report({
        kind,
        message,
        stack,
        source,
        pathname: window.location.pathname,
      }).catch(() => {});
    };

    const onError = (event: ErrorEvent) => {
      const { message, stack } = describe(event.error ?? event.message);
      send(
        'error',
        event.message || message,
        stack,
        event.filename
          ? `${event.filename}:${event.lineno}:${event.colno}`
          : null
      );
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const { message, stack } = describe(event.reason);
      send('unhandled-rejection', message, stack, null);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
