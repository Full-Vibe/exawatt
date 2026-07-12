'use client';

/**
 * Roadmap lab (ENG-017 S10, dev workbench like the rest of /hud-gallery).
 *
 * S10 resolution (operator, 2026-07-12): refine the SHIPPED design rather
 * than replace it — the three exploratory directions were retired after a
 * play session (see project doc). The lab renders the real strip + rail
 * against fixture states pushed through the real parser, so every designed
 * state is one click away. Prototypes below stay mock-only; nothing here
 * writes a roadmap file.
 */
import { useMemo, useState } from 'react';
import { RoadmapRail, type RoadmapRailMode } from '@/components/roadmap/roadmap-rail';
import { ROADMAP_LAB_STATES } from '@/components/roadmap/lab-fixtures';
import { RoadmapFeedPrototypes } from './prototypes';

const LAB = {
  page: '#0e1013',
  text: '#e8eaed',
  sub: '#9aa1ab',
  faint: '#6d7480',
  line: 'rgba(255,255,255,0.09)',
  accent: '#8ab4f8',
};

export default function RoadmapLabPage() {
  const [stateKey, setStateKey] = useState(ROADMAP_LAB_STATES[0].key);
  const [mode, setMode] = useState<RoadmapRailMode>('open');
  const state = useMemo(
    () => ROADMAP_LAB_STATES.find(s => s.key === stateKey) ?? ROADMAP_LAB_STATES[0],
    [stateKey]
  );

  return (
    <main
      className="min-h-svh px-8 py-8 font-ui"
      style={{ background: LAB.page, color: LAB.text }}
    >
      <header className="mb-6 flex max-w-3xl flex-col gap-1.5">
        <h1 className="text-[20px] font-semibold">Roadmap lab</h1>
        <p className="text-[13px] leading-5" style={{ color: LAB.sub }}>
          The shipped roadmap strip and rail against canned roadmap states,
          rendered through the real parser. Pick a state, then drive the rail
          exactly as in the workspace — click or arrow-key into items, Enter
          drills, Escape backs out. Nothing here writes files.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[12.5px]" style={{ color: LAB.sub }}>
          Roadmap state:
        </span>
        {ROADMAP_LAB_STATES.map(s => (
          <button
            key={s.key}
            type="button"
            data-lab-state={s.key}
            onClick={() => setStateKey(s.key)}
            className="rounded-full border px-3 py-1 text-[12.5px] outline-none hover:bg-white/10 focus-visible:ring-2"
            style={{
              borderColor: s.key === stateKey ? LAB.accent : LAB.line,
              color: s.key === stateKey ? LAB.text : LAB.sub,
              background: s.key === stateKey ? 'rgba(138,180,248,0.10)' : 'transparent',
            }}
          >
            {s.label}
          </button>
        ))}
        <span className="ml-2 text-[12px]" style={{ color: LAB.faint }}>
          {state.blurb}
        </span>
      </div>

      <div className="flex items-start gap-8">
        <section className="flex flex-col gap-2">
          <p className="text-[12.5px] font-medium" style={{ color: LAB.sub }}>
            Collapsed strip — the resting posture
          </p>
          <div
            aria-label="Collapsed strip"
            className="flex h-[560px] overflow-hidden rounded-xl border"
            style={{ borderColor: LAB.line, background: '#070b14' }}
          >
            <div
              className="grid w-36 place-items-center text-[11px]"
              style={{ color: LAB.faint }}
            >
              terminal stage
            </div>
            <RoadmapRail
              view={state.view}
              projectDir="/fixtures/lab"
              projectName="lab"
              projectColor="#50e6ff"
              mode="strip"
              onModeChange={() => {}}
              onSelectSession={() => {}}
              overlay={false}
            />
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <p className="text-[12.5px] font-medium" style={{ color: LAB.sub }}>
            Open rail — ⌘B in the workspace
          </p>
          <div
            aria-label="Open rail"
            className="flex h-[560px] overflow-hidden rounded-xl border"
            style={{ borderColor: LAB.line, background: '#070b14' }}
          >
            <div
              className="grid w-36 place-items-center text-[11px]"
              style={{ color: LAB.faint }}
            >
              terminal stage
            </div>
            <RoadmapRail
              view={state.view}
              projectDir="/fixtures/lab"
              projectName="lab"
              projectColor="#50e6ff"
              mode={mode}
              onModeChange={setMode}
              onSelectSession={() => {}}
              overlay={false}
            />
          </div>
        </section>
      </div>

      <RoadmapFeedPrototypes view={state.view} />
    </main>
  );
}
