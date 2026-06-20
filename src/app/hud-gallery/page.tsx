'use client';

import Link from 'next/link';
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
  FIXTURE_AGENTS,
  FIXTURE_METRICS,
} from '@/components/hud/gallery-fixtures';

const TONES: HudTone[] = ['cyan', 'magenta', 'amber', 'red', 'green', 'idle'];
const STATUSES: AgentStatus[] = [
  'working',
  'reviewing',
  'blocked',
  'error',
  'complete',
  'idle',
];

interface Section {
  id: string;
  title: string;
  meta: string;
  render: () => ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'frames',
    title: 'Frames',
    meta: 'HudFrame — chamfered glass + neon edge',
    render: () => (
      <Row>
        <Cell label="chamfer tr+bl · cyan">
          <HudFrame className="h-40 w-72" tone="cyan">
            <div className="p-4">
              <Label tone="cyan">Project</Label>
              <p className="mt-2 font-display text-lg">OpenClaw Local Parity</p>
            </div>
          </HudFrame>
        </Cell>
        <Cell label="all corners · amber">
          <HudFrame
            className="h-40 w-72"
            tone="amber"
            chamfer={['tl', 'tr', 'br', 'bl']}
          >
            <div className="p-4">
              <Label tone="amber">Reviewing</Label>
              <p className="mt-2 font-display text-lg">Merge open PRs</p>
            </div>
          </HudFrame>
        </Cell>
        <Cell label="selected · magenta + brackets">
          <HudFrame className="h-40 w-72" tone="magenta" intensity={1.2}>
            <CornerBrackets tone="magenta" active />
            <div className="p-4">
              <Label tone="magenta">Selected</Label>
              <p className="mt-2 font-display text-lg">Competitor pricing</p>
            </div>
          </HudFrame>
        </Cell>
      </Row>
    ),
  },
  {
    id: 'brackets',
    title: 'Corner brackets',
    meta: 'CornerBrackets — focus L-marks',
    render: () => (
      <Row>
        <Cell label="active">
          <div
            className="relative h-32 w-56 border"
            style={{ borderColor: 'rgba(80,230,255,0.15)' }}
          >
            <CornerBrackets tone="cyan" active />
          </div>
        </Cell>
      </Row>
    ),
  },
  {
    id: 'labels',
    title: 'Labels & readouts',
    meta: 'type atoms',
    render: () => (
      <Row>
        <Cell label="labels">
          <div className="flex flex-col gap-2">
            {TONES.map((t) => (
              <Label key={t} tone={t}>
                {t} label
              </Label>
            ))}
          </div>
        </Cell>
        <Cell label="readouts">
          <div className="flex gap-6">
            <Readout label="Burn" value="$2.40" unit="/hr" tone="amber" />
            <Readout label="Spend" value="$8.71" />
            <Readout label="Active" value="3" tone="cyan" />
          </div>
        </Cell>
      </Row>
    ),
  },
  {
    id: 'statbars',
    title: 'Stat bars',
    meta: 'segmented metric bar · 0 / 25 / 50 / 100',
    render: () => (
      <Row>
        <Cell label="tones by fill">
          <div className="flex w-72 flex-col gap-3">
            {[0, 0.25, 0.5, 1].map((v, i) => (
              <StatBar
                key={v}
                label={`Metric ${i}`}
                value={v}
                tone={TONES[i % TONES.length]}
              />
            ))}
          </div>
        </Cell>
      </Row>
    ),
  },
  {
    id: 'gauges',
    title: 'Ring gauges',
    meta: 'radial arc gauge',
    render: () => (
      <Row>
        <Cell label="goal / burn / blocked">
          <div className="flex gap-6">
            <RingGauge value={0.72} label="Goal" tone="cyan" ambient />
            <RingGauge value={0.4} label="Burn" tone="amber" />
            <RingGauge value={0.18} label="Blocked" tone="red" />
          </div>
        </Cell>
      </Row>
    ),
  },
  {
    id: 'pills',
    title: 'Status pills',
    meta: 'agent status chip · all six',
    render: () => (
      <Row>
        <Cell label="statuses">
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <StatusPill key={s} status={s} />
            ))}
          </div>
        </Cell>
      </Row>
    ),
  },
  {
    id: 'composed',
    title: 'Composed agent panel',
    meta: 'blocks assembled',
    render: () => (
      <Row>
        <Cell label="blocked agent">
          <HudFrame className="w-80" tone="red" intensity={1.1}>
            <CornerBrackets tone="red" active />
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-display text-base">
                  {FIXTURE_AGENTS[0].name}
                </p>
                <StatusPill status={FIXTURE_AGENTS[0].status} />
              </div>
              <p className="text-sm" style={{ color: HUD.textDim }}>
                {FIXTURE_AGENTS[0].blockerTitle}
              </p>
              <StatBar
                label="Cost rate"
                value={FIXTURE_AGENTS[0].costRate}
                max={2}
                tone="amber"
              />
              <div className="flex gap-6">
                <Readout
                  label="Cost"
                  value={`$${FIXTURE_AGENTS[0].cost.toFixed(2)}`}
                />
                <Readout label="Turns" value={FIXTURE_AGENTS[0].turnCount} />
                <Readout
                  label="Fleet spend"
                  value={`$${FIXTURE_METRICS.totalCost.toFixed(2)}`}
                />
              </div>
            </div>
          </HudFrame>
        </Cell>
      </Row>
    ),
  },
];

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-10">{children}</div>;
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <span
        className="font-mono text-[10px] tracking-wide"
        style={{ color: HUD.textDim }}
      >
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}

