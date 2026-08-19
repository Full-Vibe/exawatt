'use client';

/**
 * A connected coworker's front door (ENG-033 H2).
 *
 * Opening a connected Agent returns to one stable address: that Agent's own
 * primary conversation. Its other activity sits beneath as a work stack. H1
 * shipped this read-only; H2 adds the composer, and the composer addresses
 * the primary conversation only.
 *
 * This file renders. `remote-agent-model.ts` decides. Every honest-state rule
 * lives there so it can be tested without a DOM, and nothing here may reach a
 * conclusion the model did not hand it.
 *
 * Presentation agrees with the reviewed treatment in
 * `/hud-gallery/connected-source`: placement is dim-text metadata, connection
 * freshness is its own chip, D40 work state stays the Agent's own signal, and
 * last-known content is marked rather than hidden.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
} from 'react';
import {
  ChevronRight,
  Clock,
  Cloud,
  Monitor,
  RefreshCw,
  Send,
  Server,
  Signal,
  Unplug,
} from 'lucide-react';
import type { AgentSourcePlacement } from '@exawatt/core';
import { StatusLight, type StatusLightState } from '@/components/status-light';
import { WORKSPACE_HUD as HUD, withThemeAlpha } from '../workspace-theme';
import {
  EMPTY_OUTBOX,
  EMPTY_WORK_STACK,
  SEND_REFUSAL_COPY,
  applyConversationUpdate,
  describeRemoteAgent,
  historyCarries,
  mergeTurns,
  normalizeSendRefusal,
  outboxReducer,
  type ConversationLoad,
  type ConversationTurn,
  type ConversationUpdate,
  type OutboundMessage,
  type RemoteConnectionView,
  type RemoteWorkStack,
  type WorkSection,
  type WriteAuthority,
} from './remote-agent-model';

/* -------------------------------------------------------------------------- */
/* The bridge                                                                 */
/* -------------------------------------------------------------------------- */

export type ConversationReply =
  | {
      ok: true;
      /** The Agent's primary conversation, as the source declares it. */
      contextId: string;
      turns: readonly ConversationTurn[];
      /** The source holds turns older than the ones carried here. */
      hasMore: boolean;
    }
  /** The source declares no primary conversation for this Agent. */
  | { ok: true; contextId: null }
  | { ok: false; reason: string };

export type SendReply = { ok: true } | { ok: false; refusal: string };

/** The main-process capability this surface drives. */
export interface RemoteAgentBridge {
  conversation(
    agentId: string,
    options?: { before?: string; limit?: number }
  ): Promise<ConversationReply>;
  send(
    agentId: string,
    text: string,
    options?: { clientId?: string }
  ): Promise<SendReply>;
  onConversation(handler: (update: ConversationUpdate) => void): () => void;
}

/**
 * The Electron bridge, when this build has one.
 *
 * This is the ONE adapter between `connected-sources`' IPC vocabulary and the
 * surface's. Each method is checked at runtime rather than assumed: a renderer
 * outside the desktop app has the whole capability absent, and a build whose
 * main process has not landed the command path yet has `send` absent while
 * `conversation` works.
 *
 * Two shapes differ and are translated here rather than anywhere else:
 *
 * - a refusal named `no-primary-conversation` is the source's explicit answer
 *   that this Agent HAS no Home, which the surface models as `contextId: null`
 *   rather than as a failed read;
 * - the live channel forwards reply TEXT with an ordinal, not turns, so each
 *   delta is given a deterministic id from (agent, run, ordinal). The same
 *   delta arriving twice therefore merges instead of posting twice, and the
 *   authoritative snapshot still wins on reconnect.
 */
