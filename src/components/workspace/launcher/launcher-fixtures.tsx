/**
 * Deterministic launcher states for the design bench (ENG-016 D49).
 *
 * Every scenario is built from the SAME pure recommendation module the app
 * runs, driven by a simulated launch history, so the bench shows what the
 * operator would actually get after that behaviour — not a hand-drawn row.
 */

import {
  createAgentLaunchConfiguration,
  emptyLaunchConfigurationPool,
  recommendLaunchSetups,
  simulateLaunchHistory,
  type AgentLaunchConfigurationInput,
  type LaunchHistoryEvent,
  type LaunchRecommendationAvailability,
  type LaunchTarget,
} from '@exawatt/core';
import type { PtyHarness } from '@/types/electron';
import { HARNESS_META } from '../harnesses';
import {
  rowCapacityForWidth,
  type LauncherRowState,
  type LauncherSetup,
  type LauncherVendor,
} from './launcher-model';
import { ExternalLink } from 'lucide-react';
import { EngineGlyph } from './setup-chip';
import type { DetailAxis, DetailAxisOption } from './setup-detail';

export const BENCH_PROJECT = '/Users/example/Code/Projects/exawatt';
const DAY = 24 * 60 * 60 * 1000;
/** Fixed so screenshots are byte-comparable between runs. */
export const BENCH_NOW = 1_800_000_000_000;

interface EngineModel {
  harness: PtyHarness;
  sourceId: string;
  modelId: string;
  modelLabel: string;
  /** A capability of the model itself, shown below its name. */
  modelVariant?: string;
  /** Who serves it. Omitted when the engine implies it. */
  vendor?: LauncherVendor;
  effort: string | null;
  effortLabel?: string;
}

const ENGINE_MODELS: Record<string, EngineModel> = {
  opus: {
    harness: 'claude',
    sourceId: 'claude',
    modelId: 'opus[1m]',
    modelLabel: 'Opus 5',
    modelVariant: '1M context',
    effort: 'high',
    effortLabel: 'High',
  },
  sonnet: {
    harness: 'claude',
    sourceId: 'claude',
    modelId: 'sonnet-4-6',
    modelLabel: 'Sonnet 4.6',
    effort: 'medium',
    effortLabel: 'Medium',
  },
  fable: {
    harness: 'claude',
    sourceId: 'claude',
    modelId: 'claude-fable-5',
    modelLabel: 'Fable 5',
    effort: 'low',
    effortLabel: 'Low',
  },
  gpt: {
    harness: 'codex',
    sourceId: 'codex',
    modelId: 'gpt-5.3-codex',
    modelLabel: 'GPT-5.3 Codex',
    effort: 'xhigh',
    effortLabel: 'Extra high',
  },
  kimi: {
    harness: 'opencode',
    sourceId: 'opencode',
    modelId: 'moonshotai/kimi-k3',
    modelLabel: 'Kimi K3',
    vendor: { label: 'OpenRouter', kind: 'hosted' },
    effort: null,
  },
  qwen: {
    harness: 'opencode',
    sourceId: 'opencode',
    modelId: 'ollama/qwen3-coder',
    modelLabel: 'Qwen3 Coder',
    vendor: { label: 'Ollama', kind: 'local' },
    effort: null,
  },
};

function configurationInput(key: string): AgentLaunchConfigurationInput {
  const engine = ENGINE_MODELS[key];
  return {
    sourceId: engine.sourceId,
    modelId: engine.modelId,
    effort: engine.effort,
    labels: {
      source: HARNESS_META[engine.harness].label,
      model: engine.modelLabel,
      effort: engine.effortLabel,
    },
  };
}

function seedTarget(key: string): LaunchTarget {
  return createAgentLaunchConfiguration(configurationInput(key), 0);
}

const KEY_BY_TARGET_ID = new Map(
  Object.keys(ENGINE_MODELS).map(key => [seedTarget(key).id, key])
);

/** Engine display order for smart defaults, before the row is trained. */
const SEEDS = [seedTarget('opus'), seedTarget('gpt'), seedTarget('kimi')];

