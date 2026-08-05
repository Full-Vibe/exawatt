'use client';

/**
 * Design bench for the New Agent launcher (ENG-016 D49).
 *
 * One launcher, one chip layout, one drawer — the states the operator can
 * actually hit, and nothing else. An earlier cut carried a drawer toggle and a
 * chip-layout toggle on top of ten scenarios, which turned a review surface
 * into forty renders to wade through.
 *
 * Every case is LIVE: selecting a chip, opening the drawer, and changing an
 * axis all mutate real state and re-render the same components the composer
 * uses. Nothing here is a mock of the launcher — it is the launcher, fed by
 * fixtures instead of by IPC.
 */

import { useState } from 'react';
import { AgentLauncher } from './agent-launcher';
import { BENCH_SCENARIOS, benchAxes, type BenchScenario } from './launcher-fixtures';
import type { LauncherSetup } from './launcher-model';

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

function ScenarioCase({ scenario }: { scenario: BenchScenario }) {
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
          launching={scenario.launching}
          blockedReason={scenario.blockedReason ?? null}
          defaultDetailOpen={scenario.detailOpen}
          placeholderCount={3}
        />
      </div>
    </section>
  );
}

export function LauncherBench() {
  return (
    <div data-launcher-bench className="flex flex-col gap-6">
      <p className="rounded-lg border border-hud-stroke-faint bg-hud-deep p-3 font-mono text-chrome-micro leading-4 text-hud-text-dim">
        Everything below is live. Click a chip to select it, pull the handle
        under it to adjust, and try the menus with the keyboard: ↑↓ to move,
        Home/End, type “s” for Sonnet, press it again to cycle.
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        {BENCH_SCENARIOS.map(scenario => (
          <ScenarioCase key={scenario.id} scenario={scenario} />
        ))}
      </div>
    </div>
  );
}
