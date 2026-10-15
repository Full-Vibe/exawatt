'use client';

/**
 * The Agent Source card: one source's identity, its state, and the ONE next
 * step that repairs it (ENG-003 S5.3.1; ENG-046's Start screen reuses it).
 *
 * Pure and controlled. Nothing here reads the registry, calls IPC, or keeps
 * a timer: the caller passes the facts (identity, state, freshness), the step
 * `sourceCardStep` derives from a snapshot, and the handlers. Settings wraps
 * it with the live registry; the Start screen and the gallery feed fixtures.
 *
 * Two layouts of the same parts:
 *
 *   `detail` — the head of Settings → Agent Sources: identity over the title,
 *     the state pill, the summary, the attention notice, the step, Recheck,
 *     and the action's status line. Fact sections follow as children.
 *   `card`   — a compact tile: identity row with the pill, the disclosure,
 *     the step and Recheck, and the freshness on the same line.
 *
 * Paint comes from the Settings operational neutrals (design-system rung 3),
 * which `[data-source-card]` scopes onto the card itself, so it reads the
 * same inside Settings and anywhere else it is placed.
 */

import {
  AlertCircle,
  Check,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  SquareTerminal,
  WifiOff,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { SourceGlyph } from '@/components/workspace/harness-icons';
import { SourceIdentityMark } from '@/components/workspace/source-identity-mark';
import { cn } from '@/lib/utils';
import { agentSourceDeclaration } from '@/generated/agent-source-declarations';
import type {
  AgentSourceAdapterId,
  AgentSourceCatalogId,
  AgentSourceDisclosure,
  AgentSourceShellSignIn,
  AgentSourceSnapshot,
  AgentSourceState,
} from '@exawatt/core';

/* ------------------------------------------------------------------ */
/* Tone                                                                */
/* ------------------------------------------------------------------ */

interface SourceTone {
  color: string;
  wash: string;
}

const QUIET_TONE: SourceTone = {
  color: 'var(--settings-dim)',
  wash: 'color-mix(in srgb, var(--settings-dim) 8%, transparent)',
};

/** Ready is the action role, a repair the attention role, a failed check
 *  the fault role; everything not yet known stays quiet. */
export function sourceStateTone(state: AgentSourceState): SourceTone {
  if (state === 'ready') {
    return { color: 'var(--settings-teal)', wash: 'var(--settings-teal-wash)' };
  }
  if (state === 'action-required' || state === 'connecting') {
    return {
      color: 'var(--settings-amber)',
      wash: 'var(--settings-amber-wash)',
    };
  }
  if (
    state === 'degraded' ||
    state === 'unavailable' ||
    state === 'incompatible'
  ) {
    return { color: 'var(--settings-red)', wash: 'var(--settings-red-wash)' };
  }
  return QUIET_TONE;
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/** A source's mark in its instrument plate's glyph slot. A source with no
 *  vendor mark (Demo Mode, a coming-soon adapter, a mark Exawatt may not
 *  ship) shows the neutral sparkle. */
export function SourceMark({
  id,
  size = 19,
}: {
  id: AgentSourceCatalogId;
  size?: number;
}) {
  return (
    <SourceGlyph
      source={id}
      size={size}
      fallback={<Sparkles aria-hidden size={size} />}
    />
  );
}

/** The pill every source-truth state wears: tone ink, a 34% border and the
 *  tone's wash, with a dot so hue never carries the state alone (D30). */
export function SourceTonePill({
  tone,
  children,
  ...data
}: {
  tone: SourceTone;
  children: ReactNode;
} & { [attribute: `data-${string}`]: string | undefined }) {
  return (
    <span
      {...data}
      className="inline-flex min-h-7 items-center gap-2 rounded-full border px-2.5 font-ui text-chrome-label font-medium"
      style={{
        color: tone.color,
        borderColor: `color-mix(in srgb, ${tone.color} 34%, transparent)`,
        background: tone.wash,
      }}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ background: tone.color }}
      />
      {children}
    </span>
  );
}

/** The two glyphs a source-truth row shares with a connection row: a ringed
 *  check for ready, a turning loader for a check in flight. */
export function SourceReadyGlyph({ color }: { color: string }) {
  return (
    <span
      className="flex size-5 items-center justify-center rounded-full border"
      style={{ color, borderColor: color }}
    >
      <Check aria-hidden size={12} strokeWidth={2.4} />
    </span>
  );
}