export default function HudGallery() {
  const [active, setActive] = useState(SECTIONS[0].id);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // Track which section is in view to highlight the nav.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
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

  // Keyboard: j/↓ next section, k/↑ prev, Home/End first/last.
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
      const idx = SECTIONS.findIndex((s) => s.id === active);
      let next = -1;
      if (e.key === 'j' || e.key === 'ArrowDown')
        next = Math.min(SECTIONS.length - 1, idx + 1);
      else if (e.key === 'k' || e.key === 'ArrowUp') next = Math.max(0, idx - 1);
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

      <div className="mx-auto flex max-w-6xl gap-10 px-8 py-10">
        {/* Sticky section nav — Tab to focus, Enter to jump, j/k to step */}
        <nav
          aria-label="Gallery sections"
          className="sticky top-10 hidden h-fit w-48 shrink-0 md:block"
        >
          <p
            className="font-mono text-[10px] uppercase tracking-[0.18em]"
            style={{ color: HUD.textDim }}
          >
            HUD library
          </p>
          <ul className="mt-3 flex flex-col gap-0.5">
            {SECTIONS.map((s) => {
              const on = s.id === active;
              return (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      focusSection(s.id);
                    }}
                    aria-current={on ? 'true' : undefined}
                    className="block rounded-sm border-l-2 px-3 py-1.5 font-ui text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-hud-cyan"
                    style={{
                      borderColor: on ? HUD.cyan : 'transparent',
                      color: on ? HUD.cyan : HUD.textDim,
                      background: on ? 'rgba(25,230,255,0.06)' : 'transparent',
                    }}
                  >
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
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              HUD component library
            </h1>
            <p className="mt-1 text-sm" style={{ color: HUD.textDim }}>
              Isolation harness — each block on the HUD backdrop, for screenshot
              review.{' '}
              <Link
                href="/hud-gallery/webgl-panel"
                className="underline underline-offset-2"
                style={{ color: HUD.cyan }}
              >
                WebGL A/B probe →
              </Link>
            </p>
          </header>

          <div className="flex flex-col gap-16">
            {SECTIONS.map((s) => (
              <section
                key={s.id}
                id={s.id}
                tabIndex={-1}
                aria-labelledby={`${s.id}-h`}
                ref={(el) => {
                  sectionRefs.current[s.id] = el;
                }}
                className="scroll-mt-10 outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan/40"
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
                {s.render()}
              </section>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
