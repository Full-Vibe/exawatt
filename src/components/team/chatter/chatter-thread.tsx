/**
 * The zoom-in (ENG-029 C1 live): the conversation between two Sessions,
 * oldest first, each message two lines until it is opened in place, with
 * Exawatt's stamped envelope visible when open. No bubbles: the operator is
 * reading a log, not a chat (operator, 2026-10-15: "Chronological list,
 * collapsed to two lines, expand in place").
 */
import { useRef, useState } from 'react';
import { sessionSource } from '@/components/workspace/harnesses';
import { WORKSPACE_HUD as HUD } from '@/components/workspace/workspace-theme';
import { firstLine } from '@/lib/bus/selectors';
import type { BusEndpoint, MessageRecord, BusSendResult } from '@exawatt/core';
import { DELIVERY_LABEL, chatterAge, chatterStamp } from './chatter-format';
import {
  ChatterEndpoint,
  endpointLabel,
  isOperator,
  type ChatterParticipants,
} from './chatter-endpoint';
import { DeliveryGlyph } from './delivery-glyph';

function harnessName(endpoint: BusEndpoint): string {
  return isOperator(endpoint)
    ? 'operator'
    : sessionSource(endpoint.harness).label;
}

export function ChatterThreadMessage({
  message,
  participants,
  projectName,
  now,
  expanded,
  selected,
  onToggle,
  onHover,
}: {
  message: MessageRecord;
  participants: ChatterParticipants;
  projectName: string | null;
  now: number;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onHover: () => void;
}) {
  return (
    <li
      data-chatter-thread-message={message.id}
      data-expanded={expanded || undefined}
      data-selected={selected || undefined}
      onMouseEnter={onHover}
      className="border-b"
      style={{
        borderColor: HUD.strokeFaint,
        background: selected ? HUD.fillHi : 'transparent',
      }}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left outline-none"
      >
        <span className="flex w-full min-w-0 items-center gap-1 font-ui text-chrome-label">
          <ChatterEndpoint
            endpoint={message.from}
            participants={participants}
            strong
          />
          <span aria-hidden className="shrink-0" style={{ color: HUD.textDim }}>
            →
          </span>
          <ChatterEndpoint endpoint={message.to} participants={participants} />
          <span
            className="ml-auto shrink-0 pl-1.5 font-mono text-chrome-micro tabular-nums"
            style={{ color: HUD.textDim }}
          >
            {chatterAge(message.at, now)}
          </span>
          <DeliveryGlyph delivery={message.delivery} size={11} />
        </span>
        {!expanded && (
          <span
            className="block w-full truncate font-ui text-chrome-meta"
            style={{ color: HUD.textDim }}
          >
            {firstLine(message.text)}
          </span>
        )}
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 px-3 pb-2.5">
          <p
            data-chatter-text
            className="whitespace-pre-wrap break-words font-ui text-chrome-title leading-[1.45]"
            style={{ color: HUD.text }}
          >
            {message.text}
          </p>
          {/* Exawatt's stamp: who, which harness, which Project, when, and
              what the recipient's door did with it */}
          <dl
            data-chatter-stamp
            className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded border px-2 py-1.5 font-mono text-chrome-micro"
            style={{ borderColor: HUD.strokeFaint, color: HUD.textDim }}
          >
            <dt>from</dt>
            <dd className="min-w-0 truncate" style={{ color: HUD.textMono }}>
              {endpointLabel(message.from, participants)} ·{' '}
              {harnessName(message.from)}
            </dd>
            <dt>to</dt>
            <dd className="min-w-0 truncate" style={{ color: HUD.textMono }}>
              {endpointLabel(message.to, participants)} ·{' '}
              {harnessName(message.to)}
            </dd>
            {projectName && (
              <>
                <dt>project</dt>
                <dd className="min-w-0 truncate">{projectName}</dd>
              </>
            )}
            <dt>sent</dt>
            <dd>{chatterStamp(message.at, now)}</dd>
            <dt>result</dt>
            <dd className="flex min-w-0 flex-col gap-0.5">
              <DeliveryGlyph delivery={message.delivery} size={11} withLabel />
              {message.delivery.reason && (
                <span className="font-ui text-chrome-meta">
                  {message.delivery.reason}
                </span>
              )}
            </dd>
          </dl>
        </div>
      )}
    </li>
  );
}

type ComposerState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'done'; result: BusSendResult; to: string };

