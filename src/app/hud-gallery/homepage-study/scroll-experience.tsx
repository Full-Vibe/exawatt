'use client';

/**
 * The scroll story over one pinned visual (ENG-031 W15).
 *
 * Native scroll only. A tall section, one sticky stage inside it, and a
 * progress number read off `scrollY`. The visual reads progress from a ref
 * in `useFrame`; React re-renders only when the stage index changes, which
 * is six times per page, so the page moves at scroll frequency without
 * React in the loop (guide rules 4e, 14).
 *
 * The reading column is a panel per stage positioned where the deck puts it:
 * centred over the top of the globe on the landing and the fleet, to the
 * right or left for the three dissections, centred for the launch band and
 * the download. The three dissections carry the agent card, and a leader
 * line in an SVG overlay joins the card to the agent the visual is lifting.
 *
 * Below `md` the stage is a fixed-height card at the top of the viewport and
 * every panel is an ordinary block beneath it at full opacity (marketing
 * canon, "The phone stacks; it does not shrink").
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import type { StatusLightState } from '@/components/status-light/protocol';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import { DownloadCta } from '@/components/site/bands/download-cta';
import { heroBoardTheme } from '@/components/site/hero-board/hero-board-theme';
import { AgentCard } from './agent-card';
import { AgentPanel } from './agent-panel';
import type { CrustMaterialId } from './visuals/crust-materials';
import type { CrustSignalId } from './visuals/crust-signal';
import type { EnvironmentKind } from './visuals/environment';

export type SnapMode = 'off' | 'soft' | 'hard';
import {
  FLEET_MAX,
  fleetModel,
  STATUS_LABEL,
  type FleetAgent,
} from './fleet-model';
import {
  LAUNCH_SOURCES,
  STAGES,
  stageAt,
  type CopySetId,
  type Stage,
  RAIL_DWELL,
  stageBlend,
} from './stages';
import {
  VisualAnchor,
  type StoryDrive,
  type VisualId,
} from './visual-contract';

const VisualCanvas = dynamic(
  () => import('./visual-canvas').then(m => m.VisualCanvas),
  {
    ssr: false,
  }
);

const STAGE_SCREENS = 1.0;
/** Where the stage pins: under the 3rem site header (`top-12`). */
const PIN_TOP = 48;
const labelBlend = { from: 0, to: 0, t: 0 };

function exemplarFor(
  agents: FleetAgent[],
  count: number,
  status: StatusLightState | null
): number {
  if (!status) return -1;
  for (let i = 0; i < Math.min(count, agents.length); i += 1)
    if (agents[i].status === status && agents[i].project === 0) return i;
  for (let i = 0; i < Math.min(count, agents.length); i += 1)
    if (agents[i].status === status) return i;
  return -1;
}