export function electronRemoteAgentBridge(): RemoteAgentBridge | null {
  if (typeof window === 'undefined') return null;
  const api = window.electron?.connectedSources;
  if (
    !api ||
    typeof api.conversation !== 'function' ||
    typeof api.send !== 'function' ||
    typeof api.onConversationUpdate !== 'function'
  ) {
    return null;
  }
  return {
    conversation: async (agentId, options) => {
      const reply = await api.conversation(agentId, {
        ...(options?.limit === undefined ? {} : { limit: options.limit }),
        ...(options?.before === undefined
          ? {}
          : { beforeTurnId: options.before }),
      });
      if (!reply.ok) {
        return reply.outcome === 'no-primary-conversation'
          ? { ok: true, contextId: null }
          : { ok: false, reason: reply.outcome };
      }
      return {
        ok: true,
        contextId: reply.contextId,
        turns: reply.turns.map(turn => ({
          id: turn.id,
          role: turn.role,
          text: turn.text,
          timestamp: turn.at,
        })),
        hasMore: reply.hasMore,
      };
    },
    send: async (agentId, text, options) => {
      const reply = await api.send(agentId, text, {
        ...(options?.clientId === undefined
          ? {}
          : { idempotencyKey: options.clientId }),
      });
      if (reply.ok) return { ok: true };
      // Two IPC refusals mean the same thing to the operator: this device may
      // not write yet. The composer already says which half is outstanding.
      const refusal =
        reply.outcome === 'read-only-source' ||
        reply.outcome === 'approval-pending'
          ? 'no-write-authority'
          : reply.outcome;
      return { ok: false, refusal };
    },
    onConversation: handler =>
      api.onConversationUpdate(update => {
        if (!update.text) return;
        handler({
          agentId: update.agentId,
          contextId: update.contextId,
          runId: update.runId,
          turns: [
            {
              id: `${update.agentId}:${update.runId ?? 'run'}:${update.ordinal}`,
              role: 'agent',
              text: update.text,
              timestamp: update.at,
            },
          ],
        });
      }),
  };
}

/* -------------------------------------------------------------------------- */
/* Chrome                                                                     */
/* -------------------------------------------------------------------------- */

type Glyph = ComponentType<{ size?: number | string; className?: string }>;

const PLACEMENT: Record<AgentSourcePlacement, { label: string; Glyph: Glyph }> =
  {
    local: { label: 'Local', Glyph: Monitor },
    'customer-hosted': { label: 'Remote', Glyph: Server },
    'exawatt-hosted': { label: 'Exawatt Cloud', Glyph: Cloud },
  };

const CONNECTION_GLYPH: Record<RemoteConnectionView['state'], Glyph> = {
  live: Signal,
  reconnecting: RefreshCw,
  stale: Clock,
  unavailable: Unplug,
};

const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--exa-hud-cyan,#19e6ff)]';

const TRANSITION =
  'transition-colors duration-200 motion-reduce:transition-none';

