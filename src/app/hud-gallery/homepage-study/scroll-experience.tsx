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
 * the download. The three dissections carry the agent card on the agent the
 * stage lifts. On a narrow screen the same panels sit at the foot of the
 * stage over the world, which the camera lifts to clear them (W15f: one
 * pinned experience on every screen, never a stacked copy of itself).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import type { StatusLightState } from '@/components/status-light/protocol';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import { DownloadCta } from '@/components/site/bands/download-cta';
import { heroBoardTheme } from '@/components/site/hero-board/hero-board-theme';
import { SourceGlyph } from '@/components/workspace/harness-icons';
import { AgentCard } from './agent-card';
import { AgentPanel } from './agent-panel';
import type { CrustMarkId } from './visuals/crust-marks';
import type { CrustMaterialId } from './visuals/crust-materials';
import type { CrustMotionId } from './visuals/crust-motion';
import type { CrustShapeId } from './visuals/crust-shape';
import type { CrustSignalId } from './visuals/crust-signal';
import type { EnvironmentKind } from './visuals/environment';

export type SnapMode = 'off' | 'soft' | 'page';
import {
  fleetModel,
  sourceAdapterId,
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
/** The open panel's distance from the tile's top point, and how long its
 *  arrival takes. It appears where the tile is; it never travels there. */
const PANEL_GAP = 18;
const PANEL_POP_MS = 160;
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
  copySet,
  material,
  mark,
  shape,
  motion,
  signal,
  light,
  snap,
}: {
  visual: VisualId;
  copySet: CopySetId;
  material: CrustMaterialId;
  mark: CrustMarkId;
  shape: CrustShapeId;
  motion: CrustMotionId;
  signal: CrustSignalId;
  light: EnvironmentKind;
  /** Off: park anywhere. Soft: a pull to the nearest frame when the scroll
   *  stops near one. Page: one scene per gesture (W15g, operator
   *  2026-10-13: a larger scroll "goes quickly through several scroll
   *  scenes and feels like it jumps around. it should land me in one
   *  scene at a time"). */
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
    base: STAGES[0].count,
    count: STAGES[0].count,
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
  const onHoverChange = useCallback(() => {}, []);
  const onSelect = useCallback((agent: number) => {
    setSelected(previous => (previous === agent ? previous : agent));
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
    d.highlights = highlights;
    const index = stageAt(progress);
    const current = STAGES[index];
    d.count = current.count;
    d.exemplar = current.card
      ? exemplarFor(model.agents, d.count, highlights[index])
      : -1;
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

  // Page: one scene per gesture. A wheel gesture inside the story is taken
  // over and turned into one eased move to the next frame; its momentum
  // tail is ignored until it dies or a new gesture rises over it. Keys
  // page too. Touch gets the browser's own snap points (below), one per
  // frame, which is the nearest a flick can be held to one scene.
  useEffect(() => {
    if (snap !== 'page') return;
    const section = sectionRef.current;
    const stageEl = stageRef.current;
    if (!section || !stageEl) return;
    const last = STAGES.length - 1;
    let animating = false;
    /** A second gesture that rose while a move was under way: taken as
     *  soon as the move lands, so two quick flicks are two scenes. */
    let queued = 0;
    /** The gesture under way: its loudest event so far, and whether its
     *  tail has fallen off that peak. A trackpad flick rises to a peak and
     *  decays; only after the decay can a rising event be a new flick. */
    let peak = 0;
    let decayed = true;
    let lastAbs = 0;
    let lastTime = 0;
    let frame = 0;
    const travel = () =>
      Math.max(
        1,
        section.getBoundingClientRect().height - stageEl.offsetHeight
      );
    const frameTop = (index: number) => {
      const rect = section.getBoundingClientRect();
      const t = travel();
      const pinned = Math.max(
        0,
        Math.min(t, ((index - RAIL_DWELL) / (last - 2 * RAIL_DWELL)) * t)
      );
      return rect.top + window.scrollY + pinned - PIN_TOP;
    };
    const inStory = () => {
      const pinned = PIN_TOP - section.getBoundingClientRect().top;
      return pinned >= -1 && pinned <= travel() + 1;
    };
    const go = (index: number) => {
      const top = frameTop(index);
      const from = window.scrollY;
      if (Math.abs(top - from) < 2) return;
      animating = true;
      const start = performance.now();
      const duration = 680;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        window.scrollTo(0, from + (top - from) * eased);
        if (t < 1) frame = requestAnimationFrame(step);
        else {
          animating = false;
          if (queued !== 0) {
            const next = queued;
            queued = 0;
            go(Math.max(0, Math.min(last, index + next)));
          }
        }
      };
      frame = requestAnimationFrame(step);
    };
    const current = () =>
      Math.max(0, Math.min(last, Math.round(drive.current.progress)));
    const onWheel = (e: WheelEvent) => {
      if (!inStory()) return;
      const direction = Math.sign(e.deltaY);
      if (direction === 0) return;
      const at = current();
      // at either end the page carries on out of the story natively
      if (
        !animating &&
        direction > 0 &&
        at >= last &&
        drive.current.progress >= last - 0.01
      )
        return;
      if (
        !animating &&
        direction < 0 &&
        at <= 0 &&
        drive.current.progress <= 0.01
      )
        return;
      e.preventDefault();
      const now = performance.now();
      const abs = Math.abs(e.deltaY);
      const silent = now - lastTime > 350;
      const rising = abs > lastAbs * 1.4;
      lastTime = now;
      lastAbs = abs;
      if (silent) {
        peak = 0;
        decayed = true;
      }
      peak = Math.max(peak, abs);
      if (abs < peak * 0.5) decayed = true;
      // a new gesture: silence before it, or a rise after the last one's
      // tail has fallen off its peak
      if (!(silent || (decayed && rising)) || abs < 4) return;
      peak = abs;
      decayed = false;
      if (animating) {
        queued = direction;
        return;
      }
      go(Math.max(0, Math.min(last, at + direction)));
    };
    const onKey = (e: KeyboardEvent) => {
      if (!inStory()) return;
      const direction =
        e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' '
          ? 1
          : e.key === 'ArrowUp' || e.key === 'PageUp'
            ? -1
            : 0;
      if (direction === 0 || animating) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      e.preventDefault();
      go(Math.max(0, Math.min(last, current() + direction)));
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    const root = document.documentElement;
    const previousSnap = root.style.scrollSnapType;
    root.style.scrollSnapType = 'y proximity';
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      root.style.scrollSnapType = previousSnap;
    };
  }, [snap]);

  // Snap: when the scroll stops, pull to the nearest composed frame.
  useEffect(() => {
    if (snap !== 'soft') return;
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
      if (away < 0.01 || away > 0.3) return;
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

  // Overlay: labels and the open panel, written each frame from refs.
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const focusRef = useRef<HTMLDivElement>(null);
  const openedAt = useRef(-1);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const a = anchor.current;
      const stageEl = stageRef.current;
      if (!stageEl) return;
      // labels, faded with the stage on the rail; a narrow screen has no
      // room for ten names over the whole fleet, so there they show only
      // while the story is inside one Project
      const stageRect = stageEl.getBoundingClientRect();
      const narrow = stageRect.width < stageRect.height;
      const lb = stageBlend(drive.current.rail, undefined, labelBlend);
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
        el.style.opacity = String(labelsOn * (1 - drive.current.recede));
        el.style.transform = `translate(${label.x}px, ${label.y}px) translate(-50%, -100%)`;
      }
      // The open agent: a panel beside its tile, on the side with room. It
      // is placed every frame, so it stands where the tile is as the world
      // moves, and it pops in rather than sliding over from wherever it
      // last was (operator 2026-10-12: "it slowly translates to position").
      const focus = focusRef.current;
      if (focus) {
        if (a.focusPoint && a.focus >= 0) {
          const now = performance.now();
          if (openedAt.current < 0) openedAt.current = now;
          const pop = Math.min(1, (now - openedAt.current) / PANEL_POP_MS);
          const ease = 1 - (1 - pop) * (1 - pop);
          const fx = a.focusPoint.x;
          const fy = a.focusPoint.y;
          const toLeft = fx > stageRect.width * 0.62;
          const scale = 0.94 + 0.06 * ease;
          focus.style.opacity = String(ease);
          focus.style.pointerEvents = 'auto';
          // On a narrow screen the panel stands over the tile, or under it
          // when the tile is near the top, always inside the frame.
          const narrowX = Math.min(Math.max(fx, 128), stageRect.width - 128);
          const below = fy < stageRect.height * 0.45;
          focus.style.transform = narrow
            ? below
              ? `translate(${narrowX}px, ${fy + PANEL_GAP + 8}px) translate(-50%, 0) scale(${scale})`
              : `translate(${narrowX}px, ${fy - PANEL_GAP}px) translate(-50%, -100%) scale(${scale})`
            : toLeft
              ? `translate(${fx - PANEL_GAP}px, ${fy}px) translate(-100%, -50%) scale(${scale})`
              : `translate(${fx + PANEL_GAP}px, ${fy}px) translate(0, -50%) scale(${scale})`;
        } else {
          openedAt.current = -1;
          focus.style.opacity = '0';
          focus.style.pointerEvents = 'none';
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
      {/* One snap point per frame, for touch under Page. */}
      {snap === 'page'
        ? STAGES.map((item, index) => {
            // the frame's pinned travel as a share of the whole, laid out
            // in the section's own units: travel is the section less one
            // stage (100svh less the 3rem header)
            const share = Math.max(
              0,
              (index - RAIL_DWELL) / (STAGES.length - 1 - 2 * RAIL_DWELL)
            );
            return (
              <div
                key={item.id}
                aria-hidden
                className="pointer-events-none absolute left-0 h-px w-px"
                style={{
                  top: `calc(${share * 100}% - ${share * 100}svh + ${share * 3}rem)`,
                  scrollSnapAlign: 'start',
                  scrollMarginTop: `${PIN_TOP}px`,
                }}
              />
            );
          })
        : null}
      <div
        ref={stageRef}
        className="sticky top-12 z-10 h-[calc(100svh-3rem)] overflow-hidden bg-[#04060b]"
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
          mark={mark}
          shape={shape}
          motion={motion}
          signal={signal}
          light={light}
          onHoverChange={onHoverChange}
          onSelect={onSelect}
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
            </div>
          ))}
        </div>

        {/* The selected agent. Click a tile to open it, anywhere else or
            Escape to close. */}
        <div
          ref={focusRef}
          className="absolute left-0 top-0 opacity-0 will-change-transform"
          onPointerDown={e => e.stopPropagation()}
          onPointerUp={e => e.stopPropagation()}
        >
          {selectedAgent ? (
            <AgentPanel agent={selectedAgent} theme={theme} />
          ) : null}
        </div>

        {/* Synthetic fleet stamp, always inside the frame. */}
        <p className="pointer-events-none absolute right-4 top-[3.25rem] font-mono text-[10px] uppercase tracking-[0.18em] text-white/35 md:bottom-3 md:left-4 md:right-auto md:top-auto">
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
  // Beside the world on a wide screen; at its foot on a narrow one.
  const placement =
    stage.panel === 'right'
      ? 'inset-x-5 bottom-[max(1.5rem,env(safe-area-inset-bottom))] items-start text-left md:inset-x-auto md:bottom-auto md:right-[6vw] md:top-1/2 md:-translate-y-1/2'
      : stage.panel === 'left'
        ? 'inset-x-5 bottom-[max(1.5rem,env(safe-area-inset-bottom))] items-start text-left md:inset-x-auto md:bottom-auto md:left-[6vw] md:top-1/2 md:-translate-y-1/2'
        : stage.panel === 'center-top'
          ? 'inset-x-5 top-[14vh] items-center text-center md:inset-x-auto md:left-1/2 md:top-[13vh] md:-translate-x-1/2'
          : 'inset-x-5 top-1/2 -translate-y-1/2 items-center text-center md:inset-x-auto md:left-1/2 md:-translate-x-1/2';
  return (
    <div
      className={cn(
        'absolute flex flex-col gap-4 transition-opacity duration-500 md:max-w-[34rem] md:gap-5',
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
  const isLaunch = stage.id === 'launch';
  const last = copy.headline.length - 1;
  return (
    <>
      {stage.card && agent ? (
        <div
          className={cn(
            'hidden md:block',
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
        <p className="pointer-events-auto max-w-[32rem] text-[15px] leading-relaxed text-white/70 md:text-[17px]">
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

/** The deck's "start a session" band (slide 9), as a lofi composer. The
 *  harnesses are their marks. */
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
            className="flex items-center gap-1.5 rounded-full border border-white/12 px-2.5 py-1 text-[12px] text-white/70"
          >
            <SourceGlyph source={sourceAdapterId(source)} size={12} />
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