export function SourceWorkingGlyph({ color }: { color: string }) {
  return (
    <LoaderCircle
      aria-hidden
      size={20}
      className="animate-spin motion-reduce:animate-none"
      style={{ color }}
    />
  );
}

export function SourceStateGlyph({ state }: { state: AgentSourceState }) {
  const tone = sourceStateTone(state);
  if (state === 'ready') return <SourceReadyGlyph color={tone.color} />;
  if (state === 'connecting' || state === 'checking') {
    return <SourceWorkingGlyph color={tone.color} />;
  }
  if (state === 'degraded' || state === 'unavailable') {
    return <WifiOff aria-hidden size={20} style={{ color: tone.color }} />;
  }
  return <AlertCircle aria-hidden size={20} style={{ color: tone.color }} />;
}

function SourceStatePill({
  state,
  label,
}: {
  state: AgentSourceState;
  label: string;
}) {
  return (
    <SourceTonePill
      tone={sourceStateTone(state)}
      data-source-state-pill={state}
    >
      {label}
    </SourceTonePill>
  );
}

function relativeTime(timestamp: number, now: number): string {
  if (!timestamp) return 'not observed';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1_000));
  if (seconds < 10) return 'now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/** An observation's age, with the exact instant one hover away. Needs a
 *  `TooltipProvider` above it, as every Radix tooltip does. */