function toLauncherSetup(
  target: LaunchTarget,
  reason: LauncherSetup['reason'],
  launchCount: number,
  pinned: boolean,
  availability: LaunchRecommendationAvailability
): LauncherSetup {
  const key = KEY_BY_TARGET_ID.get(target.id);
  const engine = key ? ENGINE_MODELS[key] : null;
  const harness: PtyHarness =
    engine?.harness ?? (target.kind === 'shell' ? 'shell' : 'claude');
  const meta = HARNESS_META[harness];
  return {
    id: target.id,
    role: 'coding',
    name: target.kind === 'agent' ? target.name : null,
    engine: { harness, label: meta.label, color: meta.color },
    model: engine?.modelLabel ?? null,
    modelVariant: engine?.modelVariant ?? null,
    vendor: engine?.vendor ?? null,
    thinking: engine?.effortLabel ?? null,
    reason,
    launchCount,
    pinned,
    available: availability.available,
    unavailableReason: availability.reason,
  };
}

export interface BenchScenario {
  id: string;
  title: string;
  /** What this state is proving. Shown beside the render in the bench. */
  note: string;
  state: LauncherRowState;
  setups: LauncherSetup[];
  selectedIndex: number;
  detailOpen: boolean;
  task: string;
  blockedReason?: string;
  launching?: boolean;
  width: number;
}

function buildSetups(
  events: readonly LaunchHistoryEvent[],
  availability: (
    target: LaunchTarget
  ) => LaunchRecommendationAvailability = () => ({
    available: true,
  }),
  width = 768
): LauncherSetup[] {
  const pool = events.length
    ? simulateLaunchHistory(events)
    : emptyLaunchConfigurationPool();
  const result = recommendLaunchSetups({
    pool,
    project: BENCH_PROJECT,
    seeds: SEEDS,
    availability,
    rankedAt: BENCH_NOW,
  });
  return result.ordered
    .slice(0, rowCapacityForWidth(width))
    .map(row =>
      toLauncherSetup(
        row.target,
        row.reason,
        row.launchCount,
        row.reason === 'pinned',
        row.availability
      )
    );
}

const launch = (
  key: string,
  at: number,
  project = BENCH_PROJECT
): LaunchHistoryEvent => ({
  kind: 'launch',
  at,
  project,
  configuration: configurationInput(key),
});

const TRAINED_HISTORY: LaunchHistoryEvent[] = [
  launch('sonnet', BENCH_NOW - 6 * DAY),
  launch('sonnet', BENCH_NOW - 4 * DAY),
  launch('sonnet', BENCH_NOW - 2 * DAY),
  launch('sonnet', BENCH_NOW - 3 * 60 * 60 * 1000),
  launch('gpt', BENCH_NOW - 5 * DAY),
  launch('gpt', BENCH_NOW - DAY),
  launch('opus', BENCH_NOW - 9 * DAY),
  launch('kimi', BENCH_NOW - 12 * DAY),
];

