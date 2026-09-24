/**
 * View model for the New Agent launcher (ENG-016 D49).
 *
 * Presentation-only and deliberately free of Electron, persistence, and the
 * `@exawatt/core` pool shape. The composer adapts runtime truth into this
 * model; the gallery bench builds it from fixtures. Both then render the
 * identical components, so a design iteration in the bench IS an iteration of
 * the shipped surface.
 */

import type {
  AgentHarness,
  AgentModelCatalog,
  AgentSourceRegistrySnapshot,
  AgentSourceSnapshot,
  PtyHarness,
} from '@/types/electron';
import {
  agentSourceFactAge,
  agentSourceFactFreshness,
  agentSourceLaunchVerdict,
  type AgentSourceFactFreshness,
  type AgentSourceLaunchVerdict,
} from '@exawatt/core';

/**
 * What kind of worker this is, as opposed to which engine runs it. Only
 * Coding exists today (ENG-028 owns the real Type mechanism); the axis is
 * modelled now so the chip does not have to be re-laid-out when it arrives.
 */
export type LauncherRole = 'coding';

export const LAUNCHER_ROLE_LABEL: Record<LauncherRole, string> = {
  coding: 'Coding',
};

/** Why this setup is in the row. Ranking state, not visible card copy. */
export type LauncherReason = 'pinned' | 'frecent' | 'default';

export interface LauncherEngine {
  harness: PtyHarness;
  label: string;
  /** Brand identity, not readable text paint. Used on the glyph only. */
  color: string;
}

/**
 * Who actually serves the model. Distinct from the engine: OpenCode is the
 * engine, OpenRouter or a local Ollama is the vendor. Null when the engine
 * implies it — Claude Code is always Anthropic, and saying so is noise.
 */
export interface LauncherVendor {
  label: string;
  /** Local inference is a materially different fact from a hosted provider. */
  kind: 'hosted' | 'local';
}

export interface LauncherSetup {
  id: string;
  role: LauncherRole;
  /** Operator preset name, when they have named this setup. */
  name: string | null;
  engine: LauncherEngine;
  /** Null while the engine has not reported a model yet. */
  model: string | null;
  /**
   * The engine's catalog is still being read, so `model` is null for now
   * rather than because the operator has to choose one. The chip shims the
   * model line instead of saying "Choose a model" (BUG-062: the row paints
   * from memory before every catalog has answered).
   */
  modelPending?: boolean;
  /**
   * A capability of the model itself, e.g. "1M context". Sits on the quiet
   * secondary line so the model name owns the full anchor width. Deliberately
   * NOT the same channel as the vendor, which is identity and carries a mark.
   */
  modelVariant: string | null;
  vendor: LauncherVendor | null;
  /** Reasoning effort label, e.g. "High". Null when the engine has none. */
  thinking: string | null;
  reason: LauncherReason;
  /** Successful launches of this setup in this Project. */
  launchCount: number;
  pinned: boolean;
  available: boolean;
  /** Exact missing fact. Required whenever `available` is false. */
  unavailableReason?: string;
}

/**
 * The row's readiness. `settling` renders non-interactive placeholders at the
 * final geometry so nothing pops in under a moving pointer (D49 finding 4).
 */
export type LauncherRowState = 'settling' | 'ready';

