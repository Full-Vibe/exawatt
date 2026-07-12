'use client';

/**
 * Roadmap lab (ENG-017 S10, dev workbench like the rest of /hud-gallery).
 *
 * Round 2: the operator rejected the shipped HUD treatment (dense, mono,
 * sci-fi, dot affordances). The lab now leads with three design DIRECTIONS
 * (see directions.tsx) rendered against the same fixture states, with the
 * shipped rail demoted to a comparison panel at the bottom. Fixture states
 * still go through the real parser; nothing here writes a roadmap file.
 */
import { useMemo, useState } from 'react';
import { RoadmapRail, type RoadmapRailMode } from '@/components/roadmap/roadmap-rail';
import { ROADMAP_LAB_STATES } from '@/components/roadmap/lab-fixtures';
import { RoadmapFeedPrototypes } from './prototypes';
import {
  DIRECTION_PALETTE as C,
  DirectionBrief,
  DirectionJourney,
  DirectionFocus,
  BriefStrip,
  JourneyStrip,
  FocusStrip,
} from './directions';

function DirectionPanel({
  name,
  thesis,
  habitat,
  children,
  strip,
  stripCaption,
  wide = false,
}: {
  name: string;
  thesis: string;
  habitat: string;
  children: React.ReactNode;
  strip: React.ReactNode;
  stripCaption: string;
  wide?: boolean;
}) {
  return (
    <section
      data-lab-direction={name.toLowerCase()}
      className={`flex flex-col gap-3 ${wide ? 'w-full' : 'w-[400px]'}`}
    >
      <header className="flex flex-col gap-0.5">
        <h3 className="text-[15px] font-semibold" style={{ color: C.text }}>
          {name}
        </h3>
        <p className="text-[12.5px] leading-5" style={{ color: C.sub }}>
          {thesis}
        </p>
        <p className="text-[11.5px]" style={{ color: C.faint }}>
          Lives as: {habitat}
        </p>
      </header>
      <div
        className={`overflow-hidden rounded-xl ${wide ? '' : 'h-[520px]'}`}
        style={{ background: C.panel, border: `1px solid ${C.line}` }}
      >
        {children}
      </div>
      <div
        className="flex flex-col gap-2 rounded-lg px-3 py-2.5"
        style={{ background: C.panel, border: `1px solid ${C.lineSoft}` }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 text-[11.5px]" style={{ color: C.faint }}>
            collapsed
          </span>
          <span className="min-w-0 flex-1 overflow-hidden">{strip}</span>
        </div>
        <p className="text-[11.5px]" style={{ color: C.faint }}>
          {stripCaption}
        </p>
      </div>
    </section>
  );
}

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
      style={{ background: C.page, color: C.text }}
    >
      <header className="mb-6 flex max-w-3xl flex-col gap-1.5">
        <h1 className="text-[20px] font-semibold">Roadmap lab</h1>
        <p className="text-[13px] leading-5" style={{ color: C.sub }}>
          Three design directions for the roadmap lens, all reading the same
          data. Pick a roadmap state below, then compare how each direction
          answers “where are we, what’s next, what’s blocked.” The shipped
          design is at the bottom for comparison. Nothing here writes files.
        </p>
      </header>

      <div className="mb-8 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[12.5px]" style={{ color: C.sub }}>
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
              borderColor: s.key === stateKey ? C.accent : C.line,
              color: s.key === stateKey ? C.text : C.sub,
              background: s.key === stateKey ? 'rgba(138,180,248,0.10)' : 'transparent',
            }}
          >
            {s.label}
          </button>
        ))}
        <span className="ml-2 text-[12px]" style={{ color: C.faint }}>
          {state.blurb}
        </span>
      </div>

      <div className="mb-10 flex flex-wrap items-start gap-8">
        <DirectionPanel
          name="Brief"
          thesis="An editorial status page: plain sentences, checkmark checklists, one progress bar per item. Reads top to bottom like a doc."
          habitat="right rail (like today)"
          strip={<BriefStrip view={state.view} />}
          stripCaption="a title-bar chip: current item, progress, blocked count"
        >
          <DirectionBrief view={state.view} />
        </DirectionPanel>

        <DirectionPanel
          name="Focus"
          thesis="One giant answer: the current item and its next milestone. Everything else compresses into a footer line."
          habitat="right rail or a summon-able overlay"
          strip={<FocusStrip view={state.view} />}
          stripCaption="just words: the next milestone, or the blocker"
        >
          <DirectionFocus view={state.view} />
        </DirectionPanel>
      </div>

      <div className="mb-10">
        <DirectionPanel
          name="Journey"
          thesis="The gantt answer: one horizontal track, left to right — shipped, you are here, next, later. Click a stop for detail."
          habitat="a bottom bar under the terminal, or a wide overlay"
          strip={<JourneyStrip view={state.view} />}
          stripCaption="the same track, minified — shape carries the meaning"
          wide
        >
          <DirectionJourney view={state.view} />
        </DirectionPanel>
      </div>

      <section className="mb-10 flex flex-col gap-3">
        <header className="flex max-w-3xl flex-col gap-0.5">
          <h3 className="text-[15px] font-semibold" style={{ color: C.text }}>
            Current (shipped)
          </h3>
          <p className="text-[12.5px]" style={{ color: C.sub }}>
            What the app renders today — kept here for comparison. Verdict from
            the first play session: too dense, weak hierarchy, dot markers
            unclear.
          </p>
        </header>
        <div className="flex items-start gap-6">
          <div
            aria-label="Collapsed strip"
            className="flex h-[520px] overflow-hidden rounded-xl border"
            style={{ borderColor: C.line, background: '#070b14' }}
          >
            <div className="grid w-36 place-items-center text-[11px]" style={{ color: C.faint }}>
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
          <div
            aria-label="Open rail"
            className="flex h-[520px] overflow-hidden rounded-xl border"
            style={{ borderColor: C.line, background: '#070b14' }}
          >
            <div className="grid w-36 place-items-center text-[11px]" style={{ color: C.faint }}>
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
        </div>
      </section>

      <RoadmapFeedPrototypes view={state.view} />
    </main>
  );
}