export const BENCH_SCENARIOS: BenchScenario[] = [
  {
    id: 'settling',
    title: 'Settling',
    note: 'Engines are still being checked. Inert placeholders hold the final geometry so nothing appears under the pointer.',
    state: 'settling',
    setups: [],
    selectedIndex: -1,
    detailOpen: false,
    task: '',
    width: 768,
  },
  {
    id: 'cold',
    title: 'Cold start',
    note: 'No launches here yet: one smart default per launchable engine, in engine order.',
    state: 'ready',
    setups: buildSetups([]),
    selectedIndex: 0,
    detailOpen: false,
    task: '',
    width: 768,
  },
  {
    id: 'trained',
    title: 'Trained',
    note: 'Two weeks of real use. Sonnet leads on frecency, then GPT-5.3; the untouched seeds fill the tail.',
    state: 'ready',
    setups: buildSetups(TRAINED_HISTORY),
    selectedIndex: 0,
    detailOpen: false,
    task: 'Fix the launcher spinner and add a regression test',
    width: 768,
  },
  {
    id: 'detail',
    title: 'Detail open',
    note: 'The drawer holds the editable axes and nothing else — no read-only restatement of the chip above it. One flat tab order, Enter starts.',
    state: 'ready',
    setups: buildSetups(TRAINED_HISTORY),
    selectedIndex: 1,
    detailOpen: true,
    task: 'Fix the launcher spinner and add a regression test',
    width: 768,
  },
  {
    id: 'pinned',
    title: 'Pinned',
    note: 'A Project pin outranks everything learned. Kimi stays first even though Sonnet is launched far more often.',
    state: 'ready',
    setups: buildSetups([
      ...TRAINED_HISTORY,
      {
        kind: 'pin',
        project: BENCH_PROJECT,
        configurationId: seedTarget('kimi').id,
      },
    ]),
    selectedIndex: 0,
    detailOpen: false,
    task: '',
    width: 768,
  },
  {
    id: 'unavailable',
    title: 'Engine missing',
    note: 'OpenCode is not installed. The setup the operator relies on is demoted and dimmed with the exact reason — never dropped.',
    state: 'ready',
    setups: buildSetups(TRAINED_HISTORY, target =>
      target.kind === 'agent' && target.sourceId === 'opencode'
        ? { available: false, reason: 'OpenCode is not installed.' }
        : { available: true }
    ),
    selectedIndex: 0,
    detailOpen: false,
    task: '',
    width: 768,
  },
  {
    id: 'blocked',
    title: 'Blocked',
    note: 'The selected setup cannot start. Start is disabled with the reason stated in text, not only as a dimmed button.',
    state: 'ready',
    setups: buildSetups(TRAINED_HISTORY, target =>
      target.kind === 'agent' && target.modelId === 'sonnet-4-6'
        ? {
            available: false,
            reason: 'Sonnet 4.6 is not available from Claude Code right now.',
          }
        : { available: true }
    ),
    selectedIndex: 0,
    detailOpen: false,
    task: 'Rework the ribbon',
    blockedReason: 'Sonnet 4.6 is not available from Claude Code right now.',
    width: 768,
  },
  {
    id: 'narrow',
    title: 'Narrow (520px)',
    note: 'At composer minimum the row keeps whole chips rather than truncating: fewer setups, each still readable.',
    state: 'ready',
    setups: buildSetups(TRAINED_HISTORY, () => ({ available: true }), 520),
    selectedIndex: 0,
    detailOpen: false,
    task: '',
    width: 520,
  },
];

/** The engine axis carries the same brand glyphs the chips do (finding 7). */
const ENGINE_OPTIONS: DetailAxisOption[] = (
  ['claude', 'codex', 'opencode', 'grok'] as PtyHarness[]
).map(harness => ({
  id: harness,
  label: HARNESS_META[harness].label,
  description:
    harness === 'opencode'
      ? 'Multi-provider and local models'
      : harness === 'codex'
        ? 'OpenAI models'
        : harness === 'grok'
          ? 'xAI models'
          : 'Anthropic models',
  mark: (
    <EngineGlyph
      engine={{
        harness,
        label: HARNESS_META[harness].label,
        color: HARNESS_META[harness].color,
      }}
      size={12}
    />
  ),
}));

