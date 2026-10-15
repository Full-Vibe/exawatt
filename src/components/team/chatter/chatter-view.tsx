// No 'use client': only imported by client surfaces.

/**
 * Chatter (ENG-029 C1 live, decision `0052`): every message this Project's
 * Agents sent each other, and the operator's own, in the Chatter tab of
 * Team's dock. Two altitudes in one panel, the two the operator named: the
 * list ("chatter is happening", one row per message, newest first) and the
 * thread ("read and mediate", one pair's conversation with Send as operator).
 *
 * Nothing here summarizes, scores, flags or counts rounds. Unavailable is one
 * honest line, never an empty list.
 *
 * Keyboard: ↑/↓ (or j/k) move, Enter opens a row or opens a message in place,
 * Escape (or ←) backs out of the thread and then out of the panel; Tab from
 * the thread reaches Send as operator, where ⌘↩ sends and Escape returns.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { WORKSPACE_HUD as HUD } from '@/components/workspace/workspace-theme';
import { markSeenThrough, seenThrough } from '@/lib/bus/read-state';
import { latestAt, newestFirst, threadOf } from '@/lib/bus/selectors';
import type { BusEndpoint, MessageRecord, BusSendResult } from '@exawatt/core';
import type { BusMessagesState } from '@/lib/bus/use-bus';
import {
  ChatterEndpoint,
  isOperator,
  type ChatterParticipants,
} from './chatter-endpoint';
import { ChatterRow } from './chatter-row';
import { ChatterComposer, ChatterThreadMessage } from './chatter-thread';

type Mode =
  | { kind: 'list' }
  | { kind: 'thread'; a: BusEndpoint; b: BusEndpoint; fromRow: number };

/** keys typed into these belong to them, not to the panel's roving */
const OWNS_KEYS = 'textarea, input, select, [role="radio"], [type="submit"]';