export function ScrollExperience({
  visual,
  baseCount,
  copySet,
  material,
  marks,
  signal,
  light,
  snap,
}: {
  visual: VisualId;
  baseCount: number;
  copySet: CopySetId;
  material: CrustMaterialId;
  marks: boolean;
  signal: CrustSignalId;
  light: EnvironmentKind;
  /** Off: park anywhere. Soft: a pull to the nearest frame when the scroll
   *  stops near one. Hard: always land on a frame. */
  snap: SnapMode;
}) {
  const model = useMemo(() => fleetModel(), []);
  const theme = useMemo(() => heroBoardTheme('classic'), []);
  const reducedMotion = usePrefersReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const highlights = useMemo(
    () => STAGES.map(item => item.highlight[copySet] ?? null),
    [copySet]
  );
  const drive = useRef<StoryDrive>({
    progress: 0,
    base: baseCount,
    count: baseCount,
    highlights,
    exemplar: -1,
    selected: -1,
    rail: 0,
    recede: 0,
  });
  const anchor = useRef<VisualAnchor>(new VisualAnchor());
  const [stage, setStage] = useState(0);
  const [selected, setSelected] = useState(-1);
  const [visible, setVisible] = useState(true);
  // The agent under the pointer, mirrored here so a click can select it
  // without a React render per hover.
  const hoverRef = useRef(-1);
  const pressRef = useRef({ x: 0, y: 0 });
  const onHoverChange = useCallback((agent: number) => {
    hoverRef.current = agent;
  }, []);
  const press = useCallback((e: React.PointerEvent) => {
    pressRef.current.x = e.clientX;
    pressRef.current.y = e.clientY;
  }, []);
  const release = useCallback((e: React.PointerEvent) => {
    const moved =
      Math.abs(e.clientX - pressRef.current.x) +
      Math.abs(e.clientY - pressRef.current.y);
    if (moved > 6) return; // a drag turned the world; not a click
    setSelected(hoverRef.current);
  }, []);
  useEffect(() => {
    drive.current.selected = selected;
  }, [selected]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Progress from scroll, written to the drive; stage index into React.
  const sync = useCallback(() => {
    const section = sectionRef.current;
    if (!section) return;
    const rect = section.getBoundingClientRect();
    // Progress is pinned travel: zero the moment the stage pins under the
    // header, one the moment it unpins, mapped from the end of the landing
    // dwell to the start of the download dwell so every pixel of scroll
    // moves the scene (operator 2026-10-09: "it absorbs some of the scroll
    // before it starts updating the scene").
    const stageHeight = stageRef.current?.offsetHeight ?? window.innerHeight;
    const travel = Math.max(1, rect.height - stageHeight);
    const pinned = Math.max(0, Math.min(travel, PIN_TOP - rect.top));
    const last = STAGES.length - 1;
    const progress = RAIL_DWELL + (pinned / travel) * (last - 2 * RAIL_DWELL);
    const d = drive.current;
    d.progress = progress;
    d.base = baseCount;
    d.highlights = highlights;
    const index = stageAt(progress);
    const current = STAGES[index];
    d.count = baseCount;
    d.exemplar = current.card
      ? exemplarFor(model.agents, d.count, highlights[index])
      : -1;
    setStage(previous => (previous === index ? previous : index));
  }, [baseCount, highlights, model]);

  useEffect(() => {
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [sync]);

  // Snap: when the scroll stops, pull to the nearest composed frame.
  useEffect(() => {
    if (snap === 'off') return;
    let timer = 0;
    let settling = false;
    const scrollYFor = (progress: number) => {
      const section = sectionRef.current;
      const stageEl = stageRef.current;
      if (!section || !stageEl) return null;
      const rect = section.getBoundingClientRect();
      const travel = Math.max(1, rect.height - stageEl.offsetHeight);
      const last = STAGES.length - 1;
      const pinned = Math.max(
        0,
        Math.min(
          travel,
          ((progress - RAIL_DWELL) / (last - 2 * RAIL_DWELL)) * travel
        )
      );
      return rect.top + window.scrollY + pinned - PIN_TOP;
    };
    const settle = () => {
      const p = drive.current.progress;
      const nearest = Math.round(p);
      const away = Math.abs(p - nearest);
      if (away < 0.01) return;
      if (snap === 'soft' && away > 0.3) return;
      const top = scrollYFor(nearest);
      if (top === null || Math.abs(top - window.scrollY) < 2) return;
      settling = true;
      window.scrollTo({ top, behavior: 'smooth' });
      window.setTimeout(() => {
        settling = false;
      }, 700);
    };
    const onScroll = () => {
      if (settling) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, 160);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
    };
  }, [snap]);

  // Park the canvas when the section is off screen.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const io = new IntersectionObserver(entries => {
      setVisible(entries.some(entry => entry.isIntersecting));
    });
    io.observe(section);
    return () => io.disconnect();
  }, []);

  // Overlay: leader line, labels, hover card, written each frame from refs.
  const leaderRef = useRef<SVGPolylineElement>(null);
  const leaderDotRef = useRef<SVGCircleElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const focusRef = useRef<HTMLDivElement>(null);
  const openLeaderRef = useRef<SVGPolylineElement>(null);
  const openDotRef = useRef<SVGCircleElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const a = anchor.current;
      const stageEl = stageRef.current;
      if (!stageEl) return;
      // leader
      const leader = leaderRef.current;
      const dot = leaderDotRef.current;
      const card = cardRef.current;
      if (leader && dot) {
        const cardRect = card?.getBoundingClientRect();
        // No line on the phone: the card lives in the stack, not the stage.
        if (a.exemplar && cardRect && cardRect.width > 0) {
          const stageRect = stageEl.getBoundingClientRect();
          const toRight = cardRect.left - stageRect.left > stageRect.width / 2;
          const sx = toRight
            ? cardRect.left - stageRect.left
            : cardRect.right - stageRect.left;
          const sy = cardRect.top - stageRect.top + 28;
          const ex = a.exemplar.x;
          const ey = a.exemplar.y;
          const mx = toRight ? sx - 36 : sx + 36;
          leader.setAttribute('points', `${sx},${sy} ${mx},${sy} ${ex},${ey}`);
          leader.style.opacity = '1';
          dot.setAttribute('cx', String(ex));
          dot.setAttribute('cy', String(ey));
          dot.style.opacity = '1';
        } else {
          leader.style.opacity = '0';
          dot.style.opacity = '0';
        }
      }
      // labels, faded with the stage on the rail
      const lb = stageBlend(drive.current.rail, undefined, labelBlend);
      const labelsOn =
        (STAGES[lb.from].labels ? 1 - lb.t : 0) +
        (STAGES[lb.to].labels ? lb.t : 0);
      for (let i = 0; i < a.labels.length; i += 1) {
        const el = labelRefs.current[i];
        const label = a.labels[i];
        if (!el) continue;
        if (!label.visible || label.count === 0) {
          el.style.opacity = '0';
          continue;
        }
        el.style.opacity = String(labelsOn * (1 - drive.current.recede));
        el.style.transform = `translate(${label.x}px, ${label.y}px) translate(-50%, -100%)`;
        const count = el.querySelector('[data-label-count]');
        if (count) {
          const text = `${label.count} agent${label.count === 1 ? '' : 's'}${label.needsYou ? ` · ${label.needsYou} need you` : ''}`;
          if (count.textContent !== text) count.textContent = text;
        }
      }
      // the open agent: a panel tethered to its tile, on the side with room
      const focus = focusRef.current;
      const openLeader = openLeaderRef.current;
      const openDot = openDotRef.current;
      if (focus && openLeader && openDot) {
        if (a.focusPoint && a.focus >= 0) {
          const stageRect = stageEl.getBoundingClientRect();
          const fx = a.focusPoint.x;
          const fy = a.focusPoint.y;
          const toLeft = fx > stageRect.width * 0.62;
          const gap = 54;
          const px = toLeft ? fx - gap : fx + gap;
          focus.style.opacity = '1';
          focus.style.pointerEvents = 'auto';
          focus.style.transform = toLeft
            ? `translate(${px}px, ${fy}px) translate(-100%, -50%) scale(1)`
            : `translate(${px}px, ${fy}px) translate(0, -50%) scale(1)`;
          openLeader.setAttribute('points', `${fx},${fy} ${px},${fy}`);
          openLeader.style.opacity = '1';
          openDot.setAttribute('cx', String(fx));
          openDot.setAttribute('cy', String(fy));
          openDot.style.opacity = '1';
        } else {
          focus.style.opacity = '0';
          focus.style.pointerEvents = 'none';
          openLeader.style.opacity = '0';
          openDot.style.opacity = '0';
        }
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const current = STAGES[stage];
  const exemplarAgent =
    drive.current.exemplar >= 0 ? model.agents[drive.current.exemplar] : null;
  const selectedAgent = selected >= 0 ? model.agents[selected] : null;

  return (
    <section
      ref={sectionRef}
      className="relative"
      style={{ height: `${STAGES.length * STAGE_SCREENS * 100}svh` }}
      data-homepage-study-experience
      data-stage={current.id}
    >
      <div
        ref={stageRef}
        className="sticky top-12 z-10 h-[58svh] overflow-hidden bg-[#04060b] md:h-[calc(100svh-3rem)]"
        data-homepage-study-stage
        onPointerDown={press}
        onPointerUp={release}
      >
        <VisualCanvas
          visual={visual}
          model={model}
          theme={theme}
          drive={drive}
          anchor={anchor.current}
          reducedMotion={reducedMotion}
          visible={visible}
          material={material}
          marks={marks}
          signal={signal}
          light={light}
          onHoverChange={onHoverChange}
        />

        {/* Project labels, positioned from the visual. */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {model.projects.map(project => (
            <div
              key={project.id}
              ref={el => {
                labelRefs.current[project.id] = el;
              }}
              className="absolute left-0 top-0 whitespace-nowrap text-center opacity-0 transition-opacity duration-300 will-change-transform"
            >
              <p className="text-[13px] font-medium text-white/85">
                {project.name}
              </p>
              <p className="text-[11px] text-white/45" data-label-count />
            </div>
          ))}
        </div>

        {/* Leader line from the card to the lifted agent. */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        >
          <polyline
            ref={leaderRef}
            fill="none"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth="1"
            className="transition-opacity duration-300"
            style={{ opacity: 0 }}
          />
          <circle
            ref={leaderDotRef}
            r="3.5"
            fill="white"
            className="transition-opacity duration-300"
            style={{ opacity: 0 }}
          />
          <polyline
            ref={openLeaderRef}
            fill="none"
            stroke={theme.selection}
            strokeWidth="1"
            className="transition-opacity duration-200"
            style={{ opacity: 0 }}
          />
          <circle
            ref={openDotRef}
            r="3"
            fill={theme.selection}
            className="transition-opacity duration-200"
            style={{ opacity: 0 }}
          />
        </svg>

        {/* The selected agent. Click a tile to open it, anywhere else or
            Escape to close. */}
        <div
          ref={focusRef}
          className="absolute left-0 top-0 opacity-0 transition-[opacity,transform] duration-200 will-change-transform"
          onPointerDown={e => e.stopPropagation()}
          onPointerUp={e => e.stopPropagation()}
        >
          {selectedAgent ? (
            <AgentPanel agent={selectedAgent} theme={theme} />
          ) : null}
        </div>

        {/* Synthetic fleet stamp, always inside the frame. */}
        <p className="pointer-events-none absolute bottom-3 left-4 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
          Demo workspace · synthetic fleet
        </p>

        {/* Desktop panels. */}
        <div className="pointer-events-none absolute inset-0 hidden md:block">
          {STAGES.map((item, index) => (
            <Panel
              key={item.id}
              stage={item}
              copySet={copySet}
              active={index === stage}
              agent={index === stage ? exemplarAgent : null}
              cardRef={index === stage ? cardRef : undefined}
            />
          ))}
        </div>
      </div>

      {/* Phone: the same panels, stacked, full opacity. */}
      <div className="md:hidden">
        {STAGES.map((item, index) => (
          <div
            key={item.id}
            className="flex min-h-[42svh] flex-col justify-center gap-5 px-6 py-10"
          >
            <PanelBody
              stage={item}
              copySet={copySet}
              agent={index === stage ? exemplarAgent : null}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function Panel({
  stage,
  copySet,
  active,
  agent,
  cardRef,
}: {
  stage: Stage;
  copySet: CopySetId;
  active: boolean;
  agent: FleetAgent | null;
  cardRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const placement =
    stage.panel === 'right'
      ? 'right-[6vw] top-1/2 -translate-y-1/2 items-start text-left'
      : stage.panel === 'left'
        ? 'left-[6vw] top-1/2 -translate-y-1/2 items-start text-left'
        : stage.panel === 'center-top'
          ? 'left-1/2 top-[13vh] -translate-x-1/2 items-center text-center'
          : 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 items-center text-center';
  return (
    <div
      className={cn(
        'absolute flex max-w-[34rem] flex-col gap-5 transition-opacity duration-500',
        placement,
        // an invisible panel from another stage must never swallow a click
        // meant for the world under it
        active ? 'opacity-100' : 'opacity-0 [&_*]:!pointer-events-none'
      )}
      data-study-panel={stage.id}
      aria-hidden={!active}
    >
      <PanelBody
        stage={stage}
        copySet={copySet}
        agent={agent}
        cardRef={cardRef}
        interactive={active}
      />
    </div>
  );
}

function PanelBody({
  stage,
  copySet,
  agent,
  cardRef,
  interactive = true,
}: {
  stage: Stage;
  copySet: CopySetId;
  agent: FleetAgent | null;
  cardRef?: React.RefObject<HTMLDivElement | null>;
  /** Only the stage on screen may take the pointer. An invisible panel
   *  from another stage must never swallow a click meant for the world. */
  interactive?: boolean;
}) {
  const copy = stage.copy[copySet];
  const isLanding = stage.id === 'landing';
  const isDownload = stage.id === 'download';
  const isLaunch = stage.id === 'launch';
  const last = copy.headline.length - 1;
  return (
    <>
      {stage.card && agent ? (
        <div
          ref={cardRef}
          className={
            interactive ? 'pointer-events-auto' : 'pointer-events-none'
          }
        >
          <AgentCard agent={agent} />
        </div>
      ) : null}
      {copy.kicker ? (
        <p className="text-base text-white/55">{copy.kicker}</p>
      ) : null}
      <h2
        className={cn(
          'text-balance font-semibold tracking-tight text-white',
          interactive ? 'pointer-events-auto' : 'pointer-events-none',
          isLanding && 'text-4xl leading-[1.05] md:text-6xl',
          isDownload && 'text-5xl leading-[1.02] md:text-7xl',
          !isLanding && !isDownload && 'text-3xl leading-tight md:text-4xl'
        )}
      >
        {copy.headline.map((line, index) => (
          <span
            key={line}
            className={cn(
              'block',
              isLanding && index < last && 'text-white/50'
            )}
          >
            {line}
          </span>
        ))}
      </h2>
      {copy.body ? (
        <p className="pointer-events-auto max-w-[32rem] text-[17px] leading-relaxed text-white/70">
          {copy.body.map(line => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </p>
      ) : null}
      {isLaunch ? <LaunchComposer /> : null}
      {isLanding ? (
        <DownloadCta align="center" className="pointer-events-auto pt-1" />
      ) : null}
      {isDownload ? (
        <DownloadCta
          size="close"
          align="center"
          className="pointer-events-auto pt-2"
        />
      ) : null}
      {stage.id === 'third' && copySet === 'deck' ? (
        <p className="text-[12px] text-white/40">
          Shown as {STATUS_LABEL.off}: the product has no queued status.
        </p>
      ) : null}
    </>
  );
}

/** The deck's "start a session" band (slide 9), as a lofi composer. */
function LaunchComposer() {
  return (
    <div className="pointer-events-auto mt-2 w-[min(36rem,86vw)] rounded-xl border border-white/12 bg-[#0b1018]/85 p-3 text-left shadow-2xl backdrop-blur-md">
      <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
        <p className="flex-1 text-[15px] text-white/45">
          Plan, build, do anything
        </p>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black">
          ↑
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {LAUNCH_SOURCES.map(source => (
          <span
            key={source}
            className="rounded-full border border-white/12 px-2.5 py-1 text-[12px] text-white/70"
          >
            {source}
          </span>
        ))}
        <span className="rounded-full border border-dashed border-white/20 px-2.5 py-1 text-[12px] text-white/45">
          Approve for me
        </span>
      </div>
    </div>
  );
}