const MODEL_OPTIONS: DetailAxisOption[] = [
  {
    id: 'Opus 5',
    label: 'Opus 5',
    description: '1M context · best for complex work',
    group: 'Claude Code',
    keywords: 'opus[1m] anthropic',
  },
  {
    id: 'Sonnet 5',
    label: 'Sonnet 5',
    description: 'Efficient for routine tasks',
    group: 'Claude Code',
    keywords: 'sonnet anthropic',
  },
  {
    id: 'Sonnet 4.6',
    label: 'Sonnet 4.6',
    description: 'Balanced',
    group: 'Claude Code',
    keywords: 'sonnet-4-6 anthropic',
  },
  {
    id: 'Fable 5',
    label: 'Fable 5',
    description: 'Longest-running tasks',
    group: 'Claude Code',
    keywords: 'claude-fable-5',
  },
  {
    id: 'Haiku 4.5',
    label: 'Haiku 4.5',
    description: 'Fastest for quick answers',
    group: 'Claude Code',
    keywords: 'haiku',
  },
  {
    id: 'GPT-5.3 Codex',
    label: 'GPT-5.3 Codex',
    group: 'Codex',
    keywords: 'gpt-5.3-codex openai',
  },
  {
    id: 'Kimi K3',
    label: 'Kimi K3',
    description: 'Served by OpenRouter',
    group: 'OpenCode',
    keywords: 'moonshotai/kimi-k3 openrouter',
  },
  {
    id: 'Qwen3 Coder',
    label: 'Qwen3 Coder',
    description: 'Runs locally through Ollama',
    group: 'OpenCode',
    keywords: 'ollama/qwen3-coder local',
  },
  {
    id: 'DeepSeek V4',
    label: 'DeepSeek V4',
    description: 'Served by OpenRouter',
    group: 'OpenCode',
    keywords: 'deepseek openrouter',
  },
  {
    id: 'GLM 5',
    label: 'GLM 5',
    description: 'Served by OpenRouter',
    group: 'OpenCode',
    keywords: 'glm zhipu openrouter',
  },
  {
    id: 'Llama 4 405B',
    label: 'Llama 4 405B',
    description: 'Served by OpenRouter',
    group: 'OpenCode',
    keywords: 'meta llama openrouter',
  },
  {
    id: 'Mistral Large 3',
    label: 'Mistral Large 3',
    description: 'Served by OpenRouter',
    group: 'OpenCode',
    keywords: 'mistral openrouter',
  },
];

const THINKING_OPTIONS: DetailAxisOption[] = [
  { id: 'Low', label: 'Low', description: 'Fastest, least deliberation' },
  { id: 'Medium', label: 'Medium', description: 'Everyday work' },
  { id: 'High', label: 'High', description: 'Harder problems, slower' },
  {
    id: 'Extra high',
    label: 'Extra high',
    description: 'Maximum deliberation',
  },
];

const PERMISSION_OPTIONS: DetailAxisOption[] = [
  {
    id: 'Ask first',
    label: 'Ask first',
    description: 'Confirm before each risky action',
  },
  {
    id: 'Auto-review',
    label: 'Auto-review',
    description: 'Act, then show what happened',
  },
  {
    id: 'No prompts',
    label: 'No prompts',
    description: 'Never ask. Use in a worktree.',
  },
];

/** One editable axis set, driven by real option shapes and live state. */
export function benchAxes(
  setup: LauncherSetup | null,
  permission: string,
  onChange: (axisId: string, optionId: string) => void
): DetailAxis[] {
  if (!setup) return [];
  return [
    {
      id: 'engine',
      label: 'Engine',
      weight: 1,
      value: setup.engine.harness,
      options: ENGINE_OPTIONS,
      onChange: optionId => onChange('engine', optionId),
      provenance: 'Engines Exawatt can see on this machine.',
      footer: (
        <a
          href="/settings"
          className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 font-mono text-chrome-meta text-hud-text-dim outline-none transition-colors hover:bg-hud-fill hover:text-hud-text focus-visible:ring-2 focus-visible:ring-hud-cyan motion-reduce:transition-none"
        >
          Add or remove engines
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </a>
      ),
    },
    {
      id: 'model',
      label: 'Model',
      weight: 2,
      value: setup.model,
      placeholder: 'Choose a model',
      options: MODEL_OPTIONS,
      onChange: optionId => onChange('model', optionId),
      provenance: `Reported by ${setup.engine.label}.`,
    },
    {
      id: 'thinking',
      label: 'Thinking',
      weight: 1.2,
      value: setup.thinking,
      placeholder: 'Engine default',
      options: THINKING_OPTIONS,
      onChange: optionId => onChange('thinking', optionId),
      provenance: 'Applies to this Agent only.',
    },
    {
      id: 'permission',
      label: 'Permission',
      weight: 1.2,
      value: permission,
      tone: 'caution',
      options: PERMISSION_OPTIONS,
      onChange: optionId => onChange('permission', optionId),
      provenance: 'Remembered for this Project and engine.',
    },
  ];
}