export function ChatterView({
  projectId,
  projectName,
  projectColor,
  state,
  send,
  participants,
  visible,
  onSelectSession,
  onExitFocus,
}: {
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  state: BusMessagesState;
  send: (to: string, text: string) => Promise<BusSendResult>;
  participants: ChatterParticipants;
  /** on screen right now: what is shown counts as read */
  visible: boolean;
  /** jump to a Session's tab */
  onSelectSession: (tabId: string) => void;
  /** Escape at the list: leave the panel (Team returns to its tiles) */
  onExitFocus?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [sel, setSel] = useState(0);
  const [threadSel, setThreadSel] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const messages = useMemo(
    () => (state.status === 'ok' ? state.messages : []),
    [state]
  );
  const list = useMemo(() => newestFirst(messages), [messages]);

  // a Project switch re-scopes the panel to its list
  useEffect(() => {
    setMode({ kind: 'list' });
    setSel(0);
  }, [projectId]);

  // what is on screen counts as read; the dots keep marking what arrived
  // since the operator last looked, until he looks away
  const [baseline, setBaseline] = useState(0);
  useEffect(() => {
    if (visible && projectId) setBaseline(seenThrough(projectId));
  }, [visible, projectId]);
  useEffect(() => {
    if (!visible || !projectId || messages.length === 0) return;
    markSeenThrough(projectId, latestAt(messages));
  }, [visible, projectId, messages]);

  const thread = useMemo(
    () =>
      mode.kind === 'thread'
        ? threadOf(messages, mode.a.sessionId, mode.b.sessionId)
        : [],
    [messages, mode]
  );

  useEffect(() => {
    setSel(s => Math.min(s, Math.max(0, list.length - 1)));
  }, [list.length]);

  const focusRoot = () => requestAnimationFrame(() => rootRef.current?.focus());

  const openThread = (index: number) => {
    const message = list[index];
    if (!message) return;
    const pair = threadOf(
      messages,
      message.from.sessionId,
      message.to.sessionId
    );
    const latest = pair[pair.length - 1];
    setMode({ kind: 'thread', a: message.from, b: message.to, fromRow: index });
    setThreadSel(
      Math.max(
        0,
        pair.findIndex(m => m.id === message.id)
      )
    );
    setExpanded(new Set([message.id, ...(latest ? [latest.id] : [])]));
    focusRoot();
  };

  const backToList = () => {
    if (mode.kind === 'thread') setSel(mode.fromRow);
    setMode({ kind: 'list' });
    focusRoot();
  };

  const toggle = (id: string) =>
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target !== event.currentTarget && target.closest(OWNS_KEYS)) return;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    const key = event.key;
    if (mode.kind === 'thread') {
      if (key === 'Escape' || key === 'ArrowLeft') {
        handled();
        backToList();
      } else if (key === 'ArrowDown' || key === 'j') {
        handled();
        setThreadSel(s => Math.min(thread.length - 1, s + 1));
      } else if (key === 'ArrowUp' || key === 'k') {
        handled();
        setThreadSel(s => Math.max(0, s - 1));
      } else if (key === 'Enter' || key === ' ' || key === 'ArrowRight') {
        const message = thread[threadSel];
        if (message) {
          handled();
          toggle(message.id);
        }
      }
      return;
    }
    if (key === 'Escape') {
      handled();
      onExitFocus?.();
    } else if (key === 'ArrowDown' || key === 'j') {
      handled();
      setSel(s => Math.min(list.length - 1, s + 1));
    } else if (key === 'ArrowUp' || key === 'k') {
      handled();
      setSel(s => Math.max(0, s - 1));
    } else if (key === 'Enter' || key === 'ArrowRight') {
      if (list[sel]) {
        handled();
        openThread(sel);
      }
    }
  };

  // keep the selected row in view while the panel owns focus
  useEffect(() => {
    const root = rootRef.current;
    if (!root?.contains(document.activeElement)) return;
    const selector =
      mode.kind === 'thread'
        ? thread[threadSel] &&
          `[data-chatter-thread-message="${CSS.escape(thread[threadSel].id)}"]`
        : list[sel] && `[data-chatter-row="${CSS.escape(list[sel].id)}"]`;
    if (selector)
      root.querySelector(selector)?.scrollIntoView({ block: 'nearest' });
  }, [list, mode, sel, thread, threadSel]);

  const color = projectColor ?? HUD.cyan;
  const recipients =
    mode.kind === 'thread' ? [mode.a, mode.b].filter(e => !isOperator(e)) : [];
  const lastAgentSender = [...thread]
    .reverse()
    .find((m: MessageRecord) => m.from.kind === 'agent')?.from.sessionId;

  return (
    <div
      ref={rootRef}
      data-chatter
      data-dock-focus
      data-chatter-project={projectId ?? undefined}
      data-chatter-status={state.status}
      data-chatter-mode={mode.kind}
      aria-label="Agent chatter"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-1 flex-col outline-none"
    >
      <div
        className="flex min-h-[37px] shrink-0 items-center gap-1.5 border-b px-3 py-2"
        style={{ borderColor: HUD.strokeFaint }}
      >
        {mode.kind === 'thread' ? (
          <>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Back to all messages"
              onClick={backToList}
              className="rounded px-1 font-mono text-xs outline-none hover:bg-hud-fill-hi"
              style={{ color: HUD.textDim }}
            >
              ←
            </button>
            <span className="flex min-w-0 items-center gap-1 font-ui text-chrome-label">
              {[mode.a, mode.b].map((endpoint, index) => {
                const tabId = isOperator(endpoint)
                  ? null
                  : (participants.get(endpoint.sessionId)?.tabId ?? null);
                return (
                  <span
                    key={endpoint.sessionId}
                    className="flex min-w-0 items-center gap-1"
                  >
                    {index === 1 && (
                      <span aria-hidden style={{ color: HUD.textDim }}>
                        ⇄
                      </span>
                    )}
                    {tabId ? (
                      <button
                        type="button"
                        tabIndex={-1}
                        data-chatter-jump={endpoint.sessionId}
                        title="Open this Agent's tab"
                        onClick={() => onSelectSession(tabId)}
                        className="min-w-0 rounded px-0.5 outline-none hover:bg-hud-fill-hi"
                      >
                        <ChatterEndpoint
                          endpoint={endpoint}
                          participants={participants}
                          strong
                        />
                      </button>
                    ) : (
                      <ChatterEndpoint
                        endpoint={endpoint}
                        participants={participants}
                        strong
                      />
                    )}
                  </span>
                );
              })}
            </span>
          </>
        ) : (
          <>
            <span
              aria-hidden
              className="inline-block h-3.5 w-[3px] shrink-0 rounded-full"
              style={{ background: color, boxShadow: `0 0 4px ${color}88` }}
            />
            <span
              className="min-w-0 truncate font-display text-sm font-semibold"
              style={{ color: HUD.text }}
            >
              {projectName ?? 'No project'}
            </span>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!projectId ? (
          <p
            className="px-3 py-4 text-xs leading-5"
            style={{ color: HUD.textDim }}
          >
            Open a project to see its agent messages.
          </p>
        ) : state.status === 'loading' ? (
          <div
            className="flex flex-col gap-2 p-3"
            aria-label="Loading messages"
          >
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="h-9 rounded motion-safe:animate-pulse"
                style={{ background: HUD.fill }}
              />
            ))}
          </div>
        ) : state.status === 'unavailable' ? (
          <p
            data-chatter-unavailable
            className="px-3 py-4 font-ui text-chrome-label leading-5"
            style={{ color: HUD.textDim }}
          >
            {state.reason}
          </p>
        ) : state.status === 'error' ? (
          <p
            data-chatter-error
            className="px-3 py-4 font-ui text-chrome-label leading-5"
            style={{ color: HUD.amber }}
          >
            Could not read agent messages. {state.message}
          </p>
        ) : list.length === 0 ? (
          <p
            data-chatter-empty
            className="px-3 py-4 font-ui text-chrome-label leading-5"
            style={{ color: HUD.textDim }}
          >
            No agent messages in this project yet.
          </p>
        ) : mode.kind === 'thread' ? (
          <ul data-chatter-thread aria-label="Conversation">
            {thread.map((message, index) => (
              <ChatterThreadMessage
                key={message.id}
                message={message}
                participants={participants}
                projectName={projectName}
                now={now}
                expanded={expanded.has(message.id)}
                selected={index === threadSel}
                onToggle={() => {
                  setThreadSel(index);
                  toggle(message.id);
                  focusRoot();
                }}
                onHover={() => setThreadSel(index)}
              />
            ))}
          </ul>
        ) : (
          <div data-chatter-list className="py-1">
            {list.map((message, index) => (
              <ChatterRow
                key={message.id}
                message={message}
                participants={participants}
                now={now}
                unread={
                  message.from.kind !== 'operator' && message.at > baseline
                }
                selected={index === sel}
                onOpen={() => {
                  setSel(index);
                  openThread(index);
                }}
                onHover={() => setSel(index)}
              />
            ))}
          </div>
        )}
      </div>

      {mode.kind === 'thread' && recipients.length > 0 && (
        <ChatterComposer
          key={`${mode.a.sessionId}:${mode.b.sessionId}`}
          recipients={recipients}
          defaultTo={
            recipients.some(r => r.sessionId === lastAgentSender)
              ? (lastAgentSender as string)
              : recipients[0].sessionId
          }
          participants={participants}
          onSend={send}
          onLeave={focusRoot}
        />
      )}

      <div
        className="shrink-0 border-t px-3 py-1.5 font-mono text-chrome-micro"
        style={{ borderColor: HUD.strokeFaint, color: HUD.textDim }}
      >
        {mode.kind === 'thread'
          ? 'move ↑↓ · open ⏎ · reply ⇥ · back esc'
          : 'move ↑↓ · open ⏎ · to Team esc'}
      </div>
    </div>
  );
}
