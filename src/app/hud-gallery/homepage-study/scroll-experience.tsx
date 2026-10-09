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
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import { DownloadCta } from '@/components/site/bands/download-cta';
import { heroBoardTheme } from '@/components/site/hero-board/hero-board-theme';
import { AgentCard } from './agent-card';
import type { CrustMaterialId } from './visuals/crust-materials';
import {
  FLEET_MAX,
  fleetModel,
  STATUS_LABEL,
  type FleetAgent,
} from './fleet-model';
import {
  LAUNCH_SOURCES,
  STAGES,
  stageIndex,
  type CopySetId,
  type Stage,
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

function exemplarFor(
  agents: FleetAgent[],
  count: number,
  status: StoryDrive['highlight']
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
  onExpand,
}: {
  visual: VisualId;
  baseCount: number;
  copySet: CopySetId;
  material: CrustMaterialId;
  marks: boolean;
  onExpand: () => void;
}) {
  const model = useMemo(() => fleetModel(), []);
  const theme = useMemo(() => heroBoardTheme('classic'), []);
  const reducedMotion = usePrefersReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drive = useRef<StoryDrive>({
    progress: 0,
    count: baseCount,
    highlight: null,
    exemplar: -1,
    side: 0,
    recede: 0,
  });
  const anchor = useRef<VisualAnchor>(new VisualAnchor());
  const [stage, setStage] = useState(0);
  const [hoverAgent, setHoverAgent] = useState(-1);
  const [visible, setVisible] = useState(true);

  const fleetAtIndex = stageIndex('fleet');
  const launchIndex = stageIndex('launch');

  // Progress from scroll, written to the drive; stage index into React.
  const sync = useCallback(() => {
    const section = sectionRef.current;
    if (!section) return;
    const rect = section.getBoundingClientRect();
    const viewport = window.innerHeight;
    const travel = Math.max(1, rect.height - viewport);
    const raw = (-rect.top / travel) * (STAGES.length - 1);
    const progress = Math.max(0, Math.min(STAGES.length - 1, raw));
    const d = drive.current;
    d.progress = progress;
    const growth = Math.max(0, Math.min(1, progress - (fleetAtIndex - 1)));
    d.count = Math.round(baseCount + (FLEET_MAX - baseCount) * growth);
    d.recede = Math.max(0, Math.min(1, progress - (launchIndex - 1)));
    const index = Math.round(progress);
    const current = STAGES[index];
    const highlight = current.highlight[copySet] ?? null;
    d.highlight = highlight;
    d.exemplar = current.card
      ? exemplarFor(model.agents, d.count, highlight)
      : -1;
    d.side = current.panel === 'right' ? 1 : current.panel === 'left' ? -1 : 0;
    setStage(previous => (previous === index ? previous : index));
  }, [baseCount, copySet, fleetAtIndex, launchIndex, model]);

  useEffect(() => {
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [sync]);

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
  const hoverRef = useRef<HTMLDivElement>(null);
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
      // labels
      for (let i = 0; i < a.labels.length; i += 1) {
        const el = labelRefs.current[i];
        const label = a.labels[i];
        if (!el) continue;
        if (!label.visible || label.count === 0) {
          el.style.opacity = '0';
          continue;
        }
        el.style.opacity = String(1 - drive.current.recede);
        el.style.transform = `translate(${label.x}px, ${label.y}px) translate(-50%, -100%)`;
        const count = el.querySelector('[data-label-count]');
        if (count) {
          const text = `${label.count} agent${label.count === 1 ? '' : 's'}${label.needsYou ? ` · ${label.needsYou} need you` : ''}`;
          if (count.textContent !== text) count.textContent = text;
        }
      }
      // hover
      const hover = hoverRef.current;
      if (hover) {
        if (a.hoverPoint && a.hover >= 0) {
          hover.style.opacity = '1';
          hover.style.transform = `translate(${a.hoverPoint.x}px, ${a.hoverPoint.y}px) translate(-50%, calc(-100% - 14px))`;
        } else hover.style.opacity = '0';
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const current = STAGES[stage];
  const exemplarAgent =
    drive.current.exemplar >= 0 ? model.agents[drive.current.exemplar] : null;
  const hovered = hoverAgent >= 0 ? model.agents[hoverAgent] : null;

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
          onExpand={onExpand}
          onHoverChange={setHoverAgent}
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
        </svg>

        {/* Hover card. */}
        <div
          ref={hoverRef}
          className="pointer-events-none absolute left-0 top-0 opacity-0 transition-opacity duration-150 will-change-transform"
          aria-hidden
        >
          {hovered ? <AgentCard agent={hovered} compact /> : null}
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
          ? 'left-1/2 top-[9vh] -translate-x-1/2 items-center text-center'
          : 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 items-center text-center';
  return (
    <div
      className={cn(
        'absolute flex max-w-[34rem] flex-col gap-5 transition-opacity duration-500',
        placement,
        active ? 'opacity-100' : 'opacity-0'
      )}
      data-study-panel={stage.id}
      aria-hidden={!active}
    >
      <PanelBody
        stage={stage}
        copySet={copySet}
        agent={agent}
        cardRef={cardRef}
      />
    </div>
  );
}

function PanelBody({
  stage,
  copySet,
  agent,
  cardRef,
}: {
  stage: Stage;
  copySet: CopySetId;
  agent: FleetAgent | null;
  cardRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const copy = stage.copy[copySet];
  const isLanding = stage.id === 'landing';
  const isDownload = stage.id === 'download';
  const isLaunch = stage.id === 'launch';
  const last = copy.headline.length - 1;
  return (
    <>
      {stage.card && agent ? (
        <div ref={cardRef} className="pointer-events-auto">
          <AgentCard agent={agent} />
        </div>
      ) : null}
      {copy.kicker ? (
        <p className="text-base text-white/55">{copy.kicker}</p>
      ) : null}
      <h2
        className={cn(
          'pointer-events-auto text-balance font-semibold tracking-tight text-white',
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
