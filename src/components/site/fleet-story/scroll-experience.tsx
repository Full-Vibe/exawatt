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
 * right or left for the three dissections. On a portrait screen the side
 * panels sit at the foot of the stage over the world, which the camera lifts
 * to clear them (W15f: one pinned experience on every screen, never a
 * stacked copy of itself).
 *
 * One agent card on the page, never two (W15j). On the dissections the card
 * in the reading column shows the agent in focus: the scene's exemplar until
 * the reader picks another. Where that card is not shown (the landing and
 * the fleet, and every scene on a narrow screen) the open agent is the same
 * card pinned to a side of the stage, or a sheet on a phone
 * (`pinned-agent-panel.tsx`). A pick belongs to the scene it was made in; a
 * pinned card closes the moment the camera starts toward another scene, so
 * it never sits over a scene it is not about.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import type { StatusLightState } from '@/components/status-light/protocol';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import { DownloadCta } from '@/components/site/bands/download-cta';
import { GITHUB_URL } from '@/components/site/site-links';
import { GitHubMark } from '@/components/site/github-mark';
import { heroBoardTheme } from '@/components/site/hero-board/hero-board-theme';
import { AgentCard } from './agent-card';
import { StoryCanvas } from './canvas-boundary';
import { fleetModel, STATUS_LABEL, type FleetAgent } from './fleet-model';
import { facingFade, nameShown, nameStyleOf, type NamesId } from './names';
import { isNarrow } from './narrow';
import { PinnedAgentPanel } from './pinned-agent-panel';
import {
  exemplarFor,
  leanCurve,
  panelSide,
  RAIL_DWELL,
  STAGES,
  stageAt,
  stageBlend,
  type CopySetId,
  type Stage,
} from './stages';
import {
  frameCoord,
  frameProgress,
  frameReached,
  pinnedAt,
  progressAt,
  scrollIntent,
  storyTravel,
} from './story-scroll';
import { useSceneScroll, type SnapMode } from './use-scene-scroll';
import {
  VisualAnchor,
  type StoryDrive,
  type VisualProps,
} from './visual-contract';
import type { CrustMarkId } from './visuals/crust-marks';
import type { CrustMaterialId } from './visuals/crust-materials';
import type { CrustMotion } from './visuals/crust-motion';
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
/** How fast the page's own show of a push follows it, per second, and how
 *  much of the next step a whole push fills. */
const PUSH_RATE = 14;
const STEP_PUSH = 0.4;
/** How fast the scene steps follow the scroll, per second: close behind it,
 *  and smooth through a move whose first pixels go by in a blink. */
const STEP_RATE = 16;
/** The reading column follows the scroll (W15l, operator 2026-10-14: "there
 *  isn't really a response under my finger and it feels pretty
 *  disconnected"): a share of the finger's travel, and how far from its
 *  frame, in stages, a scene's column has gone from sight. */
const FOLLOW = 0.7;
const REVEAL_SPAN = 0.45;
/** The scene steps run across the top of a portrait stage; an open sheet
 *  starts below them. */
const STEPS_CLEAR = 32;

