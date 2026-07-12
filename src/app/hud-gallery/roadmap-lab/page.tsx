'use client';

/**
 * Roadmap lab (ENG-017 S10, dev workbench like the rest of /hud-gallery).
 *
 * Renders the REAL strip + rail components against fixture lens states
 * (markdown pushed through the real parser), so every designed state is
 * one click away without arranging live sessions. The prototypes section
 * hosts the gated manipulable-lens explorations — mock interactions only,
 * nothing here can write a roadmap file.
 */
import { useMemo, useState } from 'react';
import { HUD, withAlpha } from '@/components/hud';
import { RoadmapRail, type RoadmapRailMode } from '@/components/roadmap/roadmap-rail';
import { ROADMAP_LAB_STATES } from '@/components/roadmap/lab-fixtures';
import { RoadmapFeedPrototypes } from './prototypes';

export default function RoadmapLabPage() {
  const [stateKey, setStateKey] = useState(ROADMAP_LAB_STATES[0].key);
  const [mode, setMode] = useState<RoadmapRailMode>('open');
  const state = useMemo(
    () => ROADMAP_LAB_STATES.find(s => s.key === stateKey) ?? ROADMAP_LAB_STATES[0],
    [stateKey]
  );

  return (
    <main
      className="min-h-svh px-6 py-8 font-sans"
      style={{ background: HUD.bg.deep, color: HUD.text }}
    >
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="font-display text-lg font-semibold">Roadmap lab</h1>
        <p className="text-xs" style={{ color: HUD.textDim }}>
          Fixture states through the real parser and rail. Prototypes below are
          mock interactions — the lab never writes a roadmap file.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {ROADMAP_LAB_STATES.map(s => (
          <button
            key={s.key}
            type="button"
            data-lab-state={s.key}
            onClick={() => setStateKey(s.key)}
            className="rounded border px-2 py-1 font-mono text-[11px] outline-none hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-hud-cyan"
            style={{
              borderColor:
                s.key === stateKey ? withAlpha(HUD.cyan, 0.7) : 'rgba(80,230,255,0.18)',
              color: s.key === stateKey ? HUD.text : HUD.textDim,
              background: s.key === stateKey ? withAlpha(HUD.cyan, 0.08) : 'transparent',
            }}
          >
            {s.label}
          </button>
        ))}
        <span className="ml-2 font-mono text-[11px]" style={{ color: HUD.textDim }}>
          {state.blurb}
        </span>
      </div>

      <div className="flex items-start gap-8">
        {/* the strip and the rail, side by side, against a fake stage */}
        <section
          aria-label="Collapsed strip"
          className="flex h-[560px] overflow-hidden rounded border"
          style={{ borderColor: 'rgba(80,230,255,0.15)' }}
        >
          <div
            className="grid w-40 place-items-center font-mono text-[10px]"
            style={{ color: HUD.textDim }}
          >
            terminal stage
          </div>
          <RoadmapRail
            view={state.view}
            projectDir="/fixtures/lab"
            projectName="lab"
            projectColor={HUD.cyan}
            mode="strip"
            onModeChange={() => {}}
            onSelectSession={() => {}}
            overlay={false}
          />
        </section>

        <section
          aria-label="Open rail"
          className="flex h-[560px] overflow-hidden rounded border"
          style={{ borderColor: 'rgba(80,230,255,0.15)' }}
        >
          <div
            className="grid w-40 place-items-center font-mono text-[10px]"
            style={{ color: HUD.textDim }}
          >
            terminal stage
          </div>
          <RoadmapRail
            view={state.view}
            projectDir="/fixtures/lab"
            projectName="lab"
            projectColor={HUD.cyan}
            mode={mode}
            onModeChange={setMode}
            onSelectSession={() => {}}
            overlay={false}
          />
        </section>
      </div>

      <RoadmapFeedPrototypes view={state.view} />
    </main>
  );
}
