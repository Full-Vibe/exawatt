'use client';

/**
 * The scroll story over one pinned visual (ENG-031 W15).
 *
 * Native scroll underneath. A tall section, one sticky stage inside it, and
 * a progress number read off `scrollY` (`story-scroll.ts`). The visual reads
 * progress from a ref in `useFrame`; React re-renders only when the stage
 * index changes, which is five times per page, so the page moves at scroll
 * frequency without React in the loop (guide rules 4e, 14). How a gesture
 * becomes a move is `use-scene-scroll.ts`.
 *
 * The reading column is a panel per stage positioned where the deck puts it:
 * centred over the top of the globe on the landing and the fleet, to the
 * right or left for the three dissections, centred for the download. On a
 * portrait screen the same panels sit at the foot of the stage over the
 * world, which the camera lifts to clear them (W15f: one pinned experience on
 * every screen, never a stacked copy of itself).
 *
 * The open agent (W15h) is a panel pinned to a side of the stage
 * (`pinned-agent-panel.tsx`). It belongs to the scene it was opened in: the
 * moment the camera starts toward another scene it closes, so a panel never
 * sits over a scene it is not about.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import type { StatusLightState } from '@/components/status-light/protocol';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import { DownloadCta } from '@/components/site/bands/download-cta';
import { heroBoardTheme } from '@/components/site/hero-board/hero-board-theme';
import { AgentCard } from './agent-card';
import { CanvasBoundary } from './canvas-boundary';
import { fleetModel, STATUS_LABEL, type FleetAgent } from './fleet-model';
import { isNarrow } from './narrow';
import { PinnedAgentPanel } from './pinned-agent-panel';
import {
  panelSide,
  RAIL_DWELL,
  STAGES,
  stageAt,
  stageBlend,
  type CopySetId,
  type Stage,
} from './stages';
import { pinnedAt, PIN_TOP, progressAt, storyTravel } from './story-scroll';
import { useSceneScroll, type SnapMode } from './use-scene-scroll';
import {
  VisualAnchor,
  type StoryDrive,
  type VisualId,
} from './visual-contract';
import type { CrustMarkId } from './visuals/crust-marks';
import type { CrustMaterialId } from './visuals/crust-materials';
import type { CrustMotionId } from './visuals/crust-motion';
import type { CrustShapeId } from './visuals/crust-shape';
import type { CrustSignalId } from './visuals/crust-signal';
import type { EnvironmentKind } from './visuals/environment';

export type { SnapMode } from './use-scene-scroll';

const VisualCanvas = dynamic(
  () => import('./visual-canvas').then(m => m.VisualCanvas),
  {
    ssr: false,
  }
);

const STAGE_SCREENS = 1.0;
/** How fast the rig follows the scroll, per second. A hand on the wheel
 *  wants the scene to ease through its jitter; the study's Page mode is
 *  already a smooth move, so the rig adds almost no lag of its own. */
const HAND_RATE = 4.5;
const PAGED_RATE = 12;
/** The camera counts as under way once its blend is this far from either
 *  end, and the open panel closes. */
const MOVING_FROM = 0.02;
const labelBlend = { from: 0, to: 0, t: 0 };
/** The "synthetic fleet" stamp runs across the top of a portrait stage; an
 *  open sheet starts below it. */
