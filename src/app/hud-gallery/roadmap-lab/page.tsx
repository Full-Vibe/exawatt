'use client';

/**
 * Roadmap lab (ENG-017 S10, dev workbench like the rest of /hud-gallery).
 *
 * S10 resolution (operator, 2026-07-12): refine the SHIPPED design rather
 * than replace it — the three exploratory directions were retired after a
 * play session (see project doc). The lab renders the real roadmap panel, in
 * a frame the width of Team's dock, against fixture states pushed through
 * the real parser, so every designed
 * state is one click away. Prototypes below stay mock-only; nothing here
 * writes a roadmap file; manipulation gestures resolve into inline fixture
 * failures so pending and failure states can be inspected safely.
 */
import { useMemo, useState } from 'react';
import { RoadmapPanel } from '@/components/roadmap/roadmap-panel';
import { TEAM_DOCK_WIDTH } from '@/components/team/team-dock';
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
  const state = useMemo(
    () =>
      ROADMAP_LAB_STATES.find(s => s.key === stateKey) ?? ROADMAP_LAB_STATES[0],
    [stateKey]
  );

  return (
    <main
      className="min-h-svh px-8 py-8 font-ui"
      style={{ background: LAB.page, color: LAB.text }}
    >
      <header className="mb-6 flex max-w-3xl flex-col gap-1.5">
        <h1 className="text-xl font-semibold">Roadmap lab</h1>
        <p className="text-sm leading-5" style={{ color: LAB.sub }}>
          The shipped roadmap panel against canned roadmap states, rendered
          through the real parser. Pick a state, then drive the panel exactly as
          in Team: click or arrow-key into items, Enter drills, Escape backs
          out. Nothing here writes files.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs" style={{ color: LAB.sub }}>
          Roadmap state:
        </span>
        {ROADMAP_LAB_STATES.map(s => (
          <button
            key={s.key}
            type="button"
            data-lab-state={s.key}
            onClick={() => setStateKey(s.key)}
            className="rounded-full border px-3 py-1 text-xs outline-none hover:bg-white/10 focus-visible:ring-2"
            style={{
              borderColor: s.key === stateKey ? LAB.accent : LAB.line,
              color: s.key === stateKey ? LAB.text : LAB.sub,
              background:
                s.key === stateKey ? 'rgba(138,180,248,0.10)' : 'transparent',
            }}
          >
            {s.label}
          </button>
        ))}
        <span className="ml-2 text-xs" style={{ color: LAB.faint }}>
          {state.blurb}
        </span>
      </div>

      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium" style={{ color: LAB.sub }}>
          The Roadmap tab of Team&apos;s dock (⌘B in the workspace)
        </p>
        <div
          aria-label="Roadmap panel"
          className="flex h-[560px] flex-col overflow-hidden rounded-xl border"
          style={{
            width: TEAM_DOCK_WIDTH,
            borderColor: LAB.line,
            background: '#070b14',
          }}
        >
          <RoadmapPanel
            view={state.view}
            projectDir="/fixtures/lab"
            projectName="lab"
            projectColor="#50e6ff"
            onSelectSession={() => {}}
            untriagedFeedback={3}
          />
        </div>
      </section>

      <RoadmapFeedPrototypes view={state.view} />
    </main>
  );
}
