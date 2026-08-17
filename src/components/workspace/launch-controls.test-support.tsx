import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, vi } from 'vitest';

import { fallbackAgentSourceRegistry } from './agent-sources';
import { AgentComposer } from './launch-controls';
import { FOCUS_AGENT_COMPOSER_EVENT } from './session-jump';
import type { AgentModelCatalog } from '@/types/electron';

export { AgentComposer, FOCUS_AGENT_COMPOSER_EVENT };

/** The composer is the always-open pane of a draft tab or empty Project
 *  (D24) — render is enough. */
export function renderComposer(ui: React.ReactElement) {
  return render(ui);
}

/**
 * The New Agent launcher's driving contract for unit tests (ENG-016 D49),
 * stated once — the same reason `scripts/lib/electron-eval.mjs` states it once
 * for the Electron evals.
 *
 * These tests used to drive the pre-D49 control row: `Agent Source`,
 * `Agent model`, `Agent effort`, `Agent permissions`. D49 replaced that row
 * with the setup drawer but left it in the DOM behind `hidden`, so the tests
 * kept passing against UI no operator could reach (BUG-014). Everything below
 * drives what actually ships.
 */

/** The drawer's closed face. Disabled until the launcher settles on a
 *  selectable setup, which is the readiness the old row expressed as
 *  "Agent permissions is enabled". */
export function setupDrawerHandle(): HTMLElement {
  return screen.getByRole('button', {
    name: /^(Adjust |Hide setup options$)/,
  });
}

/** How many event-loop turns the composer may take to settle. Its readiness
 *  chain is saved preferences → source registry → model catalog, each gating
 *  the next, so it needs tens of turns and never hundreds. */
const SETTLE_TURNS = 200;

/**
 * Read the composer once it has settled, and return what was read (BUG-057).
 *
 * These tests used Testing Library's `waitFor`, whose deadline is 1000ms of
 * WALL CLOCK. Nothing the composer does takes time: it awaits mocked bridge
 * promises and re-renders. What it needs is event-loop TURNS. On a host
 * running several agent worktrees at once those turns arrive after the
 * deadline has already passed, so this family failed on machine load rather
 * than on behaviour — the only suite files that did, because the composer's
 * readiness chain is the longest in the renderer.
 *
 * So wait for the turns instead of for a duration: drain React's work and the
 * task queues, re-read, and give up after a bounded number of turns. A
 * composer that genuinely never settles still fails, with the real assertion
 * error and no slower than before. It just cannot fail because the machine
 * was busy.
 */
export async function settled<T>(read: () => T): Promise<T> {
  for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
    try {
      return read();
    } catch {
      // Microtask turns are nearly free and drain the bridge mocks; a
      // macrotask boundary every eighth turn releases anything genuinely
      // queued on a timer or animation frame.
      await act(async () => {
        if (turn % 8 === 7) {
          await new Promise(resolve => setTimeout(resolve, 0));
        } else {
          await Promise.resolve();
        }
      });
    }
  }
  // Out of turns: raise the real assertion error, not a timeout.
  return read();
}

export async function composerReady() {
  await settled(() => expect(setupDrawerHandle()).not.toBeDisabled());
}

export type LauncherAxisLabel = 'Engine' | 'Model' | 'Thinking' | 'Permission';

/** One axis's OptionMenu trigger. Its accessible name is `<Axis>: <selected>`
 *  and its text content is the selected label. */