const STAMP_CLEAR = 26;

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
  copySet,
  material,
  mark,
  shape,
  motion,
  signal,
  light,
  snap,
  insetTop = 0,
}: {
  visual: VisualId;
  copySet: CopySetId;
  material: CrustMaterialId;
  mark: CrustMarkId;
  shape: CrustShapeId;
  motion: CrustMotionId;
  signal: CrustSignalId;
  light: EnvironmentKind;
  /** Off: the browser scrolls. Soft: a glide to the nearest frame when the
   *  scroll stops near one. Page: one scene per gesture. */
  snap: SnapMode;
  /** Pixels of the stage's top covered by the study's own controls. */
  insetTop?: number;
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
    base: STAGES[0].count,
    count: STAGES[0].count,
    highlights,
    exemplar: -1,
    selected: -1,
    rate: HAND_RATE,
    rail: 0,
    recede: 0,
  });
  const anchor = useRef<VisualAnchor>(new VisualAnchor());
  const [stage, setStage] = useState(0);
  const [visible, setVisible] = useState(true);

  // The open agent belongs to the stage it was opened in.
  const stageNow = useRef(0);
  const [selection, setSelection] = useState({ agent: -1, stage: 0 });
  const selectedId = selection.stage === stage ? selection.agent : -1;
  const selected =
    selectedId >= 0 && selectedId < STAGES[stage].count ? selectedId : -1;
  const selectedRef = useRef(-1);
  const onHoverChange = useCallback(() => {}, []);
  // A click on the open agent closes it; a click on another opens that one;
  // a click on nothing closes it.
  const onSelect = useCallback((agent: number) => {
    const where = stageNow.current;
    setSelection(previous => {
      const current = previous.stage === where ? previous.agent : -1;
      const next = agent === current ? -1 : agent;
      return next === current && previous.stage === where
        ? previous
        : { agent: next, stage: where };
    });
  }, []);
  useEffect(() => {
    drive.current.selected = selected;
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    drive.current.rate = snap === 'page' ? PAGED_RATE : HAND_RATE;
  }, [snap]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSelect(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelect]);

  // Progress from scroll, written to the drive; stage index into React.
  const sync = useCallback(() => {
    const section = sectionRef.current;
    if (!section) return;
    const rect = section.getBoundingClientRect();
    // Progress is pinned travel: zero the moment the stage pins under the
    // header, one the moment it unpins, mapped from the end of the landing
    // dwell to the start of the last dwell so every pixel of scroll moves
    // the scene (operator 2026-10-09: "it absorbs some of the scroll before
    // it starts updating the scene").
    const stageHeight = stageRef.current?.offsetHeight ?? window.innerHeight;
    const travel = storyTravel(rect.height, stageHeight);
    const progress = progressAt(
      pinnedAt(rect.top, travel),
      travel,
      STAGES.length - 1
    );
    const d = drive.current;
    d.progress = progress;
    d.highlights = highlights;
    const index = stageAt(progress);
    const current = STAGES[index];
    d.count = current.count;
    d.exemplar = current.card
      ? exemplarFor(model.agents, d.count, highlights[index])
      : -1;
    stageNow.current = index;
    setStage(previous => (previous === index ? previous : index));
  }, [highlights, model]);

  useEffect(() => {
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [sync]);

  useSceneScroll({
    mode: snap,
    sectionRef,
    stageRef,
    frames: STAGES.length,
    reducedMotion,
  });

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

  // Overlay: the Project names, written each frame from refs, and the one
  // thing that must not wait for React: the open panel closing the moment
  // the camera starts toward another scene.
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const labelTopRef = useRef(0);
  useEffect(() => {
    labelTopRef.current = insetTop + 22;
  }, [insetTop]);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const a = anchor.current;
      const stageEl = stageRef.current;
      if (!stageEl) return;
      const labelTop = labelTopRef.current;
      const lb = stageBlend(drive.current.rail, undefined, labelBlend);
      if (
        selectedRef.current !== -1 &&
        lb.t > MOVING_FROM &&
        lb.t < 1 - MOVING_FROM
      )
        onSelect(-1);
      // labels, faded with the stage on the rail; a narrow screen has no
      // room for ten names over the whole fleet, so there they show only
      // while the story is inside one Project
      const narrow = isNarrow(stageEl.clientWidth, stageEl.clientHeight);
      const labelled = (index: number) =>
        STAGES[index].labels && !(narrow && STAGES[index].focus === 'fleet');
      const labelsOn =
        (labelled(lb.from) ? 1 - lb.t : 0) + (labelled(lb.to) ? lb.t : 0);
      for (let i = 0; i < a.labels.length; i += 1) {
        const el = labelRefs.current[i];
        const label = a.labels[i];
        if (!el) continue;
        if (!label.visible || label.count === 0) {
          el.style.opacity = '0';
          continue;
        }
        // clusters near the limb are seen edge-on and fade out, and a name
        // never goes under the study's own controls
        const facing = Math.min(1, Math.max(0, (label.facing - 0.22) / 0.3));
        const y = Math.max(label.y, labelTop);
        // on a phone an open sheet takes the top of the stage, where a name
        // would show through the glass
        const behindSheet = narrow && selectedRef.current !== -1 ? 0 : 1;
        el.style.opacity = String(
          labelsOn *
            (1 - drive.current.recede) *
            behindSheet *
            facing *
            facing *
            (3 - 2 * facing)
        );
        el.style.transform = `translate(${label.x}px, ${y}px) translate(-50%, -100%)`;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [onSelect]);

  const current = STAGES[stage];
  const exemplarAgent =
    drive.current.exemplar >= 0 ? model.agents[drive.current.exemplar] : null;
  const selectedAgent = selected >= 0 ? model.agents[selected] : null;
  const last = STAGES.length - 1;

  return (
    <section
      ref={sectionRef}
      className="relative"
      style={{ height: `${STAGES.length * STAGE_SCREENS * 100}svh` }}
      data-homepage-study-experience
      data-stage={current.id}
    >
      {/* One snap point per frame, for a touch screen under Page. */}
      {snap === 'page'
        ? STAGES.map((item, index) => {
            // the frame's pinned travel as a share of the whole, laid out in
            // the section's own units: travel is the section less one stage
            // (100svh less the 3rem header)
            const share = Math.min(
              1,
              Math.max(0, (index - RAIL_DWELL) / (last - 2 * RAIL_DWELL))
            );
            return (
              <div
                key={item.id}
                aria-hidden
                className="pointer-events-none absolute left-0 h-px w-px"
                style={{
                  top: `calc(${share * 100}% - ${share * 100}svh + ${share * 3}rem)`,
                  scrollSnapAlign: 'start',
                  scrollSnapStop: 'always',
                  scrollMarginTop: `${PIN_TOP}px`,
                }}
              />
            );
          })
        : null}
      <div
        ref={stageRef}
        className="group/stage sticky top-12 z-10 h-[calc(100svh-3rem)] overflow-hidden bg-[#04060b]"
        data-homepage-study-stage
      >
        <CanvasBoundary>
          <VisualCanvas
            visual={visual}
            model={model}
            theme={theme}
            drive={drive}
            anchor={anchor.current}
            reducedMotion={reducedMotion}
            visible={visible}
            material={material}
            mark={mark}
            shape={shape}
            motion={motion}
            signal={signal}
            light={light}
            onHoverChange={onHoverChange}
            onSelect={onSelect}
          />
        </CanvasBoundary>

        {/* A soft dark wash behind the reading column on its side, under the
            names and the type, so type stays legible over tile art. */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {STAGES.map((item, index) => (
            <Scrim key={item.id} stage={item} active={index === stage} />
          ))}
        </div>

        {/* Project names, positioned from the visual. */}
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
            </div>
          ))}
        </div>

        {/* The selected agent. Click a tile to open it, click it again,
            anywhere else, or press Escape to close it. */}
        <PinnedAgentPanel
          agent={selectedAgent}
          theme={theme}
          anchor={anchor.current}
          column={panelSide(current)}
          insetTop={insetTop + 12}
          insetTopNarrow={insetTop + 12 + STAMP_CLEAR}
          reducedMotion={reducedMotion}
        />

        {/* Synthetic fleet stamp, always inside the frame. */}
        <p className="pointer-events-none absolute right-4 top-[3.25rem] font-mono text-[10px] uppercase tracking-[0.18em] text-white/35 landscape:bottom-3 landscape:left-4 landscape:right-auto landscape:top-auto">
          Demo workspace · synthetic fleet
        </p>

        {/* The reading column, one panel per stage. */}
        <div className="pointer-events-none absolute inset-0">
          {STAGES.map((item, index) => (
            <Panel
              key={item.id}
              stage={item}
              copySet={copySet}
              active={index === stage}
              agent={index === stage ? exemplarAgent : null}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * A dark wash behind the reading column on the stages where it sits beside
 * the world, so white type is never set over bright tiles (operator
 * 2026-10-13, on a stage where the copy ran across a cluster). It fades with
 * the stage and takes no pointer. The centred stages need none: their ground
 * is already the dark of the page.
 */
function Scrim({ stage, active }: { stage: Stage; active: boolean }) {
  if (stage.panel !== 'right' && stage.panel !== 'left') return null;
  const side =
    stage.panel === 'right'
      ? 'landscape:inset-y-0 landscape:left-auto landscape:right-0 landscape:h-auto landscape:w-[min(46rem,64vw)] landscape:bg-gradient-to-l'
      : 'landscape:inset-y-0 landscape:left-0 landscape:right-auto landscape:h-auto landscape:w-[min(46rem,64vw)] landscape:bg-gradient-to-r';
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 h-[64%] bg-gradient-to-t from-[#04060b]/90 via-[#04060b]/55 to-transparent transition-opacity duration-500',
        side,
        'landscape:from-[#04060b]/80 landscape:via-[#04060b]/45',
        active ? 'opacity-100' : 'opacity-0'
      )}
    />
  );
}

function Panel({
  stage,
  copySet,
  active,
  agent,
}: {
  stage: Stage;
  copySet: CopySetId;
  active: boolean;
  agent: FleetAgent | null;
}) {
  // At the foot of a portrait stage, beside the world on a landscape one.
  const placement =
    stage.panel === 'right'
      ? 'inset-x-5 bottom-[max(1.5rem,env(safe-area-inset-bottom))] items-start text-left landscape:inset-x-auto landscape:bottom-auto landscape:right-[6vw] landscape:top-1/2 landscape:-translate-y-1/2'
      : stage.panel === 'left'
        ? 'inset-x-5 bottom-[max(1.5rem,env(safe-area-inset-bottom))] items-start text-left landscape:inset-x-auto landscape:bottom-auto landscape:left-[6vw] landscape:top-1/2 landscape:-translate-y-1/2'
        : stage.panel === 'center-top'
          ? 'inset-x-5 top-[14vh] items-center text-center landscape:inset-x-auto landscape:left-1/2 landscape:top-[13vh] landscape:-translate-x-1/2'
          : 'inset-x-5 top-1/2 -translate-y-1/2 items-center text-center landscape:inset-x-auto landscape:left-1/2 landscape:-translate-x-1/2';
  return (
    <div
      className={cn(
        'absolute flex flex-col gap-4 transition-opacity duration-500 md:gap-5',
        // The landing's headline is two long lines; the rest read in a column.
        // A centred absolute box shrinks to fit half the stage unless it is
        // sized to its content, which is what wrapped "Tomorrow you will run
        // 10,000." onto a third line.
        stage.panel === 'center-top'
          ? 'landscape:w-max md:max-w-[min(60rem,92vw)]'
          : 'md:max-w-[34rem]',
        placement,
        // an invisible panel from another stage must never swallow a click
        // meant for the world under it
        active ? 'opacity-100' : 'opacity-0 [&_*]:!pointer-events-none',
        // on a portrait screen the open agent's sheet sometimes takes the
        // foot of the stage, where the type is, and then the type steps aside
        'portrait:group-data-[sheet=foot]/stage:opacity-0 portrait:group-data-[sheet=foot]/stage:[&_*]:!pointer-events-none'
      )}
      data-study-panel={stage.id}
      aria-hidden={!active}
    >
      <PanelBody
        stage={stage}
        copySet={copySet}
        agent={agent}
        interactive={active}
      />
    </div>
  );
}

function PanelBody({
  stage,
  copySet,
  agent,
  interactive = true,
}: {
  stage: Stage;
  copySet: CopySetId;
  agent: FleetAgent | null;
  /** Only the stage on screen may take the pointer. An invisible panel
   *  from another stage must never swallow a click meant for the world. */
  interactive?: boolean;
}) {
  const copy = stage.copy[copySet];
  const isLanding = stage.id === 'landing';
  const isDownload = stage.id === 'download';
  const last = copy.headline.length - 1;
  return (
    <>
      {stage.card && agent ? (
        <div
          className={cn(
            'hidden landscape:block',
            interactive ? 'pointer-events-auto' : 'pointer-events-none'
          )}
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
          isDownload && 'text-4xl leading-[1.02] md:text-7xl',
          !isLanding && !isDownload && 'text-[1.7rem] leading-tight md:text-4xl'
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
        <p className="pointer-events-auto max-w-[32rem] text-pretty text-[15px] leading-relaxed text-white/70 md:text-[17px]">
          {copy.body.map(line => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </p>
      ) : null}
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
