'use client';

/**
 * Design bench for the New Agent launcher (ENG-016 D49).
 *
 * Every state the operator can hit, rendered from the real components and the
 * real recommendation module, at real widths, on one page. Iterating here is
 * iterating the shipped surface.
 */

import { useState } from 'react';
import { AgentLauncher } from './agent-launcher';
import { SETUP_CHIP_VARIANTS, type SetupChipVariant } from './setup-chip';
import { BENCH_SCENARIOS, benchAxes, type BenchScenario } from './launcher-fixtures';

const VARIANT_NOTE: Record<SetupChipVariant, string> = {
  'role-lede': 'Role as a quiet lede above the engine.',
  'role-footer': 'Role folded into the provenance footer, saving a line.',
  quiet: 'Role suppressed on the chip; it lives in the detail panel only.',
};

function ScenarioCase({
  scenario,
  variant,
}: {
  scenario: BenchScenario;
  variant: SetupChipVariant;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    scenario.setups[scenario.selectedIndex]?.id ?? null
  );
  const [task, setTask] = useState(scenario.task);
  const selected = scenario.setups.find(setup => setup.id === selectedId) ?? null;

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
          setups={scenario.setups}
          selectedId={selectedId}
          state={scenario.state}
          axes={benchAxes(selected, () => {})}
          detailFootnote="Changes apply to this Agent only until you start it."
          task={task}
          onTaskChange={setTask}
          onSelect={setSelectedId}
          onOpenCatalog={() => {}}
          onStart={() => {}}
          launching={scenario.launching}
          blockedReason={scenario.blockedReason ?? null}
          variant={variant}
          forceDetailOpen={scenario.detailOpen}
          placeholderCount={3}
        />
      </div>
    </section>
  );
}

export function LauncherBench() {
  const [variant, setVariant] = useState<SetupChipVariant>('role-lede');

  return (
    <div data-launcher-bench className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hud-stroke-faint bg-hud-deep p-3">
        <span className="font-mono text-chrome-micro uppercase tracking-[0.12em] text-hud-text-dim">
          Chip variant
        </span>
        {SETUP_CHIP_VARIANTS.map(candidate => (
          <button
            key={candidate}
            type="button"
            data-bench-variant={candidate}
            data-active={candidate === variant || undefined}
            onClick={() => setVariant(candidate)}
            className="rounded-md border border-hud-stroke-faint px-2.5 py-1 font-mono text-chrome-meta text-hud-text-dim outline-none transition-colors hover:border-hud-cyan/45 hover:text-hud-text data-[active]:border-hud-cyan/70 data-[active]:bg-hud-fill-hi data-[active]:text-hud-text focus-visible:ring-2 focus-visible:ring-hud-cyan motion-reduce:transition-none"
          >
            {candidate}
          </button>
        ))}
        <span className="font-mono text-chrome-micro text-hud-text-dim">
          {VARIANT_NOTE[variant]}
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {BENCH_SCENARIOS.map(scenario => (
          <ScenarioCase
            key={`${scenario.id}-${variant}`}
            scenario={scenario}
            variant={variant}
          />
        ))}
      </div>
    </div>
  );
}