export function launcherAxis(label: LauncherAxisLabel): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${label}: `) });
}

/** Open the drawer that holds Engine, Model, Thinking and Permission. */
export async function openSetupDrawer() {
  await composerReady();
  const handle = setupDrawerHandle();
  if (handle.getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(handle);
  }
  await settled(() => expect(launcherAxis('Engine')).toBeInTheDocument());
}

/** Choose an option on a drawer axis by its visible label. */
export async function chooseLauncherAxis(
  label: LauncherAxisLabel,
  optionName: string | RegExp
) {
  await openSetupDrawer();
  fireEvent.click(launcherAxis(label));
  fireEvent.click(
    await settled(() => screen.getByRole('option', { name: optionName }))
  );
}

/** Start the Agent the launcher currently describes. */
export function startButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Start' });
}

/** The selected setup chip. Its accessible name states the whole setup —
 *  role, engine, model, variant, vendor, thinking — so it is the assertion
 *  target for "the composer is showing X" without opening the drawer. */
export function selectedSetup(): HTMLElement {
  const chip = document.querySelector('[data-setup-chip][data-selected]');
  if (!chip) throw new Error('The launcher has no selected setup chip.');
  return chip as HTMLElement;
}

export async function expectSelectedSetup(pattern: RegExp) {
  await settled(() =>
    expect(selectedSetup().getAttribute('aria-label') ?? '').toMatch(pattern)
  );
}

export function readyAgentSourceRegistry() {
  const registry = fallbackAgentSourceRegistry('launch');
  return {
    ...registry,
    observedAt: 1,
    sources: registry.sources.map(source => ({
      ...source,
      configured: true,
      launchable: true,
      state: 'ready' as const,
      stateLabel: 'Ready',
      observedAt: 1,
      actions: {
        ...source.actions,
        recheck: true,
      },
    })),
  };
}

const TEST_EFFORTS = [
  { id: 'low', label: 'Low', description: 'Fast responses.' },
  { id: 'medium', label: 'Medium', description: 'Balanced reasoning.' },
  { id: 'high', label: 'High', description: 'Deeper reasoning.' },
  { id: 'xhigh', label: 'Extra high', description: 'Very deep reasoning.' },
  { id: 'max', label: 'Max', description: 'Maximum reasoning.' },
];

export const CODEX_MODEL_CATALOG: AgentModelCatalog = {
  harness: 'codex',
  effectiveModel: 'gpt-5.6-sol',
  effectiveModelLabel: 'GPT-5.6-Sol',
  effectiveModelSource: 'config',
  effectiveEffort: 'xhigh',
  effectiveEffortLabel: 'Extra high',
  effectiveEffortSource: 'config',
  effortLocked: false,
  models: [
    {
      id: 'gpt-5.6-sol',
      label: 'GPT-5.6-Sol',
      description: 'Frontier coding model.',
      defaultEffort: 'low',
      efforts: TEST_EFFORTS,
    },
    {
      id: 'gpt-5.6-terra',
      label: 'GPT-5.6-Terra',
      description: 'Balanced coding model.',
      defaultEffort: 'medium',
      efforts: TEST_EFFORTS,
    },
  ],
  catalogMode: 'live-catalog',
  catalogProvenance: 'Installed Codex CLI',
  observedAt: 1,
  selectionAction: null,
};

export const CLAUDE_MODEL_CATALOG: AgentModelCatalog = {
  harness: 'claude',
  effectiveModel: 'claude-fable-5[1m]',
  effectiveModelLabel: 'Claude Fable 5 · 1M',
  effectiveModelSource: 'config',
  effectiveEffort: 'xhigh',
  effectiveEffortLabel: 'Extra high',
  effectiveEffortSource: 'config',
  effortLocked: false,
  models: [
    {
      id: 'claude-fable-5[1m]',
      label: 'Claude Fable 5 · 1M',
      description: 'Configured Claude model.',
      defaultEffort: 'auto',
      efforts: [
        {
          id: 'auto',
          label: 'Auto',
          description: 'Use the model default.',
        },
        ...TEST_EFFORTS,
      ],
    },
    {
      id: 'sonnet',
      label: 'Sonnet',
      description: 'Balanced Claude model.',
      defaultEffort: 'auto',
      efforts: [
        {
          id: 'auto',
          label: 'Auto',
          description: 'Use the model default.',
        },
        ...TEST_EFFORTS,
      ],
    },
  ],
  catalogMode: 'configured-values',
  catalogProvenance: 'Claude Code layered configuration',
  observedAt: 1,
  selectionAction: null,
};

export const OPENCODE_MODEL_CATALOG: AgentModelCatalog = {
  ...CODEX_MODEL_CATALOG,
  harness: 'opencode',
  effectiveModel: 'openrouter/moonshotai/kimi-k3',
  effectiveModelLabel: 'Kimi K3',
  models: [
    {
      id: 'openrouter/moonshotai/kimi-k3',
      label: 'Kimi K3',
      description: 'OpenRouter coding model.',
      defaultEffort: 'high',
      efforts: TEST_EFFORTS,
    },
  ],
  catalogProvenance: 'Installed OpenCode CLI',
};

/** Grok Build reports model IDs and a default, and enumerates NO effort
 *  options on any surface a PTY launch can read (ENG-003 S4). */
export const GROK_MODEL_CATALOG: AgentModelCatalog = {
  harness: 'grok',
  effectiveModel: 'grok-4.5',
  effectiveModelLabel: 'Grok 4.5',
  effectiveModelSource: 'account-default',
  effectiveEffort: null,
  effectiveEffortLabel: 'Source default',
  effectiveEffortSource: 'unavailable',
  effortLocked: false,
  models: [
    {
      id: 'grok-4.5',
      label: 'Grok 4.5',
      description: 'Reported by the installed Grok Build CLI.',
      defaultEffort: null,
      efforts: [],
    },
    {
      id: 'grok-4.5-fast',
      label: 'Grok 4.5 Fast',
      description: 'Reported by the installed Grok Build CLI.',
      defaultEffort: null,
      efforts: [],
    },
  ],
  catalogMode: 'live-catalog',
  catalogProvenance: 'Installed Grok Build CLI · grok models',
  observedAt: 1,
  selectionAction: null,
};

export function installComposerTestHarness() {
  const recordAgentSourceUse = vi.fn();
  const setAgentPermissionMode = vi.fn();

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    recordAgentSourceUse.mockReset().mockResolvedValue({});
    setAgentPermissionMode.mockReset().mockResolvedValue({});
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      settings: {
        get: vi.fn().mockResolvedValue({}),
        setAttentionNotifications: vi.fn(),
        recordAgentSourceUse,
        setAgentPermissionMode,
        onChanged: vi.fn(() => vi.fn()),
      },
      pty: {
        listAgentModels: vi.fn(async harness =>
          harness === 'codex'
            ? CODEX_MODEL_CATALOG
            : harness === 'opencode'
              ? OPENCODE_MODEL_CATALOG
              : harness === 'grok'
                ? GROK_MODEL_CATALOG
                : CLAUDE_MODEL_CATALOG
        ),
        listRecentConversations: vi.fn().mockResolvedValue([]),
      },
      agentSources: {
        list: vi.fn(async () => readyAgentSourceRegistry()),
        act: vi.fn(async () => ({
          ok: true,
          message: 'Source action opened.',
        })),
      },
    } as unknown as NonNullable<Window['electron']>;
  });

  return { recordAgentSourceUse, setAgentPermissionMode };
}