export function displayEffortLabel(value: string): string {
  if (value === 'xhigh') return 'Extra high';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Split a "1M context" capability off the model name for the chip. */
export function launcherModelPresentation(
  label: string,
  modelId: string
): { model: string; variant: string | null } {
  const hasLongContext =
    modelId.toLowerCase().endsWith('[1m]') ||
    /(?:\s*[·(]\s*)1m(?:\s+context)?\)?\s*$/i.test(label);
  if (!hasLongContext) return { model: label, variant: null };
  return {
    model: label
      .replace(/\s*·\s*1m(?:\s+context)?\s*$/i, '')
      .replace(/\s*\(1m(?:\s+context)?\)\s*$/i, '')
      .trim(),
    variant: '1M context',
  };
}

export function launcherVendor(
  source: AgentHarness,
  modelId: string
): LauncherVendor | null {
  if (source !== 'opencode') return null;
  const provider = modelId.slice(0, modelId.indexOf('/')).toLowerCase();
  if (!provider) return null;
  if (provider === 'ollama') return { label: 'Ollama', kind: 'local' };
  const labels: Record<string, string> = {
    openrouter: 'OpenRouter',
    anthropic: 'Anthropic',
    google: 'Google',
    openai: 'OpenAI',
  };
  return {
    label:
      labels[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1),
    kind: 'hosted',
  };
}

/**
 * The one chip for an engine the pool has not taught the row about (D49
 * finding 13; decision 0027). Its identity is the engine, so it is stable
 * from the first paint: the catalog fills the model line in when it lands,
 * and the engine being adjusted shows the model and thinking chosen for it.
 * Without a source-owned default it opens Model and blocks Start until the
 * operator supplies the missing fact.
 */
export function draftLauncherSetup(input: {
  engine: LauncherEngine & { harness: AgentHarness };
  catalog: AgentModelCatalog | undefined;
  /** The choice in progress, when this engine is the one being adjusted. */
  adjusting: { model: string; modelLabel: string; effort: string | null; effortLabel: string } | null;
}): LauncherSetup {
  const { engine, catalog, adjusting } = input;
  const defaultLabel = catalog?.effectiveModel
    ? (catalog.models.find(option => option.id === catalog.effectiveModel)
        ?.label ?? catalog.effectiveModelLabel)
    : null;
  const modelId = adjusting?.model ?? catalog?.effectiveModel ?? null;
  const presented = adjusting
    ? launcherModelPresentation(adjusting.modelLabel, adjusting.model)
    : catalog?.effectiveModel && defaultLabel
      ? launcherModelPresentation(defaultLabel, catalog.effectiveModel)
      : {
          model:
            catalog?.effectiveModelSource === 'account-default'
              ? catalog.effectiveModelLabel
              : null,
          variant: null,
        };
  const thinking = adjusting
    ? adjusting.effort
      ? adjusting.effortLabel
      : null
    : catalog?.effectiveModel && catalog.effectiveEffort
      ? catalog.effectiveEffortLabel
      : null;
  return {
    id: `draft:${engine.harness}`,
    role: 'coding',
    name: null,
    engine,
    model: presented.model,
    modelPending: !catalog,
    modelVariant: presented.variant,
    vendor: modelId ? launcherVendor(engine.harness, modelId) : null,
    thinking,
    reason: 'default',
    launchCount: 0,
    pinned: false,
    available: true,
  };
}

/**
 * How many setups fit at this composer width.
 *
 * The row never truncates to make room for one more chip: an unreadable chip
 * is worth less than no chip, and the tail is one keystroke away behind ＋.
 * Measured against the real chip content — `Extra high thinking` under
 * `GPT-5.3 Codex` is the widest realistic pair.
 */
export function rowCapacityForWidth(width: number): number {
  if (width < 560) return 2;
  if (width < 900) return 3;
  return 4;
}

/** Full spoken identity. Never derived from truncated visible copy. */
export function setupAccessibleLabel(setup: LauncherSetup): string {
  const identity = [
    setup.name,
    LAUNCHER_ROLE_LABEL[setup.role],
    setup.engine.label,
    setup.model,
    setup.modelVariant,
    setup.vendor ? `served by ${setup.vendor.label}` : null,
    setup.thinking ? `${setup.thinking} thinking` : null,
  ]
    .filter(Boolean)
    .join(', ');
  const state = [
    setup.pinned
      ? 'pinned'
      : setup.reason === 'frecent'
        ? 'recently used'
        : 'suggested',
    setup.available
      ? null
      : `unavailable${setup.unavailableReason ? `: ${setup.unavailableReason}` : ''}`,
  ].filter(Boolean);
  return state.length > 0 ? `${identity}, ${state.join(', ')}` : identity;
}

/*
 * ---------------------------------------------------------------------------
 * The readiness chain, as a pure state machine (BUG-062 / BUG-082).
 *
 * The composer used to compute "settled" inline from six pieces of state, and
 * settled meant: the saved policy loaded, the registry answered LIVE for
 * every source, and every launchable source reported a model catalog. Every
 * ⌘T more than five seconds after the last one therefore showed placeholder
 * cards and a dead Start for as long as thirteen login shells took.
 *
 * Here the chain is data in, data out, so "not yet checked" versus "checked
 * and failed" is a transition a test can name without a DOM:
 *
 *   saved preferences ─→ registry PAINTED (remembered or live) ─→ row ready
 *
 * A model catalog never gates the row: an engine without one paints as a
 * draft chip, and the catalog fills it in when it lands. Start needs only the
 * SELECTED source's fact, never every source's.
 * ---------------------------------------------------------------------------
 */

/** The registry as the composer sees it (see `useAgentSourceRegistry`). */
interface LauncherRegistryInput {
  snapshot: AgentSourceRegistrySnapshot;
  /** The live read is in flight (initial probe or a recheck). */
  checking: boolean;
  /** What is painted: nothing real yet, this machine's memory, or live. */
  painted: 'none' | 'remembered' | 'live';
}

export interface LauncherReadinessInput {
  preferencesReady: boolean;
  poolReady: boolean;
  registry: LauncherRegistryInput;
  now: number;
}

/** One source's fact: how fresh it is and what it says about launching. */
interface LauncherSourceFact {
  harness: AgentHarness;
  label: string;
  freshness: AgentSourceFactFreshness;
  verdict: AgentSourceLaunchVerdict;
  /** Age of the painted observation, null when nothing complete is painted. */
  ageMs: number | null;
  /** Exawatt would spawn this source (a blocked verdict is the only refusal). */
  available: boolean;
  snapshot: AgentSourceSnapshot;
}

interface LauncherReadiness {
  phase: LauncherRowState;
  facts: LauncherSourceFact[];
  /** A live read is running while something on the row is not yet `known`. */
  checking: boolean;
}

function launcherSourceFact(
  snapshot: AgentSourceSnapshot & { harness: AgentHarness },
  input: { checking: boolean; now: number }
): LauncherSourceFact {
  const freshness = agentSourceFactFreshness({
    snapshot,
    checking: input.checking,
    now: input.now,
  });
  const verdict = agentSourceLaunchVerdict(snapshot);
  const ageMs =
    freshness === 'known' || freshness === 'stale'
      ? Math.max(0, input.now - snapshot.observedAt)
      : freshness === 'checking' && snapshot.observation.origin === 'remembered'
        ? Math.max(0, input.now - snapshot.observedAt)
        : null;
  return {
    harness: snapshot.harness,
    label: snapshot.label,
    freshness,
    verdict,
    ageMs,
    available: verdict.kind !== 'blocked',
    snapshot,
  };
}

export function launcherReadiness(
  input: LauncherReadinessInput
): LauncherReadiness {
  const { registry } = input;
  const facts = registry.snapshot.sources
    .filter(
      (source): source is AgentSourceSnapshot & { harness: AgentHarness } =>
        source.harness !== null && source.capabilities.interactiveLaunch
    )
    .map(source =>
      launcherSourceFact(source, {
        checking: registry.checking,
        now: input.now,
      })
    );
  const painted = registry.painted !== 'none';
  return {
    phase:
      input.preferencesReady && input.poolReady && painted
        ? 'ready'
        : 'settling',
    facts,
    checking:
      registry.checking && facts.some(fact => fact.freshness !== 'known'),
  };
}

/**
 * The one line under the row. `blocked` disables Start and names the fact;
 * `notice` names a fact that does not block (the source will handle it in
 * the pane); `checking` is the quiet affordance while memory is revalidated.
 */
export type LauncherStatusLine =
  | { kind: 'blocked'; text: string }
  | { kind: 'notice'; text: string }
  | { kind: 'checking'; text: string }
  | { kind: 'none'; text: '' };

export function launcherStatusLine(
  fact: LauncherSourceFact | null,
  readiness: Pick<LauncherReadiness, 'checking'>
): LauncherStatusLine {
  if (!fact) {
    return readiness.checking
      ? { kind: 'checking', text: 'Checking engines…' }
      : { kind: 'none', text: '' };
  }
  const age =
    fact.freshness === 'stale' && fact.ageMs !== null
      ? ` · checked ${agentSourceFactAge(fact.ageMs)}`
      : '';
  if (fact.verdict.kind === 'blocked') {
    return { kind: 'blocked', text: `${fact.verdict.reason}${age}` };
  }
  // A sign-in fact, and a negative this machine only REMEMBERS, both inform
  // and never block: the launch itself revalidates (decision `0043` §5-6).
  const informing =
    fact.verdict.kind === 'notice'
      ? fact.verdict.reason
      : fact.verdict.kind === 'unproven'
        ? (fact.verdict.remembered?.reason ?? null)
        : null;
  if (informing !== null) {
    return {
      kind: 'notice',
      text: `${informing}${fact.freshness === 'checking' ? ' · checking' : age}`,
    };
  }
  if (fact.freshness === 'checking') {
    return { kind: 'checking', text: 'Checking engines…' };
  }
  if (fact.freshness === 'unobserved') {
    return { kind: 'notice', text: `${fact.label}: not checked` };
  }
  if (fact.freshness === 'stale' && fact.ageMs !== null) {
    return {
      kind: 'checking',
      text: `${fact.label}: checked ${agentSourceFactAge(fact.ageMs)}`,
    };
  }
  return { kind: 'none', text: '' };
}
