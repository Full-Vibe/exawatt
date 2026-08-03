'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AgentStatus } from '@exawatt/core';
import {
  CornerBrackets,
  HudFrame,
  Label,
  Readout,
  RingGauge,
  StatBar,
  StatusPill,
  HUD,
  type HudTone,
} from '@/components/hud';
import {
  WebglFramesScene,
  WebglBracketsScene,
  WebglLabelsScene,
  WebglStatBarsScene,
  WebglGaugesScene,
  WebglPillsScene,
  WebglComposedScene,
  WebglStatusLightsScene,
} from '@/components/hud/webgl/scenes';
import {
  StatusLightDomSpecimens,
  StatusLightProtocolLegend,
} from '@/components/status-light';
import {
  FIXTURE_AGENTS,
  FIXTURE_METRICS,
} from '@/components/hud/gallery-fixtures';
import { SessionStateTileStudy } from '@/components/hud/session-state-tile-study';
import { ProjectRibbonStudy } from '@/components/hud/project-ribbon-study';

const TONES: HudTone[] = ['cyan', 'magenta', 'amber', 'red', 'green', 'idle'];
const STATUSES: AgentStatus[] = [
  'working',
  'reviewing',
  'blocked',
  'error',
  'complete',
  'idle',
];

const agent = FIXTURE_AGENTS[0];

interface Section {
  id: string;
  title: string;
  meta: string;
  dom?: ReactNode;
  webgl?: ReactNode;
  showcase?: ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'elastic-project-ribbon',
    title: 'Elastic Project ribbon',
    meta: 'production component · two-row target-bounds layout + Initiative projection',
    showcase: <ProjectRibbonStudy />,
  },
  {
    id: 'session-state-tiles',
    title: 'Session state tiles',
    meta: 'review candidate · region / question projection in production geometry',
    showcase: <SessionStateTileStudy />,
  },
  {
    id: 'status-lights',
    title: 'Agent status lights',
    meta: 'canon · D40 five-signal protocol',
    dom: <StatusLightDomSpecimens />,
    webgl: (
      <div className="flex max-w-3xl flex-col gap-5">
        <WebglStatusLightsScene />
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className="font-display text-sm font-semibold">
              Spatial Agent pieces
            </p>
            <p
              className="mt-1 max-w-[55ch] text-xs leading-relaxed"
              style={{ color: HUD.textDim }}
            >
              Status stays in the emissive core. Project zones and identity
              marks keep their own color channel.
            </p>
          </div>
          <span
            className="shrink-0 rounded border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em]"
            style={{ color: HUD.amber, borderColor: HUD.strokeSoft }}
          >
            Not wired
          </span>
        </div>
        <StatusLightProtocolLegend compact />
      </div>
    ),
  },
  {
    id: 'frames',
    title: 'Frames',
    meta: 'HudFrame — chamfered glass + neon edge',
    dom: (
      <div className="flex flex-wrap gap-5">
        <HudFrame className="hud-lift h-[150px] w-48" tone="cyan">
          <div className="p-4">
            <Label tone="cyan">Project</Label>
            <p className="mt-2 font-display text-lg">OpenClaw Local Parity</p>
          </div>
        </HudFrame>
        <HudFrame
          className="hud-lift h-[150px] w-48"
          tone="amber"
          chamfer={['tl', 'tr', 'br', 'bl']}
        >
          <div className="p-4">
            <Label tone="amber">Reviewing</Label>
            <p className="mt-2 font-display text-lg">Merge open PRs</p>
          </div>
        </HudFrame>
        <HudFrame
          className="hud-lift h-[150px] w-48"
          tone="magenta"
          intensity={1.2}
        >
          <CornerBrackets tone="magenta" active corners={['tl', 'br']} />
          <div className="p-4">
            <Label tone="magenta">Selected</Label>
            <p className="mt-2 font-display text-lg">Competitor pricing</p>
          </div>
        </HudFrame>
      </div>
    ),
    webgl: <WebglFramesScene />,
  },
  {
    id: 'brackets',
    title: 'Corner brackets',
    meta: 'CornerBrackets — focus L-marks',
    dom: (
      <div
        className="relative h-[120px] w-[200px] border"
        style={{ borderColor: 'rgba(80,230,255,0.15)' }}
      >
        <CornerBrackets tone="cyan" active />
      </div>
    ),
    webgl: <WebglBracketsScene />,
  },
  {
    id: 'labels',
    title: 'Labels & readouts',
    meta: 'type atoms',
    dom: (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          {TONES.map(t => (
            <Label key={t} tone={t}>
              {t} label
            </Label>
          ))}
        </div>
        <div className="flex gap-6">
          <Readout label="Burn" value="$2.40" unit="/hr" tone="amber" />
          <Readout label="Spend" value="$8.71" />
          <Readout label="Active" value="3" tone="cyan" />
        </div>
      </div>
    ),
    webgl: <WebglLabelsScene />,
  },
  {
    id: 'statbars',
    title: 'Stat bars',
    meta: 'segmented metric bar · 0 / 25 / 50 / 100',
    dom: (
      <div className="flex w-[300px] flex-col gap-3">
        {[0, 0.25, 0.5, 1].map((v, i) => (
          <StatBar
            key={v}
            label={`Metric ${i}`}
            value={v}
            tone={TONES[i % TONES.length]}
          />
        ))}
      </div>
    ),
    webgl: <WebglStatBarsScene />,
  },
  {
    id: 'gauges',
    title: 'Ring gauges',
    meta: 'radial arc gauge',
    dom: (
      <div className="flex gap-6">
        <RingGauge value={0.72} label="Goal" tone="cyan" ambient />
        <RingGauge value={0.4} label="Burn" tone="amber" />
        <RingGauge value={0.18} label="Blocked" tone="red" />
      </div>
    ),
    webgl: <WebglGaugesScene />,
  },
  {
    id: 'pills',
    title: 'Status pills',
    meta: 'agent status chip · all six',
    dom: (
      <div className="flex max-w-[320px] flex-wrap gap-2">
        {STATUSES.map(s => (
          <StatusPill key={s} status={s} />
        ))}
      </div>
    ),
    webgl: <WebglPillsScene />,
  },
  {
    id: 'composed',
    title: 'Composed agent panel',
    meta: 'blocks assembled',
    dom: (
      <HudFrame className="hud-lift w-80" tone="red" intensity={1.1}>
        <CornerBrackets tone="red" active corners={['tl', 'br']} />
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="font-display text-base">{agent.name}</p>
            <StatusPill status={agent.status} />
          </div>
          <p className="text-sm" style={{ color: HUD.textDim }}>
            {agent.blockerTitle}
          </p>
          <StatBar
            label="Cost rate"
            value={agent.costRate}
            max={2}
            tone="amber"
          />
          <div className="flex gap-6">
            <Readout label="Cost" value={`$${agent.cost.toFixed(2)}`} />
            <Readout label="Turns" value={agent.turnCount} />
            <Readout
              label="Fleet spend"
              value={`$${FIXTURE_METRICS.totalCost.toFixed(2)}`}
            />
          </div>
        </div>
      </HudFrame>
    ),
    webgl: (
      <WebglComposedScene
        name={agent.name}
        blocker={agent.blockerTitle ?? ''}
        status={agent.status}
        costRate={agent.costRate}
        cost={agent.cost}
        turns={agent.turnCount}
        fleetSpend={FIXTURE_METRICS.totalCost}
      />
    ),
  },
];

function ColumnLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className="font-mono text-[10px] uppercase tracking-[0.2em]"
      style={{ color: HUD.textDim }}
    >
      {children}
    </span>
  );
}

export default function HudGallery() {
  const [active, setActive] = useState(SECTIONS[0].id);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // Highlight the nav for the section nearest the top of the viewport.
  useEffect(() => {
    const io = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-20% 0px -65% 0px', threshold: [0, 0.25, 0.5, 1] }
    );
    for (const s of SECTIONS) {
      const el = sectionRefs.current[s.id];
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  // Reveal each section once as it scrolls into view (fade + rise).
  useEffect(() => {
    const io = new IntersectionObserver(
      entries => {
        setRevealed(prev => {
          let next = prev;
          for (const e of entries) {
            if (e.isIntersecting && !prev.has(e.target.id)) {
              if (next === prev) next = new Set(prev);
              next.add(e.target.id);
            }
          }
          return next;
        });
      },
      { rootMargin: '0px', threshold: 0.01 }
    );
    for (const s of SECTIONS) {
      const el = sectionRefs.current[s.id];
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  const focusSection = useCallback((id: string) => {
    const el = sectionRefs.current[id];
    if (!el) return;
    const reduce = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
    setActive(id);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return;
      }
      const idx = SECTIONS.findIndex(s => s.id === active);
      let next = -1;
      if (e.key === 'j' || e.key === 'ArrowDown')
        next = Math.min(SECTIONS.length - 1, idx + 1);
      else if (e.key === 'k' || e.key === 'ArrowUp')
        next = Math.max(0, idx - 1);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = SECTIONS.length - 1;
      if (next >= 0) {
        e.preventDefault();
        focusSection(SECTIONS[next].id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, focusSection]);

  return (
    <div
      className="min-h-screen"
      style={{
        color: HUD.text,
        background: `radial-gradient(120% 90% at 50% -10%, ${HUD.bg.hazeTeal}, transparent 55%), radial-gradient(120% 90% at 80% 120%, ${HUD.bg.hazeIndigo}, transparent 55%), ${HUD.bg.void}`,
      }}
    >
      <a
        href="#gallery-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-hud-cyan focus:px-3 focus:py-1.5 focus:text-sm focus:text-black"
      >
        Skip to content
      </a>

      <div className="mx-auto flex max-w-[1600px] gap-10 px-8 py-10">
        <nav
          aria-label="Gallery sections"
          className="sticky top-10 hidden h-fit w-44 shrink-0 lg:block"
        >
          <p
            className="font-mono text-[10px] uppercase tracking-[0.18em]"
            style={{ color: HUD.textDim }}
          >
            HUD library
          </p>
          <ul className="mt-3 flex flex-col gap-0.5">
            {SECTIONS.map(s => {
              const on = s.id === active;
              return (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    onClick={e => {
                      e.preventDefault();
                      focusSection(s.id);
                    }}
                    aria-current={on ? 'true' : undefined}
                    className="flex items-center gap-2 rounded-sm border px-2.5 py-1.5 font-ui text-sm outline-none transition-[background-color,color,border-color] duration-200 focus-visible:ring-2 focus-visible:ring-hud-cyan"
                    style={{
                      borderColor: on ? HUD.strokeSoft : 'transparent',
                      color: on ? HUD.cyan : HUD.textDim,
                      background: on ? 'rgba(25,230,255,0.06)' : 'transparent',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: on ? HUD.cyan : HUD.strokeSoft }}
                    />
                    {s.title}
                  </a>
                </li>
              );
            })}
          </ul>
          <p
            className="mt-4 font-mono text-[10px] leading-relaxed"
            style={{ color: HUD.textDim }}
          >
            j / k · arrows to step
          </p>
        </nav>

        <main id="gallery-main" className="min-w-0 flex-1">
          <header className="mb-10">
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl font-semibold tracking-tight">
                HUD component library
              </h1>
              <span
                className="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]"
                style={{
                  color: HUD.amber,
                  borderColor: 'rgba(255,176,46,0.4)',
                  background: 'rgba(255,176,46,0.08)',
                }}
              >
                Dev
              </span>
            </div>
            <p className="mt-1 text-sm" style={{ color: HUD.textDim }}>
              The live workbench that renders the design system of record
              (docs/engineering/design-system.md). DOM wins for crisp,
              keyboard-accessible chrome; WebGL is reserved for the scalable
              agent world and reviewable material work.{' '}
              <a
                href="/hud-gallery/consumption-lab"
                className="underline underline-offset-2"
                style={{ color: HUD.cyan }}
              >
                Open the Consumption lab →
              </a>{' '}
              <a
                href="/hud-gallery/roadmap-lab"
                className="underline underline-offset-2"
                style={{ color: HUD.cyan }}
              >
                Open the Roadmap lab →
              </a>{' '}
              <a
                href="/hud-gallery/project-ribbon/bench"
                className="underline underline-offset-2"
                style={{ color: HUD.cyan }}
              >
                Open the Ribbon dogfood bench →
              </a>
            </p>
          </header>

          <div className="flex flex-col gap-14">
            {SECTIONS.map(s => (
              <section
                key={s.id}
                id={s.id}
                tabIndex={-1}
                aria-labelledby={`${s.id}-h`}
                ref={el => {
                  sectionRefs.current[s.id] = el;
                }}
                className={`hud-reveal scroll-mt-20 outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan/40 ${
                  revealed.has(s.id) ? 'is-in' : ''
                }`}
              >
                <div className="mb-5 flex items-baseline gap-3">
                  <h2
                    id={`${s.id}-h`}
                    className="font-display text-lg font-semibold tracking-tight"
                  >
                    {s.title}
                  </h2>
                  <span
                    className="font-mono text-[11px]"
                    style={{ color: HUD.textDim }}
                  >
                    {s.meta}
                  </span>
                </div>
                {s.showcase ? (
                  <div>{s.showcase}</div>
                ) : (
                  <div className="grid grid-cols-1 gap-8 2xl:grid-cols-2">
                    <div className="flex min-w-0 flex-col gap-3">
                      <ColumnLabel>DOM / SVG</ColumnLabel>
                      <div>{s.dom}</div>
                    </div>
                    <div className="flex min-w-0 flex-col gap-3">
                      <ColumnLabel>WebGL · Three.js</ColumnLabel>
                      <div>{s.webgl}</div>
                    </div>
                  </div>
                )}
              </section>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