export function ScrollExperience({
  Visual,
  copySet,
  material,
  mark,
  shape,
  motion,
  signal,
  light,
  snap,
  sound,
  names,
  insetTop = 0,
}: {
  /** The study's candidate visual; the homepage draws Crust. */
  Visual?: ComponentType<VisualProps>;
  copySet: CopySetId;
  material: CrustMaterialId;
  mark: CrustMarkId;
  shape: CrustShapeId;
  motion: CrustMotion;
  signal: CrustSignalId;
  light: EnvironmentKind;
  /** Off: the browser scrolls. Soft: a glide to the nearest frame when the
   *  scroll stops. Page: one scene per gesture. */
  snap: SnapMode;
  /** Pressing an agent clicks like a key. */
  sound: boolean;
  /** How the Project names are drawn. */
  names: NamesId;
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
  const pxPerProgressRef = useRef(1);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const drive = useRef<StoryDrive>({
    progress: 0,
    base: STAGES[0].count,
    count: STAGES[0].count,
    highlights,
    exemplar: -1,
    selected: -1,
    rate: HAND_RATE,
    rail: 0,
    moving: 0,
    restFrame: 0,
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
  // The agent in focus: the one the reader picked, or on a stage that shows
  // the agent card, the stage's own exemplar. The card always shows the
  // agent in focus and the world rings it, so the card is never about an
  // agent the scene does not point at (operator 2026-10-13: "when I click
  // on an agent to select it, that thing changes to show the selected agent
  // information and does not have duplicate modals on screen at one time").
  const exemplar = STAGES[stage].card
    ? exemplarFor(
        model.agents,
        STAGES[stage].count,
        highlights[stage],
        STAGES[stage].exemplarSource?.[copySet]
      )
    : -1;
  const focused = selected >= 0 ? selected : exemplar;
  useEffect(() => {
    drive.current.selected = focused;
    selectedRef.current = selected;
  }, [focused, selected]);
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
    // the frame the scroll last reached or passed is where a scroll leans
    // from (`scrollIntent`)
    const reached = frameReached(d.progress, progress, STAGES.length - 1);
    if (reached >= 0) d.restFrame = reached;
    d.progress = progress;
    d.highlights = highlights;
    pxPerProgressRef.current =
      travel / Math.max(0.001, STAGES.length - 1 - 2 * RAIL_DWELL);
    const index = stageAt(progress);
    const current = STAGES[index];
    d.count = current.count;
    d.exemplar = current.card
      ? exemplarFor(
          model.agents,
          d.count,
          highlights[index],
          current.exemplarSource?.[copySet]
        )
      : -1;
    stageNow.current = index;
    setStage(previous => (previous === index ? previous : index));
  }, [highlights, model, copySet]);

  useEffect(() => {
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [sync]);

  const goToScene = useSceneScroll({
    mode: snap,
    sectionRef,
    stageRef,
    frames: STAGES.length,
    reducedMotion,
    drive,
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
  const namesRef = useRef<NamesId>(names);
  useEffect(() => {
    namesRef.current = names;
  }, [names]);
  // The scene steps' fills, and the push as the page shows it.
  const stepRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const reducedMotionRef = useRef(reducedMotion);
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);
  useEffect(() => {
    labelTopRef.current = insetTop + 22;
  }, [insetTop]);
  useEffect(() => {
    let frame = 0;
    let push = 0;
    let shownPush = Number.NaN;
    /** The wheel's push as the scene steps show it, and where they show the
     *  story, eased. */
    let stepPush = 0;
    let stepAt = Number.NaN;
    let then = performance.now();
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const a = anchor.current;
      const stageEl = stageRef.current;
      if (!stageEl) return;
      // A push on the wheel before the page moves (W15i): eased here as on
      // the camera, written to the stage for the reading column and the
      // landing's cue, and into the scene steps, where the next step starts
      // to fill.
      const now = performance.now();
      const dt = Math.min(0.05, (now - then) / 1000);
      then = now;
      // the wheel's push before the page moves, and the scroll's way into
      // the hold around the frame it set out from (a finger on glass), as
      // the camera reads them
      const d = drive.current;
      const last = STAGES.length - 1;
      const progress = d.progress;
      const pending = d.intent?.(now) ?? 0;
      const intent = Math.max(
        -1,
        Math.min(1, pending + scrollIntent(progress, d.restFrame, last))
      );
      const pushTarget = Math.sign(intent) * leanCurve(intent);
      // every scene's column follows the scroll and fades as it leaves its
      // frame, so the type moves under the finger and the next scene's
      // comes up after it
      for (let i = 0; i < panelRefs.current.length; i += 1) {
        const panel = panelRefs.current[i];
        if (!panel) continue;
        const away = progress - frameProgress(i, last);
        const r = Math.max(0, 1 - Math.abs(away) / REVEAL_SPAN);
        const reveal = (r * r * (3 - 2 * r)).toFixed(3);
        const follow = reducedMotionRef.current
          ? '0px'
          : `${(-away * pxPerProgressRef.current * FOLLOW).toFixed(1)}px`;
        if (panel.style.getPropertyValue('--reveal') !== reveal)
          panel.style.setProperty('--reveal', reveal);
        if (panel.style.getPropertyValue('--follow') !== follow)
          panel.style.setProperty('--follow', follow);
      }
      push += (pushTarget - push) * (1 - Math.exp(-PUSH_RATE * dt));
      if (Math.abs(push) < 0.002) push = 0;
      if (push !== shownPush) {
        shownPush = push;
        stageEl.style.setProperty('--push', Math.abs(push).toFixed(3));
        stageEl.style.setProperty('--push-signed', push.toFixed(3));
      }
      // one measure of narrow for the steps, the card in the column and the
      // sheet
      const narrow = isNarrow(stageEl.clientWidth, stageEl.clientHeight);
      // The scene steps show the scroll itself (W15o, operator 2026-10-14:
      // "It doesn't just go one direction, expanding or contracting. It
      // actually kind of glitches and moves up and down"): where the page is
      // between two scenes, so a one-way scroll fills them one way. Before
      // a wheel pages, its push starts to fill the next step, held through
      // the move it asks for until the move has filled past it.
      const moving = d.moving;
      const holding = moving !== 0 && Math.sign(stepPush) === moving;
      if (!holding)
        stepPush +=
          (Math.sign(pending) * leanCurve(pending) - stepPush) *
          (1 - Math.exp(-PUSH_RATE * dt));
      if (Math.abs(stepPush) < 0.002) stepPush = 0;
      const coord = frameCoord(progress, last);
      const lean = stepPush * STEP_PUSH;
      const leanTo = Math.max(0, Math.min(last, d.restFrame + lean));
      const stepTarget =
        lean > 0
          ? Math.max(coord, leanTo)
          : lean < 0
            ? Math.min(coord, leanTo)
            : coord;
      if (holding && (moving > 0 ? coord >= leanTo : coord <= leanTo))
        stepPush = 0;
      stepAt =
        Number.isNaN(stepAt) || reducedMotionRef.current
          ? stepTarget
          : stepAt + (stepTarget - stepAt) * (1 - Math.exp(-STEP_RATE * dt));
      for (let i = 0; i < stepRefs.current.length; i += 1) {
        const fill = stepRefs.current[i];
        if (!fill) continue;
        // a phone's bar fills like a story's pages, the scenes behind full;
        // the edge's steps mark the one scene the reader is on
        const f = Math.max(
          0,
          Math.min(1, narrow ? stepAt - i + 1 : 1 - Math.abs(stepAt - i))
        );
        const scale = `scaleX(${f.toFixed(3)})`;
        if (fill.style.transform !== scale) fill.style.transform = scale;
      }
      const labelTop = labelTopRef.current;
      const lb = stageBlend(drive.current.rail, undefined, labelBlend);
      const narrowFlag = narrow ? 'true' : 'false';
      if (stageEl.dataset.narrow !== narrowFlag)
        stageEl.dataset.narrow = narrowFlag;
      // A pinned card closes when the camera starts toward another scene;
      // a pick shown in the column's card stays with its scene and fades
      // with it.
      if (
        selectedRef.current !== -1 &&
        (narrow || !STAGES[stageNow.current].card) &&
        lb.t > MOVING_FROM &&
        lb.t < 1 - MOVING_FROM
      )
        onSelect(-1);
      // names, in the style of the scene the camera is at (it changes at the
      // middle of a move, where `nameShown` has both styles out), faded with
      // the rail; a border's tag also steps aside while the camera moves,
      // with the border the world draws
      const style = nameStyleOf(
        namesRef.current,
        STAGES[lb.t < 0.5 ? lb.from : lb.to],
        narrow
      );
      const still = 1 - 4 * lb.t * (1 - lb.t);
      const shown = style
        ? nameShown(namesRef.current, style, drive.current.rail, narrow) *
          (style === 'border' ? still * still : 1)
        : 0;
      for (let i = 0; i < a.labels.length; i += 1) {
        const el = labelRefs.current[i];
        const label = a.labels[i];
        if (!el) continue;
        const drawn = style ?? '';
        if (el.dataset.style !== drawn) el.dataset.style = drawn;
        const pinned = style !== 'float';
        if (
          shown === 0 ||
          !label.visible ||
          label.count === 0 ||
          (pinned && !label.rimVisible)
        ) {
          el.style.opacity = '0';
          continue;
        }
        // clusters near the limb are seen edge-on and fade out, and a name
        // never goes under the study's own controls
        const x = pinned ? label.rimX : label.x;
        const y = Math.max(pinned ? label.rimY : label.y, labelTop);
        // on a phone an open sheet takes the top of the stage, where a name
        // would show through the glass
        const behindSheet = narrow && selectedRef.current !== -1 ? 0 : 1;
        el.style.opacity = String(
          shown * behindSheet * facingFade(label.facing)
        );
        // a tag hangs from its stem over the border's highest point; a
        // border's name sits on the line itself
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, ${
          style === 'border' ? '-50%' : '-100%'
        })`;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [onSelect]);

  const current = STAGES[stage];
  const focusedAgent = focused >= 0 ? model.agents[focused] : null;
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
      <div
        ref={stageRef}
        className="group/stage sticky top-12 z-10 h-[calc(100svh-3rem)] select-none overflow-hidden bg-[#04060b] [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none]"
        // the study's own controls cover the stage's top; the reading column
        // keeps clear of them (on the homepage there are none)
        style={{ '--inset-top': `${insetTop}px` } as React.CSSProperties}
        data-homepage-study-stage
      >
        <StoryCanvas>
          <VisualCanvas
            Visual={Visual}
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
            sound={sound}
            names={names}
            onHoverChange={onHoverChange}
            onSelect={onSelect}
          />
        </StoryCanvas>

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
              className="group/name absolute left-0 top-0 flex flex-col items-center whitespace-nowrap text-center opacity-0 will-change-transform"
            >
              <ProjectName name={project.name} />
            </div>
          ))}
        </div>

        {/* The selected agent. Click a tile to open it, click it again,
            anywhere else, or press Escape to close it. On a stage with the
            agent card beside the world the card is the selection, so this
            opens only where that card is not shown: on a narrow screen. */}
        <PinnedAgentPanel
          agent={selectedAgent}
          theme={theme}
          anchor={anchor.current}
          column={panelSide(current)}
          insetTop={insetTop + 12}
          insetTopNarrow={insetTop + STEPS_CLEAR}
          narrowOnly={current.card}
          reducedMotion={reducedMotion}
        />

        {/* Where the story is, one step per scene: the current one full, the
            next filling as a push builds or a move runs. A step takes the
            reader to its scene. */}
        <SceneSteps
          stage={stage}
          copySet={copySet}
          fillRefs={stepRefs}
          onStep={index => goToScene.current(index)}
          reducedMotion={reducedMotion}
          insetTop={insetTop}
        />

        {/* The reading column, one panel per stage. */}
        <div className="pointer-events-none absolute inset-0">
          {STAGES.map((item, index) => (
            <Panel
              key={item.id}
              panelRef={el => {
                panelRefs.current[index] = el;
              }}
              stage={item}
              copySet={copySet}
              active={index === stage}
              agent={index === stage ? focusedAgent : null}
              accent={theme.selection}
              reducedMotion={reducedMotion}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The story's steps, one per scene (W15i, operator 2026-10-13: "There's no
 * visibility into that: I'm about to enter an immersive multi-step
 * experience"): down the right edge beside the world, and on a portrait
 * screen, where the world fills the width, a segmented bar across the top
 * of the stage, the way a story on a phone shows its pages. Each step is a
 * short track whose fill is written every frame from where the camera is on
 * the rail, so a move empties one step into the next and a push starts to
 * fill the next before the page moves. A step is a button to its scene.
 */
function SceneSteps({
  stage,
  copySet,
  fillRefs,
  onStep,
  reducedMotion,
  insetTop,
}: {
  stage: number;
  copySet: CopySetId;
  fillRefs: React.RefObject<(HTMLSpanElement | null)[]>;
  onStep: (index: number) => void;
  reducedMotion: boolean;
  insetTop: number;
}) {
  return (
    <nav
      aria-label="Scenes"
      className="pointer-events-auto absolute z-20 flex landscape:right-2 landscape:top-1/2 landscape:-translate-y-1/2 landscape:flex-col landscape:items-end md:landscape:right-4 portrait:inset-x-3 portrait:top-[var(--steps-top)] portrait:flex-row portrait:gap-1"
      style={{ '--steps-top': `${insetTop + 2}px` } as React.CSSProperties}
    >
      {/* below the steps, on the landing only: the invitation to scroll */}
      <div className="absolute right-0 top-full flex w-9 justify-end portrait:hidden">
        <ScrollCue shown={stage === 0} reducedMotion={reducedMotion} />
      </div>
      {/* where the reader is, beside the step it names */}
      <span
        aria-hidden
        className="pointer-events-none absolute right-11 top-0 flex h-7 items-center whitespace-nowrap font-mono text-[10px] tabular-nums tracking-[0.16em] text-white/45 transition-transform duration-500 ease-out portrait:hidden"
        style={{ transform: `translateY(${stage * 28}px)` }}
      >
        {String(stage + 1).padStart(2, '0')} /{' '}
        {String(STAGES.length).padStart(2, '0')}
      </span>
      {/* and for a screen reader, each scene as it arrives */}
      <p className="sr-only" aria-live="polite">
        {`Scene ${stage + 1} of ${STAGES.length}: ${STAGES[stage].copy[copySet].headline.join(' ')}`}
      </p>
      {STAGES.map((item, index) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onStep(index)}
          aria-label={`Scene ${index + 1} of ${STAGES.length}: ${item.copy[copySet].headline.join(' ')}`}
          aria-current={index === stage ? 'step' : undefined}
          className="group/step flex items-center landscape:h-7 landscape:w-9 landscape:justify-end portrait:h-5 portrait:flex-1"
        >
          <span
            className={cn(
              'relative block h-[2px] overflow-hidden rounded-full bg-white/15 transition-[width,background-color] duration-300 group-hover/step:bg-white/30 portrait:w-full',
              index === stage ? 'landscape:w-6' : 'landscape:w-3.5'
            )}
          >
            <span
              ref={el => {
                fillRefs.current[index] = el;
              }}
              className="absolute inset-0 rounded-full bg-white/90 landscape:origin-right portrait:origin-left"
              style={{ transform: 'scaleX(0)' }}
            />
          </span>
        </button>
      ))}
    </nav>
  );
}

/**
 * On the landing, under the steps, an invitation to scroll that answers the
 * scroll: a line with a bead running down it, which fills as a push builds
 * (`--push`). It sits on the edge, clear of the world and the type.
 */
function ScrollCue({
  shown,
  reducedMotion,
}: {
  shown: boolean;
  reducedMotion: boolean;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none mt-3 flex w-6 flex-col items-center gap-2 transition-opacity duration-500',
        shown ? 'opacity-100' : 'opacity-0'
      )}
    >
      <style>{`@keyframes study-cue-bead { 0% { transform: translateY(-4px); opacity: 0 } 25% { opacity: 1 } 80% { opacity: 1 } 100% { transform: translateY(26px); opacity: 0 } }`}</style>
      <span className="relative block h-7 w-px overflow-hidden bg-white/15">
        <span
          className="absolute inset-0 origin-top bg-white/80"
          style={{ transform: 'scaleY(var(--push, 0))' }}
        />
        {reducedMotion ? null : (
          <span
            className="absolute left-1/2 top-0 -ml-[1.5px] block h-[3px] w-[3px] rounded-full bg-white"
            style={{ animation: 'study-cue-bead 1.8s ease-in-out infinite' }}
          />
        )}
      </span>
      <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/45 [writing-mode:vertical-rl]">
        Scroll
      </span>
    </div>
  );
}

/**
 * A Project's name in every style the study draws (`names.ts`); the frame
 * loop says which one shows, from where the camera is, so a style never
 * changes while it can be seen. A tag is a small glass label on a stem whose
 * foot is the Project's border; under Border the same label sits on the
 * outline the globe draws, which passes behind it, so the name reads as the
 * border's own; Float is the name alone.
 */
function ProjectName({ name }: { name: string }) {
  return (
    <>
      <p className="hidden text-[13px] font-medium text-white/85 group-data-[style=float]/name:block">
        {name}
      </p>
      <p className="hidden rounded-full border border-white/20 bg-[#04060b]/70 px-2.5 py-[3px] text-[12.5px] font-medium leading-none text-white/90 shadow-[0_2px_10px_rgba(0,0,0,0.45)] backdrop-blur-[6px] group-data-[style=border]/name:block group-data-[style=tag]/name:block">
        {name}
      </p>
      <span
        aria-hidden
        className="hidden h-3.5 w-px bg-gradient-to-b from-white/45 to-white/10 group-data-[style=tag]/name:block"
      />
    </>
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
  panelRef,
  stage,
  copySet,
  active,
  agent,
  accent,
  reducedMotion,
}: {
  /** The frame loop writes how far this scene's column has followed the
   *  scroll and how much of it shows. */
  panelRef: (el: HTMLDivElement | null) => void;
  stage: Stage;
  copySet: CopySetId;
  active: boolean;
  agent: FleetAgent | null;
  /** The product's selection colour: the card is the agent in focus. */
  accent: string;
  reducedMotion: boolean;
}) {
  // A panel fading out keeps the card it showed rather than emptying.
  const [held, setHeld] = useState<FleetAgent | null>(agent);
  if (agent !== null && agent !== held) setHeld(agent);
  const shown = active ? agent : held;
  // At the foot of a portrait stage, beside the world on a landscape one.
  const placement =
    stage.panel === 'right'
      ? 'inset-x-5 bottom-[max(1.5rem,env(safe-area-inset-bottom))] items-start text-left landscape:inset-x-auto landscape:bottom-auto landscape:right-[6vw] landscape:top-[calc(50%+var(--inset-top,0px)/2)] landscape:-translate-y-1/2'
      : stage.panel === 'left'
        ? 'inset-x-5 bottom-[max(1.5rem,env(safe-area-inset-bottom))] items-start text-left landscape:inset-x-auto landscape:bottom-auto landscape:left-[6vw] landscape:top-[calc(50%+var(--inset-top,0px)/2)] landscape:-translate-y-1/2'
        : 'inset-x-5 top-[14vh] items-center text-center landscape:inset-x-auto landscape:left-1/2 landscape:top-[max(13vh,calc(var(--inset-top,0px)+1.25rem))] landscape:-translate-x-1/2';
  return (
    <div
      ref={panelRef}
      className={cn(
        'absolute flex flex-col gap-4 md:gap-5',
        // The centred headlines are long lines; the rest read in a column. A
        // centred absolute box shrinks to fit half the stage unless it is
        // sized to its content, which wrapped a two-line headline onto three.
        stage.panel === 'center-top'
          ? 'landscape:w-max md:max-w-[min(60rem,92vw)]'
          : 'md:max-w-[34rem]',
        placement,
        // an invisible panel from another stage must never swallow a click
        // meant for the world under it
        !active && '[&_*]:!pointer-events-none',
        // on a portrait screen the open agent's sheet takes the end of the
        // stage the type is not at, unless the agent is there; then the type
        // steps aside, so the sheet is never under it
        stage.panel === 'center-top'
          ? 'portrait:group-data-[sheet=top]/stage:opacity-0 portrait:group-data-[sheet=top]/stage:[&_*]:!pointer-events-none'
          : 'portrait:group-data-[sheet=foot]/stage:opacity-0 portrait:group-data-[sheet=foot]/stage:[&_*]:!pointer-events-none'
      )}
      data-study-panel={stage.id}
      // a scene off screen is out of the tab order and the accessibility
      // tree, not only out of sight: its download and its card's controls
      // must never take focus unseen
      inert={!active}
    >
      {/* the column follows the scroll and gives a little to a push, and
          comes back if the push is let go */}
      <div
        className="flex flex-col gap-4 md:gap-5"
        style={{
          transform:
            'translate3d(0, calc(var(--follow, 0px) + var(--push-signed, 0) * -16px), 0)',
          opacity: `calc(var(--reveal, ${active ? 1 : 0}) * (1 - var(--push, 0) * 0.16))`,
          alignItems: 'inherit',
        }}
      >
        <PanelBody
          stage={stage}
          copySet={copySet}
          agent={shown}
          interactive={active}
          accent={accent}
          reducedMotion={reducedMotion}
        />
      </div>
    </div>
  );
}

function PanelBody({
  stage,
  copySet,
  agent,
  interactive = true,
  accent,
  reducedMotion,
}: {
  stage: Stage;
  copySet: CopySetId;
  agent: FleetAgent | null;
  /** Only the stage on screen may take the pointer. An invisible panel
   *  from another stage must never swallow a click meant for the world. */
  interactive?: boolean;
  accent: string;
  reducedMotion: boolean;
}) {
  const copy = stage.copy[copySet];
  const isLanding = stage.id === 'landing';
  const last = copy.headline.length - 1;
  // the landing's promise is the page's title
  const Heading = isLanding ? 'h1' : 'h2';
  return (
    <>
      {stage.card && agent ? (
        <div
          className={cn(
            'hidden group-data-[narrow=false]/stage:block',
            interactive ? 'pointer-events-auto' : 'pointer-events-none'
          )}
        >
          {/* a new agent in focus settles into the card, it does not cut */}
          <style>{`@keyframes study-card-swap { from { opacity: 0.35; transform: translateY(3px) } to { opacity: 1; transform: none } }`}</style>
          <div
            key={agent.id}
            style={
              reducedMotion
                ? undefined
                : { animation: 'study-card-swap 220ms ease-out' }
            }
          >
            <AgentCard agent={agent} accent={accent} />
          </div>
        </div>
      ) : null}
      {copy.kicker ? (
        <p className="text-base text-white/55">{copy.kicker}</p>
      ) : null}
      <Heading
        className={cn(
          'text-balance font-semibold tracking-tight text-white',
          interactive ? 'pointer-events-auto' : 'pointer-events-none',
          isLanding && 'text-4xl leading-[1.05] md:text-6xl',
          !isLanding && 'text-[1.7rem] leading-tight md:text-4xl'
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
      </Heading>
      {copy.body ? (
        <p
          className={cn(
            'pointer-events-auto max-w-[32rem] text-pretty text-[15px] leading-relaxed text-white/70 md:text-[17px]',
            // on the landing the lines under the title say what it is, each
            // sentence on its own line where the screen allows
            isLanding &&
              'text-balance text-[17px] text-white/75 md:max-w-[44rem] md:text-[21px]'
          )}
        >
          {copy.body.map(line => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </p>
      ) : null}
      {stage.cta ? (
        <>
          <DownloadCta
            align="center"
            requirement={false}
            className="pointer-events-auto pt-1"
          />
          {/* the source, under the download rather than beside it: nothing
              sits beside the button (`download-cta.tsx`) */}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="pointer-events-auto inline-flex items-center gap-2 rounded-md px-2 py-1 text-[14px] font-medium text-white/70 transition-colors hover:text-white"
            data-story-github
          >
            <GitHubMark className="h-4 w-4" />
            View on GitHub
          </a>
        </>
      ) : null}
      {stage.id === 'third' && copySet === 'deck' ? (
        <p className="text-[12px] text-white/40">
          Shown as {STATUS_LABEL.off}: the product has no queued status.
        </p>
      ) : null}
    </>
  );
}
