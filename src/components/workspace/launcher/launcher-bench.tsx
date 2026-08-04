'use client';

/**
 * Design bench for the New Agent launcher (ENG-016 D49).
 *
 * Every case is LIVE: selecting a chip, opening the drawer, and changing an
 * axis all mutate real state and re-render the same components the composer
 * uses. Nothing here is a mock of the launcher — it is the launcher, fed by
 * fixtures instead of by IPC, so a design decision made here is a design
 * decision made in the product.
 */

import { useState } from 'react';
import { AgentLauncher, LAUNCHER_DRAWERS, type LauncherDrawer } from './agent-launcher';
import { SETUP_CHIP_VARIANTS, type SetupChipVariant } from './setup-chip';
import { BENCH_SCENARIOS, benchAxes, type BenchScenario } from './launcher-fixtures';
import type { LauncherSetup } from './launcher-model';
import { cn } from '@/lib/utils';

const DRAWER_NOTE: Record<LauncherDrawer, string> = {
  peek: 'A collapsed summary of the current setup is always visible. It IS the drawer, closed — nothing has to be discovered.',
  handle:
    'A grip tab hangs under the selected chip and slides with the selection. Lighter at rest, one more thing to notice.',
};

const VARIANT_NOTE: Record<SetupChipVariant, string> = {
  'role-lede': 'Role as a quiet lede above the engine.',
  quiet: 'Role suppressed on the chip; it lives in the detail panel only.',
};

/** Applying an axis change to a setup, the way the composer's adapter will. */
function applyAxis(
  setup: LauncherSetup,
  axisId: string,
  optionId: string
): LauncherSetup {
  if (axisId === 'model') {
    return { ...setup, model: optionId, modelVariant: null, vendor: null };
  }
  if (axisId === 'thinking') return { ...setup, thinking: optionId };
  return setup;
}

function ScenarioCase({
  scenario,
  variant,
  drawer,
}: {
  scenario: BenchScenario;
  variant: SetupChipVariant;
  drawer: LauncherDrawer;
}) {
  const [setups, setSetups] = useState<LauncherSetup[]>(scenario.setups);
  const [selectedId, setSelectedId] = useState<string | null>(
    scenario.setups[scenario.selectedIndex]?.id ?? null
  );
  const [permission, setPermission] = useState('Ask first');
  const [task, setTask] = useState(scenario.task);

  const selected = setups.find(setup => setup.id === selectedId) ?? null;

  const onAxisChange = (axisId: string, optionId: string) => {
    if (axisId === 'permission') {
      setPermission(optionId);
      return;
    }
    if (!selectedId) return;
    setSetups(current =>
      current.map(setup =>
        setup.id === selectedId ? applyAxis(setup, axisId, optionId) : setup
      )
    );
  };

  return (
    <section
      data-bench-case={scenario.id}
      className="flex flex-col gap-3 rounded-lg border border-hud-stroke-faint bg-hud-deep p-4"
    >
      <header className="flex items-baseline justify-between gap-4">
        <h3 className="font-ui text-chrome-label font-semibold text-hud-text">
          {scenario.title}
        </h3>
        <span className="font-mono text-chrome-micro text-hud-text-dim">
          {scenario.width}px
        </span>
      </header>
      <p className="max-w-prose font-mono text-chrome-micro leading-4 text-hud-text-dim">
        {scenario.note}
      </p>
      <div
        className="@container rounded-md bg-hud-void p-4"
        style={{ width: scenario.width, maxWidth: '100%' }}
      >
        <AgentLauncher
          setups={setups}
          selectedId={selectedId}
          state={scenario.state}
          axes={benchAxes(selected, permission, onAxisChange)}
          detailFootnote="Changes apply to this Agent only until you start it."
          task={task}
          onTaskChange={setTask}
          onSelect={setSelectedId}
          onOpenCatalog={() => {}}
          onStart={() => {}}
          drawer={drawer}
          launching={scenario.launching}
          blockedReason={scenario.blockedReason ?? null}
          variant={variant}
          defaultDetailOpen={scenario.detailOpen}
          placeholderCount={3}
        />
      </div>
    </section>
  );
}

function Toggle<T extends string>({
  title,
  options,
  value,
  note,
  attribute,
  onChange,
}: {
  title: string;
  options: readonly T[];
  value: T;
  note: string;
  attribute: string;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-chrome-micro text-hud-text-dim">
        {title}
      </span>
      {options.map(option => (
        <button
          key={option}
          type="button"
          {...{ [attribute]: option }}
          data-active={option === value || undefined}
          onClick={() => onChange(option)}
          className={cn(
            'rounded-md border border-hud-stroke-faint px-2.5 py-1 font-mono text-chrome-meta text-hud-text-dim outline-none transition-colors',
            'hover:border-hud-cyan/45 hover:text-hud-text',
            'data-[active]:border-hud-cyan/70 data-[active]:bg-hud-fill-hi data-[active]:text-hud-text',
            'focus-visible:ring-2 focus-visible:ring-hud-cyan motion-reduce:transition-none'
          )}
        >
          {option}
        </button>
      ))}
      <span className="font-mono text-chrome-micro text-hud-text-dim">
        {note}
      </span>
    </div>
  );
}

export function LauncherBench() {
  const [variant, setVariant] = useState<SetupChipVariant>('role-lede');
  const [drawer, setDrawer] = useState<LauncherDrawer>('peek');

  return (
    <div data-launcher-bench className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-lg border border-hud-stroke-faint bg-hud-deep p-3">
        <Toggle
          title="Drawer"
          attribute="data-bench-drawer"
          options={LAUNCHER_DRAWERS}
          value={drawer}
          note={DRAWER_NOTE[drawer]}
          onChange={setDrawer}
        />
        <Toggle
          title="Chip"
          attribute="data-bench-variant"
          options={SETUP_CHIP_VARIANTS}
          value={variant}
          note={VARIANT_NOTE[variant]}
          onChange={setVariant}
        />
        <p className="font-mono text-chrome-micro leading-4 text-hud-text-dim">
          Everything below is live. Click a chip to select it, click it again or
          use the drawer to adjust, and try the menus with the keyboard: ↑↓ to
          move, Home/End, type “s” for Sonnet, press it again to cycle.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {BENCH_SCENARIOS.map(scenario => (
          <ScenarioCase
            key={`${scenario.id}-${variant}-${drawer}`}
            scenario={scenario}
            variant={variant}
            drawer={drawer}
          />
        ))}
      </div>
    </div>
  );
}