export function SourceObservationTime({
  timestamp,
  now,
  prefix = '',
}: {
  timestamp: number;
  now: number;
  prefix?: string;
}) {
  const exact = timestamp
    ? new Date(timestamp).toLocaleString()
    : 'No live observation';
  const iso = timestamp ? new Date(timestamp).toISOString() : undefined;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${prefix}${exact}`}
          className="inline-flex min-h-7 max-w-full items-center gap-1 rounded px-1 font-ui text-chrome-label text-[var(--settings-faint)] outline-none hover:bg-[var(--settings-hover)] focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)]"
        >
          {prefix ? <span>{prefix.trim()}</span> : null}
          <time dateTime={iso}>{relativeTime(timestamp, now)}</time>
        </button>
      </TooltipTrigger>
      <TooltipContent className="border-[var(--settings-line-strong)] bg-[var(--settings-raised)] font-ui text-chrome-label text-[var(--settings-soft)]">
        {exact}
      </TooltipContent>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/* The one next step                                                   */
/* ------------------------------------------------------------------ */

export type SourceCardStep =
  | { kind: 'install-guide'; label: string }
  | { kind: 'sign-in'; label: string }
  /** The source signs in on its own first interactive run (Antigravity
   *  CLI): the step opens a Shell tab in Exawatt running `command`. */
  | ({ kind: 'shell-sign-in' } & AgentSourceShellSignIn);

/**
 * The ONE step that moves a source toward ready, or null when nothing but a
 * Recheck applies. A missing CLI gets its installation guide; a source that
 * offers a sign-in gets the one its declaration names. Never both: a source
 * that is not installed has nobody to sign in to.
 */
export function sourceCardStep(
  source: Pick<
    AgentSourceSnapshot,
    'adapterId' | 'state' | 'label' | 'harness' | 'actions'
  >
): SourceCardStep | null {
  if (source.state === 'not-installed') {
    return source.actions.installGuide
      ? { kind: 'install-guide', label: 'Open installation guide' }
      : null;
  }
  if (source.actions.authenticate && source.harness) {
    const shell = agentSourceDeclaration(source.adapterId).signIn;
    return shell
      ? { kind: 'shell-sign-in', ...shell }
      : { kind: 'sign-in', label: `Sign in with ${source.label}` };
  }
  return null;
}

/** What the attention notice explains: the fact behind the state. */
export function sourceAttention(
  source: Pick<
    AgentSourceSnapshot,
    'state' | 'stateLabel' | 'facts' | 'actions'
  >
): SourceCardAttention | null {
  if (source.state === 'ready') return null;
  // An unknown sign-in the source offers to repair: the fact is the
  // sign-in's, named by its own value, never a reachability line.
  if (source.state === 'unknown' && source.actions.authenticate) {
    return {
      title: source.facts.authentication.value,
      detail: source.facts.authentication.detail,
      kind: 'sign-in',
    };
  }
  const fact =
    source.state === 'not-installed'
      ? source.facts.installation
      : source.facts.authentication.state === 'action-required'
        ? source.facts.authentication
        : source.facts.reachability;
  return {
    title: source.stateLabel,
    detail: fact.detail,
    kind: source.state === 'action-required' ? 'sign-in' : 'problem',
  };
}

/** The declared disclosure as inline text with its link, in the ink of
 *  whatever line holds it (decision `0051`). Null for a source without one. */
export function SourceDisclosureText({
  adapterId,
}: {
  adapterId: AgentSourceAdapterId;
}) {
  const disclosure: AgentSourceDisclosure | undefined =
    agentSourceDeclaration(adapterId).disclosure;
  if (!disclosure) return null;
  return (
    <>
      {disclosure.text}{' '}
      <a
        href={disclosure.href}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2"
      >
        {disclosure.linkLabel}
      </a>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

interface SourceCardIdentity {
  adapterId: AgentSourceCatalogId;
  label: string;
  /** The line that places the label: "Local CLI", "Antigravity CLI". */
  secondary: string;
  /** Brand colour, painted only inside the instrument plate. */
  color: string;
}

interface SourceCardAttention {
  title: string;
  detail: string;
  kind: 'sign-in' | 'problem';
}

interface SourceCardProps {
  layout?: 'detail' | 'card';
  identity: SourceCardIdentity;
  state: AgentSourceState;
  stateLabel: string;
  /** One sentence of source truth (detail layout only). */
  summary?: string;
  attention?: SourceCardAttention | null;
  step?: SourceCardStep | null;
  onStep?: () => void;
  /** Recheck, when the source can be asked again. */
  onRecheck?: (() => void) | null;
  /** An action or a check is in flight: every action waits for it. */
  busy?: boolean;
  /** What Recheck says while `busy`. */
  busyLabel?: string;
  /** A fixed line the source owes its reader (decision `0051`). */
  disclosure?: ReactNode;
  /** The last action's outcome. */
  message?: { ok: boolean; text: string } | null;
  /** Freshness (card layout; the detail layout dates its fact sections). */
  checkedAt?: number | null;
  now?: number;
  /** Detail sections under the head. */
  children?: ReactNode;
  className?: string;
}

const STEP_BUTTON =
  'flex min-h-10 items-center gap-2 rounded-lg bg-[var(--settings-amber)] px-3.5 font-ui text-chrome-title font-medium text-[var(--settings-shell)] outline-none transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--settings-amber)] motion-reduce:transition-none';
const RECHECK_BUTTON =
  'flex min-h-10 items-center gap-2 rounded-lg border border-[var(--settings-line-strong)] bg-[var(--settings-raised)] px-3.5 font-ui text-chrome-title font-medium text-[var(--settings-soft)] outline-none transition-[background-color,transform] hover:bg-[var(--settings-hover-strong)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)] motion-reduce:transition-none';

function Actions({
  step,
  onStep,
  onRecheck,
  busy,
  busyLabel,
  trailing,
  className,
}: Pick<
  SourceCardProps,
  'step' | 'onStep' | 'onRecheck' | 'busy' | 'busyLabel'
> & { trailing?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {step && (
        <button
          type="button"
          data-source-step={step.kind}
          disabled={busy}
          onClick={onStep}
          className={STEP_BUTTON}
        >
          {step.kind === 'shell-sign-in' ? (
            <SquareTerminal aria-hidden size={15} />
          ) : (
            <ExternalLink aria-hidden size={15} />
          )}
          {step.label}
        </button>
      )}
      {onRecheck && (
        <button
          type="button"
          data-source-recheck
          disabled={busy}
          onClick={onRecheck}
          className={RECHECK_BUTTON}
        >
          <RefreshCw
            aria-hidden
            size={15}
            className={busy ? 'animate-spin motion-reduce:animate-none' : ''}
          />
          {busy ? (busyLabel ?? 'Checking…') : 'Recheck'}
        </button>
      )}
      {trailing}
    </div>
  );
}

function Message({
  message,
}: {
  message: NonNullable<SourceCardProps['message']>;
}) {
  return (
    <p
      role="status"
      className="mt-3 max-w-xl font-ui text-chrome-label leading-5"
      style={{
        color: message.ok ? 'var(--settings-teal)' : 'var(--settings-red)',
      }}
    >
      {message.text}
    </p>
  );
}

export function SourceCard({
  layout = 'detail',
  identity,
  state,
  stateLabel,
  summary,
  attention,
  step,
  onStep,
  onRecheck,
  busy = false,
  busyLabel,
  disclosure,
  message,
  checkedAt,
  now,
  children,
  className,
}: SourceCardProps) {
  if (layout === 'card') {
    return (
      <article
        data-source-card={identity.adapterId}
        data-source-state={state}
        className={cn(
          'flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--settings-line)] bg-[var(--settings-panel)] p-4',
          className
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <SourceIdentityMark
            className="size-9 rounded-lg"
            color={identity.color}
          >
            <SourceMark id={identity.adapterId} />
          </SourceIdentityMark>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-ui text-sm font-medium text-[var(--settings-text)]">
              {identity.label}
            </span>
            <span className="mt-0.5 block truncate font-ui text-chrome-label text-[var(--settings-dim)]">
              {identity.secondary}
            </span>
          </span>
          <SourceStatePill state={state} label={stateLabel} />
        </div>
        {disclosure ? (
          <div
            data-source-disclosure
            className="font-ui text-chrome-meta leading-4 text-[var(--settings-dim)]"
          >
            {disclosure}
          </div>
        ) : null}
        <Actions
          step={step}
          onStep={onStep}
          onRecheck={onRecheck}
          busy={busy}
          busyLabel={busyLabel}
          className="items-center"
          trailing={
            checkedAt && now !== undefined ? (
              <span className="ml-auto">
                <SourceObservationTime
                  timestamp={checkedAt}
                  now={now}
                  prefix="Checked "
                />
              </span>
            ) : null
          }
        />
        {step?.kind === 'shell-sign-in' ? (
          <p
            data-source-step-note
            className="font-ui text-chrome-meta leading-4 text-[var(--settings-dim)]"
          >
            {step.note}
          </p>
        ) : null}
        {message ? <Message message={message} /> : null}
      </article>
    );
  }

  const tone = sourceStateTone(state);
  return (
    <article
      data-source-card={identity.adapterId}
      data-source-state={state}
      className={cn('min-w-0 px-5 py-5 sm:px-7 sm:py-7 xl:px-9', className)}
    >
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <SourceIdentityMark
            className="size-11 rounded-lg"
            color={identity.color}
          >
            <SourceMark id={identity.adapterId} size={22} />
          </SourceIdentityMark>
          <div className="min-w-0">
            <p className="truncate font-ui text-chrome-title text-[var(--settings-dim)]">
              {identity.secondary}
            </p>
            <h2 className="truncate font-display text-display font-semibold tracking-[-0.02em] text-[var(--settings-text)]">
              {identity.label}
            </h2>
          </div>
        </div>
        <SourceStatePill state={state} label={stateLabel} />
      </header>

      {summary ? (
        <p className="mt-5 max-w-[68ch] font-ui text-chrome-title leading-5 text-[var(--settings-dim)]">
          {summary}
        </p>
      ) : null}

      {attention && (
        <div
          className="mt-6 flex items-start gap-3 border-y py-4"
          style={{ color: tone.color, borderColor: tone.color }}
        >
          {attention.kind === 'sign-in' ? (
            <KeyRound aria-hidden className="mt-0.5 shrink-0" size={18} />
          ) : (
            <AlertCircle aria-hidden className="mt-0.5 shrink-0" size={18} />
          )}
          <div>
            <p className="font-ui text-sm font-medium">{attention.title}</p>
            <p className="mt-1 max-w-xl font-ui text-chrome-title leading-5 text-[var(--settings-dim)]">
              {attention.detail}
            </p>
          </div>
        </div>
      )}

      <Actions
        step={step}
        onStep={onStep}
        onRecheck={onRecheck}
        busy={busy}
        busyLabel={busyLabel}
        className="mt-6"
      />

      {step?.kind === 'shell-sign-in' ? (
        <p
          data-source-step-note
          className="mt-3 max-w-xl font-ui text-chrome-label leading-5 text-[var(--settings-dim)]"
        >
          {step.note}
        </p>
      ) : null}

      {disclosure ? (
        <div
          data-source-disclosure
          className="mt-4 max-w-[68ch] font-ui text-chrome-label leading-5 text-[var(--settings-dim)]"
        >
          {disclosure}
        </div>
      ) : null}

      {message ? <Message message={message} /> : null}

      {children}
    </article>
  );
}