/**
 * Send as operator: the human's own turn to one Session of the thread,
 * `kind: operator`, with the delivery result shown where it was sent.
 */
export function ChatterComposer({
  recipients,
  defaultTo,
  participants,
  onSend,
  onLeave,
}: {
  recipients: readonly BusEndpoint[];
  defaultTo: string;
  participants: ChatterParticipants;
  onSend: (to: string, text: string) => Promise<BusSendResult>;
  /** Escape in the field: hand the keyboard back to the thread */
  onLeave: () => void;
}) {
  const [to, setTo] = useState(defaultTo);
  const [text, setText] = useState('');
  const [state, setState] = useState<ComposerState>({ phase: 'idle' });
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const recipient = recipients.find(r => r.sessionId === to) ?? recipients[0];

  const send = async () => {
    const body = text.trim();
    if (!body || !recipient || state.phase === 'sending') return;
    setState({ phase: 'sending' });
    const result = await onSend(recipient.sessionId, body);
    setState({
      phase: 'done',
      result,
      to: endpointLabel(recipient, participants),
    });
    if (result.record) setText('');
  };

  return (
    <form
      data-chatter-composer
      onSubmit={event => {
        event.preventDefault();
        void send();
      }}
      className="flex shrink-0 flex-col gap-1.5 border-t px-3 py-2"
      style={{ borderColor: HUD.strokeFaint }}
    >
      <div className="flex min-w-0 items-center gap-1.5 font-ui text-chrome-meta">
        <span style={{ color: HUD.textDim }}>Send as operator to</span>
        {recipients.length > 1 ? (
          <span
            role="radiogroup"
            aria-label="Recipient"
            className="flex min-w-0 gap-1"
          >
            {recipients.map(candidate => {
              const chosen = candidate.sessionId === recipient?.sessionId;
              return (
                <button
                  key={candidate.sessionId}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  data-chatter-recipient={candidate.sessionId}
                  onClick={() => setTo(candidate.sessionId)}
                  className="min-w-0 truncate rounded border px-1.5 py-px outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                  style={{
                    borderColor: chosen ? HUD.stroke : HUD.strokeFaint,
                    color: chosen ? HUD.text : HUD.textDim,
                    background: chosen ? HUD.fillHi : 'transparent',
                  }}
                >
                  {endpointLabel(candidate, participants)}
                </button>
              );
            })}
          </span>
        ) : (
          recipient && (
            <span className="min-w-0 truncate" style={{ color: HUD.text }}>
              {endpointLabel(recipient, participants)}
            </span>
          )
        )}
      </div>
      <textarea
        ref={fieldRef}
        data-chatter-field
        value={text}
        rows={2}
        aria-label={
          recipient
            ? `Message to ${endpointLabel(recipient, participants)}`
            : 'Message'
        }
        placeholder="Message"
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.stopPropagation();
            void send();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onLeave();
          }
        }}
        className="min-h-12 w-full resize-none rounded border px-2 py-1.5 font-ui text-chrome-title outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
        style={{
          borderColor: HUD.strokeSoft,
          background: HUD.surfaceInput,
          color: HUD.text,
        }}
      />
      <div className="flex min-h-6 items-center gap-2">
        <span
          data-chatter-send-result={
            state.phase === 'done'
              ? state.result.record
                ? state.result.record.delivery.state
                : 'refused'
              : undefined
          }
          aria-live="polite"
          className="min-w-0 flex-1 truncate font-ui text-chrome-meta"
          style={{
            color:
              state.phase === 'done' && !state.result.record
                ? HUD.amber
                : HUD.textDim,
          }}
          title={
            state.phase === 'done'
              ? (state.result.record?.delivery.reason ??
                state.result.delivery.reason)
              : undefined
          }
        >
          {state.phase === 'sending'
            ? 'Sending…'
            : state.phase === 'done'
              ? state.result.record
                ? `${DELIVERY_LABEL[state.result.record.delivery.state]} · ${state.to}`
                : (state.result.delivery.reason ?? 'Not sent')
              : null}
        </span>
        <button
          type="submit"
          disabled={!text.trim() || state.phase === 'sending'}
          className="shrink-0 rounded px-2 py-1 font-ui text-chrome-label font-medium outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan disabled:opacity-40"
          style={{ background: HUD.fillHi, color: HUD.text }}
        >
          Send{' '}
          <span
            className="font-mono text-chrome-micro"
            style={{ color: HUD.textDim }}
          >
            ⌘↩
          </span>
        </button>
      </div>
    </form>
  );
}