function QuietButton({
  children,
  emphasis = 'quiet',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  emphasis?: 'quiet' | 'standard';
}) {
  return (
    <button
      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded px-3 text-chrome-label ${TRANSITION} ${FOCUS_RING} disabled:opacity-60`}
      style={{
        color: emphasis === 'quiet' ? HUD.textDim : HUD.text,
        border:
          emphasis === 'quiet'
            ? '1px solid transparent'
            : `1px solid ${withThemeAlpha(HUD.textDim, 0.32)}`,
      }}
      type={type}
      {...rest}
    >
      {children}
    </button>
  );
}

function ConnectionChip({
  state,
  label,
}: {
  state: RemoteConnectionView['state'];
  label: string;
}) {
  const ChipGlyph = CONNECTION_GLYPH[state];
  const ink = state === 'unavailable' ? HUD.amber : HUD.textDim;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-0.5 text-chrome-meta"
      data-connection-chip={state}
      style={{
        color: ink,
        borderColor: withThemeAlpha(ink, 0.32),
        background: withThemeAlpha(ink, 0.06),
      }}
    >
      <ChipGlyph size={12} />
      {label}
    </span>
  );
}

function LastKnownBadge({ label }: { label: string }) {
  return (
    <span
      className="rounded border px-1.5 py-0.5 text-chrome-meta"
      data-last-known
      style={{
        color: HUD.textDim,
        borderColor: withThemeAlpha(HUD.textDim, 0.28),
      }}
    >
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Transcript                                                                 */
/* -------------------------------------------------------------------------- */

const ROLE_LABEL = {
  operator: 'You',
  agent: null,
  system: null,
} as const;

function Turn({
  turn,
  agentName,
  dimmed,
}: {
  turn: ConversationTurn;
  agentName: string;
  dimmed: boolean;
}) {
  const who = turn.role === 'operator' ? ROLE_LABEL.operator : agentName;
  return (
    <li
      className="flex flex-col gap-0.5"
      data-turn={turn.id}
      data-turn-role={turn.role}
      style={{ opacity: dimmed ? 0.62 : 1 }}
    >
      <p className="flex items-baseline gap-2">
        <span
          className="text-chrome-label font-medium"
          style={{ color: HUD.text }}
        >
          {turn.role === 'system' ? 'Note' : who}
        </span>
        <time
          className="font-mono text-chrome-meta"
          dateTime={new Date(turn.timestamp).toISOString()}
          style={{ color: HUD.textDim }}
        >
          {new Date(turn.timestamp).toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </time>
      </p>
      <p
        className="text-sm whitespace-pre-wrap"
        style={{ color: turn.role === 'system' ? HUD.textDim : HUD.text }}
      >
        {turn.text}
      </p>
    </li>
  );
}

function PendingTurn({ entry }: { entry: OutboundMessage }) {
  return (
    <li
      className="flex flex-col gap-0.5"
      data-outbound={entry.localId}
      data-outbound-status={entry.status}
    >
      <p className="flex items-baseline gap-2">
        <span
          className="text-chrome-label font-medium"
          style={{ color: HUD.text }}
        >
          {ROLE_LABEL.operator}
        </span>
        <span className="text-chrome-meta" style={{ color: HUD.textDim }}>
          {entry.status === 'sending' ? 'Sending' : 'Not delivered'}
        </span>
      </p>
      <p
        className="text-sm whitespace-pre-wrap"
        style={{ color: HUD.text, opacity: 0.72 }}
      >
        {entry.text}
      </p>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Work stack                                                                 */
/* -------------------------------------------------------------------------- */

function WorkStackSection({ section }: { section: WorkSection }) {
  const [open, setOpen] = useState(!section.collapsed);
  const bodyId = useId();
  const body = (
    <ul className="flex flex-col gap-2" id={bodyId}>
      {section.items.map(item => (
        <li
          className="flex flex-col gap-0.5"
          data-work-item={item.id}
          key={item.id}
        >
          <p className="text-sm" style={{ color: HUD.text }}>
            {item.title}
          </p>
          {item.detail ? (
            <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
              {item.detail}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <section className="flex flex-col gap-1.5" data-work-section={section.id}>
      {section.collapsed ? (
        <>
          <button
            aria-controls={bodyId}
            aria-expanded={open}
            className={`inline-flex min-h-11 items-center gap-1.5 self-start rounded px-1 text-chrome-title font-medium ${TRANSITION} ${FOCUS_RING}`}
            onClick={() => setOpen(value => !value)}
            style={{ color: HUD.text }}
            type="button"
          >
            <ChevronRight
              className={`transition-transform duration-200 motion-reduce:transition-none ${
                open ? 'rotate-90' : ''
              }`}
              size={13}
            />
            {section.title}
            {section.summary ? (
              <span
                className="font-mono text-chrome-meta"
                style={{ color: HUD.textDim }}
              >
                {section.summary}
              </span>
            ) : null}
          </button>
          {open ? body : null}
        </>
      ) : (
        <>
          <h3
            className="text-chrome-title font-medium"
            style={{ color: HUD.text }}
          >
            {section.title}
          </h3>
          {body}
        </>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The surface                                                                */
/* -------------------------------------------------------------------------- */

export interface RemoteAgentSurfaceProps {
  agent: {
    id: string;
    name: string;
    project: string;
    /** D40 work state, in the same vocabulary a local Agent uses. */
    workState: StatusLightState;
    placement: AgentSourcePlacement;
    sourceName: string;
  };
  connection: RemoteConnectionView;
  /** What the source says this device may do. Read the source, never guess. */
  authority: WriteAuthority;
  work?: RemoteWorkStack;
  /** A subordinate context on screen. It never changes the composer's target. */
  viewing?: { contextId: string; title: string } | null;
  /** Defaults to the Electron bridge; injected in tests and previews. */
  bridge?: RemoteAgentBridge | null;
  /** Carries a send-access request to the source, when the host can. */
  onRequestWriteAccess?: () => void;
  /** Repairs observation. Never touches the remote Agent's work. */
  onReconnect?: () => void;
}

let localIdSeed = 0;
function nextLocalId(agentId: string): string {
  localIdSeed += 1;
  return `${agentId}:out:${localIdSeed}`;
}

export function RemoteAgentSurface({
  agent,
  connection,
  authority,
  work = EMPTY_WORK_STACK,
  viewing = null,
  bridge,
  onRequestWriteAccess,
  onReconnect,
}: RemoteAgentSurfaceProps) {
  const resolvedBridge = useMemo(
    () => (bridge === undefined ? electronRemoteAgentBridge() : bridge),
    [bridge]
  );
  const bridgeRef = useRef(resolvedBridge);
  bridgeRef.current = resolvedBridge;

  const [load, setLoad] = useState<ConversationLoad>({ kind: 'loading' });
  const [outbox, dispatchOutbox] = useReducer(outboxReducer, EMPTY_OUTBOX);
  const [draft, setDraft] = useState('');
  const [retryId, setRetryId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<ReturnType<
    typeof normalizeSendRefusal
  > | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const composerId = useId();
  /** What is in the field right now, readable from an awaited send. */
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /**
   * Read the authoritative conversation. This is the only way turns enter the
   * surface from scratch: after a reconnect Exawatt resnapshots rather than
   * assuming the source replays the events it missed.
   */
  const readConversation = useCallback(async () => {
    const api = bridgeRef.current;
    if (!api) return;
    let reply: ConversationReply;
    try {
      reply = await api.conversation(agent.id);
    } catch {
      // A failed read is not evidence about the Agent. Whatever is on screen
      // stays, and freshness is what says it is not current.
      setLoad(current =>
        current.kind === 'declared'
          ? {
              kind: 'unread',
              contextId: current.contextId,
              turns: current.turns,
              olderAvailable: current.olderAvailable,
            }
          : current
      );
      return;
    }
    if (!reply.ok) {
      setLoad(current =>
        current.kind === 'declared'
          ? {
              kind: 'unread',
              contextId: current.contextId,
              turns: current.turns,
              olderAvailable: current.olderAvailable,
            }
          : {
              kind: 'unread',
              contextId: null,
              turns: [],
              olderAvailable: false,
            }
      );
      return;
    }
    if (reply.contextId === null) {
      setLoad({ kind: 'absent' });
      return;
    }
    const snapshot = reply;
    setLoad(current => ({
      kind: 'declared',
      contextId: snapshot.contextId,
      // The snapshot is authoritative, and it is also the thing that tells
      // this client whether a message it sent actually landed. Merging keeps
      // any turn that arrived by stream in the same read.
      turns: mergeTurns(
        current.kind === 'declared' || current.kind === 'unread'
          ? current.turns
          : [],
        snapshot.turns
      ),
      olderAvailable: snapshot.hasMore,
    }));
  }, [agent.id]);

  useEffect(() => {
    setLoad({ kind: 'loading' });
    void readConversation();
  }, [readConversation]);

  /** A connection that comes back resnapshots; it never replays. */
  const previousConnection = useRef(connection.state);
  useEffect(() => {
    const was = previousConnection.current;
    previousConnection.current = connection.state;
    if (connection.state === 'live' && was !== 'live') void readConversation();
  }, [connection.state, readConversation]);

  /** Streamed turns, keyed by Agent and context; the model filters them. */
  useEffect(() => {
    const api = bridgeRef.current;
    if (!api) return;
    return api.onConversation(update => {
      setLoad(current => {
        if (current.kind !== 'declared' && current.kind !== 'unread') {
          return current;
        }
        const turns = applyConversationUpdate(current.turns, update, {
          agentId: agent.id,
          primaryContextId: current.contextId,
        });
        return turns === current.turns ? current : { ...current, turns };
      });
    });
  }, [agent.id]);

  const turns = useMemo(
    () =>
      load.kind === 'declared' || load.kind === 'unread' ? load.turns : [],
    [load]
  );

  /**
   * The transcript is the record. Anything it carries leaves the outbox, so a
   * message that landed before the connection dropped is never sent twice and
   * never sits on screen as undelivered.
   */
  useEffect(() => {
    dispatchOutbox({ type: 'reconcile', turns });
    if (
      retryId !== null &&
      historyCarries(turns, { localId: retryId, text: draft })
    ) {
      setRetryId(null);
      setDraft('');
      setRefusal(null);
    }
    // `draft` is read, not tracked: reconciliation runs when turns move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, retryId]);

  const presentation = useMemo(
    () =>
      describeRemoteAgent({
        agent: { id: agent.id, name: agent.name },
        connection,
        authority,
        conversation: load,
        work,
        viewing,
        canRequestWriteAccess: Boolean(onRequestWriteAccess),
        canReconnect: Boolean(onReconnect),
      }),
    [
      agent.id,
      agent.name,
      authority,
      connection,
      load,
      onReconnect,
      onRequestWriteAccess,
      viewing,
      work,
    ]
  );

  const deliver = useCallback(
    async (localId: string, text: string) => {
      const api = bridgeRef.current;
      dispatchOutbox({ type: 'send', localId, text });
      setRefusal(null);
      if (!api) {
        dispatchOutbox({ type: 'refused', localId, refusal: 'disconnected' });
        setRefusal('disconnected');
        return;
      }
      let reply: SendReply;
      try {
        reply = await api.send(agent.id, text, { clientId: localId });
      } catch {
        reply = { ok: false, refusal: 'disconnected' };
      }
      if (reply.ok) {
        dispatchOutbox({ type: 'accepted', localId, at: Date.now() });
        return;
      }
      const normalized = normalizeSendRefusal(reply.refusal);
      dispatchOutbox({ type: 'refused', localId, refusal: normalized });
      setRefusal(normalized);
      // The operator's words come back to them. If they have already started
      // another message, the refused one keeps its own seat with a retry
      // instead of overwriting what they are typing. Either way the text is
      // on screen exactly once, under the same identity, so sending again is
      // a retry rather than a second message.
      if (draftRef.current.trim()) return;
      dispatchOutbox({ type: 'discard', localId });
      setDraft(text);
      setRetryId(current => current ?? localId);
    },
    [agent.id]
  );

  const submit = useCallback(() => {
    if (presentation.composer.kind !== 'ready') return;
    const text = draft.trim();
    if (!text) return;
    const localId = retryId ?? nextLocalId(agent.id);
    setDraft('');
    draftRef.current = '';
    setRetryId(null);
    void deliver(localId, text);
  }, [agent.id, deliver, draft, presentation.composer.kind, retryId]);

  const loadOlder = useCallback(async () => {
    const api = bridgeRef.current;
    if (!api || load.kind !== 'declared') return;
    const oldest = load.turns[0]?.id;
    setLoadingOlder(true);
    try {
      const reply = await api.conversation(agent.id, { before: oldest });
      if (!reply.ok || reply.contextId === null) return;
      const older = reply;
      setLoad(current =>
        current.kind === 'declared'
          ? {
              ...current,
              turns: mergeTurns(older.turns, current.turns),
              olderAvailable: older.hasMore,
            }
          : current
      );
    } catch {
      // Nothing older arrived. What is on screen is unchanged.
    } finally {
      setLoadingOlder(false);
    }
  }, [agent.id, load]);

  const { frontDoor, composer, freshness, sections, subordinateOpen } =
    presentation;
  const placement = PLACEMENT[agent.placement];
  const dimmed = freshness.marked;

  return (
    <section
      className="flex min-h-0 flex-col gap-4 rounded-lg border p-4"
      data-connection={connection.state}
      data-remote-agent={agent.id}
      style={{
        borderColor: withThemeAlpha(HUD.textDim, 0.18),
        background: HUD.bg.panelFill,
      }}
    >
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <StatusLight size="standard" state={agent.workState} />
            <div className="min-w-0">
              <p
                className="truncate text-base font-semibold"
                style={{ color: HUD.text }}
              >
                {agent.name}
              </p>
              <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
                {agent.project}
              </p>
            </div>
          </div>
          <ConnectionChip label={freshness.line} state={freshness.state} />
        </div>
        <p
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-chrome-meta"
          style={{ color: HUD.textDim }}
        >
          <span>{agent.sourceName}</span>
          <span aria-hidden="true">·</span>
          <span
            className="inline-flex items-center gap-1"
            data-placement={agent.placement}
          >
            <placement.Glyph size={12} />
            {placement.label}
          </span>
          {freshness.badge ? <LastKnownBadge label={freshness.badge} /> : null}
        </p>
      </header>

      {frontDoor.kind === 'automations-lead' ? null : (
        <div className="flex min-h-0 flex-col gap-2" data-front-door>
          <div className="flex items-center justify-between gap-3">
            <h2
              className="text-chrome-title font-medium"
              style={{ color: HUD.text }}
            >
              {frontDoor.heading}
            </h2>
            {frontDoor.kind === 'conversation' && frontDoor.olderAvailable ? (
              <QuietButton
                data-load-older="true"
                disabled={loadingOlder}
                onClick={() => void loadOlder()}
              >
                {loadingOlder ? 'Loading earlier' : 'Load earlier'}
              </QuietButton>
            ) : null}
          </div>
          {frontDoor.kind === 'loading' ? (
            <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
              Opening the conversation
            </p>
          ) : (
            <ul
              aria-live="polite"
              aria-relevant="additions"
              className="flex min-h-0 flex-col gap-3 overflow-y-auto"
              data-transcript={frontDoor.contextId}
              role="log"
            >
              {frontDoor.turns.map(turn => (
                <Turn
                  agentName={agent.name}
                  dimmed={dimmed}
                  key={turn.id}
                  turn={turn}
                />
              ))}
              {outbox.map(entry => (
                <PendingTurn entry={entry} key={entry.localId} />
              ))}
            </ul>
          )}
        </div>
      )}

      {subordinateOpen && viewing ? (
        <section
          className="rounded border p-3"
          data-subordinate-context={viewing.contextId}
          style={{ borderColor: withThemeAlpha(HUD.textDim, 0.22) }}
        >
          <p
            className="text-chrome-title font-medium"
            style={{ color: HUD.text }}
          >
            {viewing.title}
          </p>
        </section>
      ) : null}

      {composer.kind === 'ready' ? (
        <form
          className="flex flex-col gap-2 rounded border p-2"
          data-composer-target={composer.target.contextId}
          onSubmit={event => {
            event.preventDefault();
            submit();
          }}
          style={{
            borderColor: withThemeAlpha(HUD.textDim, 0.28),
            background: HUD.surfaceInput,
          }}
        >
          <label
            className="flex items-center gap-1.5 text-chrome-meta"
            htmlFor={composerId}
            style={{ color: HUD.textDim }}
          >
            <span>To</span>
            <span
              className="rounded border px-1.5 py-0.5"
              data-composer-target-label
              style={{
                color: HUD.text,
                borderColor: withThemeAlpha(HUD.textDim, 0.28),
              }}
            >
              {composer.target.label}
            </span>
            <span>{composer.target.agentName}</span>
          </label>
          <textarea
            className={`max-h-40 w-full resize-none bg-transparent text-sm [field-sizing:content] placeholder:opacity-70 ${FOCUS_RING}`}
            id={composerId}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={composer.placeholder}
            rows={1}
            style={{ color: HUD.text }}
            value={draft}
          />
          <div className="flex items-center justify-end gap-2">
            <QuietButton
              disabled={!draft.trim()}
              emphasis="standard"
              type="submit"
            >
              <Send size={12} />
              Send
            </QuietButton>
          </div>
        </form>
      ) : (
        <div
          className="flex flex-col gap-1.5 rounded border p-3"
          data-composer-withheld={composer.reason}
          data-conversation-state={
            composer.reason === 'no-primary-conversation'
              ? 'unavailable'
              : undefined
          }
          style={{ borderColor: withThemeAlpha(HUD.textDim, 0.22) }}
        >
          <p className="text-sm" style={{ color: HUD.text }}>
            {composer.headline}
          </p>
          {composer.detail ? (
            <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
              {composer.detail}
            </p>
          ) : null}
          {composer.action ? (
            <QuietButton
              data-composer-action={composer.action.id}
              emphasis="standard"
              onClick={
                composer.action.id === 'request-send-access'
                  ? onRequestWriteAccess
                  : onReconnect
              }
            >
              {composer.action.label}
            </QuietButton>
          ) : null}
        </div>
      )}

      {refusal ? (
        <div
          className="flex flex-col gap-1.5 rounded border p-3"
          data-send-refusal={refusal}
          role="status"
          style={{
            borderColor: withThemeAlpha(HUD.amber, 0.32),
            background: withThemeAlpha(HUD.amber, 0.06),
          }}
        >
          <p className="text-sm" style={{ color: HUD.text }}>
            {SEND_REFUSAL_COPY[refusal].headline}
          </p>
          <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
            {SEND_REFUSAL_COPY[refusal].nextStep}
          </p>
          {outbox
            .filter(entry => entry.status === 'refused')
            .map(entry => (
              <QuietButton
                data-retry={entry.localId}
                key={entry.localId}
                onClick={() => void deliver(entry.localId, entry.text)}
              >
                <RefreshCw size={12} />
                Send again
              </QuietButton>
            ))}
        </div>
      ) : null}

      {sections.length > 0 ? (
        <div className="flex flex-col gap-3" data-work-stack>
          {sections.map(section => (
            <WorkStackSection key={section.id} section={section} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
