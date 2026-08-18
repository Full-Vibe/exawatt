'use client';

/**
 * What a paused Agent shows (ENG-016 BUG-013, and most of BUG-012).
 *
 * It used to replay the saved byte stream into a fresh terminal. That was
 * wrong twice: the bytes carry cursor moves issued at the width the session
 * ran at, so at any other width the lines land on top of each other — the
 * operator's "jumbled, unreadable text" — and reading them at all meant
 * JSON-parsing megabytes on the Electron main process, which is incident
 * 0008's frozen app.
 *
 * The operator was offered three replay designs and took none of them:
 * _"Or some summary or something. Could be minimal, just not garbage."_ So a
 * paused Agent is a RECORD, not a terminal: what it was doing, how it ended,
 * and how to get back to it. Nothing here reads the transcript — the record
 * is built from state the workspace already holds plus one O(1) stat — and
 * the transcript stays one click away, rendered to lines in main and bounded
 * before it crosses IPC.
 */
import { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { WORKSPACE_HUD as HUD, withThemeAlpha } from './workspace-theme';
import { HARNESS_META } from './harnesses';
import type { SessionTab } from './use-workspace-state';

/** Bytes as the operator reads them, not as a machine writes them. */
export function formatHistorySize(bytes: number): string {
  if (bytes <= 0) return 'nothing saved';
  if (bytes < 1024) return `${bytes} B saved`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB saved`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB saved`;
}

/** Coarse on purpose: a paused Agent's exact second is never the question. */
export function formatWhen(at: number, now = Date.now()): string {
  if (!at) return 'unknown';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 90) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * How it ended, in the vocabulary the rest of the app already uses. A
 * paused Agent that cannot say why it stopped is the thing this replaces.
 */
export function endedCopy(tab: SessionTab): string {
  if (tab.lifecycle === 'interrupted') {
    return 'Interrupted. The previous run did not shut down cleanly.';
  }
  if (tab.lifecycle === 'failed') return 'The last resume attempt failed.';
  if (tab.exitCode !== null && tab.exitCode !== 0) {
    return `Exited with code ${tab.exitCode}.`;
  }
  if (tab.harness === 'shell') return 'Shell closed. History is kept.';
  return 'Stopped cleanly. The conversation is kept and can be resumed.';
}

interface HistoryMeta {
  bytes: number;
  updatedAt: number;
  exists: boolean;
}

/**
 * The two reads this surface makes. Injectable so a bench or a test can
 * supply them without faking `window.electron` — a partial fake there makes
 * a browser LOOK like Electron and breaks every other consumer on the page.
 */
export interface PausedHistoryBridge {
  retainedHistoryMeta: (durableSessionId: string) => Promise<HistoryMeta>;
  retainedTranscript: (durableSessionId: string) => Promise<{
    lines: string[];
    truncated: number;
    corrupt: boolean;
  }>;
}

export function PausedAgentRecord({
  tab,
  summary,
  bridge,
}: {
  tab: SessionTab;
  /** the auto-summary for this Session, when one exists */
  summary?: string | null;
  /** defaults to the real preload bridge; supplied by benches and tests */
  bridge?: PausedHistoryBridge;
}) {
  const [meta, setMeta] = useState<HistoryMeta | null>(null);
  const [lines, setLines] = useState<string[] | null>(null);
  const [truncated, setTruncated] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setLines(null);
    setTruncated(0);
    setFailed(false);
    const api = bridge ?? window.electron?.pty;
    if (!api?.retainedHistoryMeta) {
      // No local bridge (hosted web, Demo Mode): say so rather than sit on
      // "Reading saved history…" forever.
      setMeta({ bytes: 0, updatedAt: 0, exists: false });
      return;
    }
    void api
      .retainedHistoryMeta(tab.durableSessionId)
      .then(next => {
        if (!cancelled) setMeta(next);
      })
      .catch(() => {
        if (!cancelled) setMeta({ bytes: 0, updatedAt: 0, exists: false });
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, tab.durableSessionId]);

  const showTranscript = useCallback(async () => {
    const api = bridge ?? window.electron?.pty;
    if (!api?.retainedTranscript) return;
    setLoading(true);
    setFailed(false);
    try {
      const result = await api.retainedTranscript(tab.durableSessionId);
      if (result.corrupt) setFailed(true);
      // An unreadable transcript must SAY so rather than swap in an empty
      // pane: showing nothing where output was promised reads as a second
      // bug, not as an explanation.
      if (result.lines.length > 0 || !result.corrupt) {
        setLines(result.lines);
        setTruncated(result.truncated);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [bridge, tab.durableSessionId]);

  const goal = tab.initialTask?.trim() || null;
  const context = summary?.trim() || null;

  return (
    <div
      data-paused-agent-record={tab.durableSessionId}
      className="relative min-h-0 flex-1 overflow-y-auto px-5 py-4"
      style={{ background: HUD.bg.void, color: HUD.text }}
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <section className="flex flex-col gap-1.5">
          <p
            className="font-mono text-chrome-micro uppercase tracking-[0.14em]"
            style={{ color: HUD.textDim }}
          >
            {HARNESS_META[tab.harness].label} · paused
          </p>
          {goal ? (
            <p className="text-sm leading-5">{goal}</p>
          ) : (
            <p className="text-sm leading-5" style={{ color: HUD.textDim }}>
              No task was recorded for this Agent.
            </p>
          )}
          {context && goal !== context && (
            <p
              className="text-chrome-meta leading-5"
              style={{ color: HUD.textDim }}
            >
              {context}
            </p>
          )}
        </section>

        <section
          className="flex flex-col gap-1 border-t pt-3 text-chrome-meta"
          style={{ borderColor: HUD.strokeFaint, color: HUD.textDim }}
        >
          <p>{endedCopy(tab)}</p>
          <p>
            {!meta
              ? 'Reading saved history…'
              : !meta.exists
                ? 'No terminal output was saved.'
                : `${formatHistorySize(meta.bytes)}${
                    meta.updatedAt
                      ? ` · last output ${formatWhen(meta.updatedAt)}`
                      : ''
                  }`}
          </p>
        </section>

        {lines === null ? (
          <div>
            <button
              type="button"
              data-show-transcript
              disabled={loading || (meta ? !meta.exists : false)}
              onClick={() => void showTranscript()}
              className="inline-flex min-h-8 items-center gap-2 rounded border px-2.5 font-mono text-chrome-label outline-none transition-colors hover:bg-hud-stroke-faint focus-visible:ring-1 focus-visible:ring-hud-cyan disabled:cursor-not-allowed disabled:opacity-50"
              style={{ borderColor: HUD.strokeFaint, color: HUD.textDim }}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              {meta && !meta.exists ? 'No saved output' : 'Show transcript'}
            </button>
            {failed && (
              <p
                role="status"
                className="mt-2 text-chrome-meta"
                style={{ color: HUD.amber }}
              >
                Saved history could not be read.
              </p>
            )}
          </div>
        ) : (
          <section className="flex min-h-0 flex-col gap-2">
            <p className="font-mono text-chrome-micro" style={{ color: HUD.textDim }}>
              Transcript · read-only
              {truncated > 0 ? ` · earliest ${truncated} lines not shown` : ''}
            </p>
            <pre
              data-paused-transcript
              className="overflow-x-auto whitespace-pre-wrap break-words rounded border p-3 font-mono text-chrome-meta leading-5"
              style={{
                borderColor: HUD.strokeFaint,
                background: withThemeAlpha(HUD.textDim, 0.04),
                color: HUD.text,
              }}
            >
              {lines.join('\n')}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}
