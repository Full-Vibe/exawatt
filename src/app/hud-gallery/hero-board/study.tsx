'use client';

/**
 * Hero board idle study (ENG-031 W2).
 *
 * Three idle behaviours over ONE real capture of the Demo Workspace, switchable
 * and side by side, each measuring its own idle motion live so the operator can
 * see the budget being met rather than being told it was.
 *
 * Nothing here is wired into the production homepage. The operator picks; the
 * winner ships in W3.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { RootState } from '@react-three/fiber';
import {
  HeroBoard,
  type HeroBoardMode,
} from '@/components/site/hero-board/hero-board';
import { HERO_BOARD_CAPTURE } from '@/components/site/hero-board/capture';
import {
  HERO_IDLE_OPTIONS,
  IDLE_BUDGET,
  type HeroIdleOptionId,
} from '@/components/site/hero-board/idle-options';
import {
  HERO_THEMES,
  type HeroThemeKey,
} from '@/components/site/hero-board/hero-board-theme';
import {
  compareFrames,
  gradeIdleDelta,
  sampleCanvas,
  type IdleFrameDelta,
} from '@/components/site/hero-board/idle-measure';

type StageId = HeroIdleOptionId | 'compare';
type ForceMode = 'auto' | 'frozen' | 'poster';

interface StudyState {
  stage: StageId;
  theme: HeroThemeKey;
  force: ForceMode;
  protocol: boolean;
  changes: boolean;
}

const DEFAULTS: StudyState = {
  stage: 'planted',
  theme: 'classic',
  force: 'auto',
  protocol: true,
  changes: true,
};

const STAGES: { id: StageId; label: string }[] = [
  { id: 'planted', label: '1 Planted' },
  { id: 'scroll', label: '2 Scroll' },
  { id: 'orbit', label: '3 Orbit' },
  { id: 'compare', label: 'Side by side' },
];

function readState(search: string): StudyState {
  const params = new URLSearchParams(search);
  const stage = params.get('stage');
  const theme = params.get('theme');
  const force = params.get('force');
  return {
    stage: STAGES.some(entry => entry.id === stage)
      ? (stage as StageId)
      : DEFAULTS.stage,
    theme:
      theme && theme in HERO_THEMES ? (theme as HeroThemeKey) : DEFAULTS.theme,
    force:
      force === 'frozen' || force === 'poster' ? (force as ForceMode) : 'auto',
    protocol: params.get('protocol') !== '0',
    changes: params.get('changes') !== '0',
  };
}

function href(state: StudyState, patch: Partial<StudyState>): string {
  const next = { ...state, ...patch };
  const params = new URLSearchParams({
    stage: next.stage,
    theme: next.theme,
    force: next.force,
    protocol: next.protocol ? '1' : '0',
    changes: next.changes ? '1' : '0',
  });
  return `/hud-gallery/hero-board?${params.toString()}`;
}

/* ------------------------------------------------------------------ */
/* measurement                                                         */
/* ------------------------------------------------------------------ */

interface BoardMetrics {
  delta: IdleFrameDelta | null;
  drawCalls: number;
  dpr: number;
  framesPerSecond: number;
  samples: number;
}

const EMPTY_METRICS: BoardMetrics = {
  delta: null,
  drawCalls: 0,
  dpr: 0,
  framesPerSecond: 0,
  samples: 0,
};

/** One sample a second: the budget is stated per second, so it is measured per
 *  second. The rolling mean over the last five keeps a single status change
 *  from reading as a trend. */
function useBoardMetrics(
  root: RootState | null,
  enabled: boolean
): BoardMetrics {
  const [metrics, setMetrics] = useState<BoardMetrics>(EMPTY_METRICS);
  useEffect(() => {
    if (!root || !enabled) {
      setMetrics(EMPTY_METRICS);
      return;
    }
    const scratch = document.createElement('canvas');
    const window_: number[] = [];
    const shares: number[] = [];
    let previous: Uint8ClampedArray | null = null;
    let lastFrame = root.gl.info.render.frame;
    let samples = 0;
    const timer = globalThis.setInterval(() => {
      const sample = sampleCanvas(root.gl.domElement, scratch);
      const frame = root.gl.info.render.frame;
      const framesPerSecond = Math.max(0, frame - lastFrame);
      lastFrame = frame;
      if (sample && previous) {
        const delta = compareFrames(previous, sample);
        window_.push(delta.meanChannelDelta);
        shares.push(delta.changedPixelShare);
        if (window_.length > 5) window_.shift();
        if (shares.length > 5) shares.shift();
        samples += 1;
        setMetrics({
          delta: {
            ...delta,
            meanChannelDelta:
              window_.reduce((sum, value) => sum + value, 0) / window_.length,
            changedPixelShare:
              shares.reduce((sum, value) => sum + value, 0) / shares.length,
          },
          drawCalls: root.gl.info.render.calls,
          dpr: root.gl.getPixelRatio(),
          framesPerSecond,
          samples,
        });
      }
      previous = sample;
    }, 1000);
    return () => globalThis.clearInterval(timer);
  }, [root, enabled]);
  return metrics;
}

function Readout({
  metrics,
  mode,
  compact,
}: {
  metrics: BoardMetrics;
  mode: HeroBoardMode;
  compact: boolean;
}) {
  const verdict = metrics.delta
    ? gradeIdleDelta(metrics.delta, IDLE_BUDGET)
    : null;
  const drawCallsOk = metrics.drawCalls <= IDLE_BUDGET.maxDrawCalls;
  const dprOk = metrics.dpr <= IDLE_BUDGET.maxDpr;
  return (
    <dl
      className={`grid gap-x-4 gap-y-2 ${
        compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
      }`}
      data-hero-readout
      data-hero-readout-samples={metrics.samples}
    >
      <Metric
        label="Mean Δ / channel"
        value={metrics.delta ? metrics.delta.meanChannelDelta.toFixed(2) : '—'}
        budget={`< ${IDLE_BUDGET.meanChannelDelta}`}
        ok={verdict?.meanOk ?? null}
        testId="mean-delta"
      />
      <Metric
        label="Pixels changed / s"
        value={
          metrics.delta
            ? `${(metrics.delta.changedPixelShare * 100).toFixed(2)}%`
            : '—'
        }
        budget={`< ${IDLE_BUDGET.changedPixelShare * 100}%`}
        ok={verdict?.shareOk ?? null}
        testId="changed-share"
      />
      <Metric
        label="Draw calls"
        value={metrics.drawCalls ? String(metrics.drawCalls) : '—'}
        budget={`≤ ${IDLE_BUDGET.maxDrawCalls}`}
        ok={metrics.drawCalls ? drawCallsOk : null}
        testId="draw-calls"
      />
      <Metric
        label="Device pixel ratio"
        value={metrics.dpr ? metrics.dpr.toFixed(2) : '—'}
        budget={`≤ ${IDLE_BUDGET.maxDpr}`}
        ok={metrics.dpr ? dprOk : null}
        testId="dpr"
      />
      <Metric
        label="Frames / s"
        value={metrics.samples ? String(metrics.framesPerSecond) : '—'}
        budget="0 when parked"
        ok={null}
        testId="fps"
      />
      <Metric
        label="Canvases"
        value={mode === 'live' ? '1' : '0'}
        budget="0 when reduced"
        ok={null}
        testId="canvas-count"
      />
    </dl>
  );
}

function Metric({
  label,
  value,
  budget,
  ok,
  testId,
}: {
  label: string;
  value: string;
  budget: string;
  ok: boolean | null;
  testId: string;
}) {
  return (
    <div
      className="flex flex-col gap-0.5"
      data-metric={testId}
      data-metric-ok={ok === null ? 'pending' : ok ? 'true' : 'false'}
    >
      <dt className="font-mono text-chrome-micro uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`font-mono text-chrome-title tabular-nums ${
          ok === false ? 'text-destructive' : 'text-foreground'
        }`}
      >
        {value}
        <span className="ml-1.5 text-chrome-micro text-muted-foreground">
          {ok === false ? `over ${budget}` : budget}
        </span>
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* stages                                                              */
/* ------------------------------------------------------------------ */

const ALTITUDES = ['Fleet', 'Team', 'Agent'] as const;

function OptionStage({
  option,
  state,
  compact,
}: {
  option: HeroIdleOptionId;
  state: StudyState;
  compact: boolean;
}) {
  const [root, setRoot] = useState<RootState | null>(null);
  const [mode, setMode] = useState<HeroBoardMode>('live');
  const progress = useRef(0);
  const rail = useRef<HTMLDivElement>(null);
  const scrollStage = useRef<HTMLDivElement>(null);
  const ticking = useRef(false);
  const metrics = useBoardMetrics(root, state.force !== 'poster');
  const declaration = HERO_IDLE_OPTIONS.find(entry => entry.id === option)!;

  const onScroll = useCallback(() => {
    if (ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      ticking.current = false;
      const stage = scrollStage.current;
      if (!stage) return;
      const travel = stage.scrollHeight - stage.clientHeight;
      // Progress over a FIXED range, never a raw pixel offset.
      const value = travel > 0 ? stage.scrollTop / travel : 0;
      progress.current = value;
      if (rail.current) rail.current.style.transform = `scaleX(${value})`;
      // Demand frameloop: a programmatic change has to ask for a frame.
      root?.invalidate();
    });
  }, [root]);

  const board = (
    <HeroBoard
      option={option}
      themeKey={state.theme}
      force={state.force}
      progressRef={progress}
      preserveDrawingBuffer
      statusProtocolMotion={state.protocol}
      statusChanges={state.changes}
      onCreated={setRoot}
      onModeChange={setMode}
    />
  );

  return (
    <section
      className="flex min-w-0 flex-col gap-3"
      data-hero-stage={option}
      aria-labelledby={`hero-stage-${option}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id={`hero-stage-${option}`}
          className="text-chrome-title font-semibold"
        >
          {declaration.ordinal}. {declaration.title}
        </h2>
        <span className="font-mono text-chrome-micro uppercase tracking-[0.14em] text-muted-foreground">
          {mode === 'live' ? 'live canvas' : 'poster'}
        </span>
      </div>

      <div
        className={`relative overflow-hidden rounded-lg border border-border ${
          compact ? 'h-[38svh] min-h-[260px]' : 'h-[62svh] min-h-[420px]'
        }`}
      >
        {option === 'scroll' ? (
          <div
            ref={scrollStage}
            onScroll={onScroll}
            className="h-full w-full overflow-y-auto overscroll-contain"
            data-hero-scroll-stage
          >
            <div className="sticky top-0 h-full w-full">{board}</div>
            <div className="h-[300%] w-full" aria-hidden />
          </div>
        ) : (
          board
        )}
      </div>

      {option === 'scroll' ? (
        <div className="flex flex-col gap-1">
          <div className="h-0.5 w-full overflow-hidden rounded bg-secondary">
            <div
              ref={rail}
              className="h-full w-full origin-left bg-primary"
              style={{ transform: 'scaleX(0)' }}
              data-hero-scroll-rail
            />
          </div>
          <div className="flex justify-between font-mono text-chrome-micro uppercase tracking-[0.14em] text-muted-foreground">
            {ALTITUDES.map(altitude => (
              <span key={altitude}>{altitude}</span>
            ))}
          </div>
        </div>
      ) : null}

      <Readout metrics={metrics} mode={mode} compact={compact} />

      <p className="max-w-[70ch] text-sm text-muted-foreground">
        {declaration.summary}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export function HeroBoardStudy() {
  // Derived from the URL, not held in local state: the controls are <Link>s,
  // so a client-side navigation must re-render the study. Reading the search
  // string once in an effect left the address bar changing while the page
  // stood still.
  const searchParams = useSearchParams();
  const state = useMemo<StudyState>(
    () => readState(searchParams.toString()),
    [searchParams]
  );

  const stages = useMemo<HeroIdleOptionId[]>(
    () =>
      state.stage === 'compare'
        ? HERO_IDLE_OPTIONS.map(option => option.id)
        : [state.stage],
    [state.stage]
  );

  return (
    <main
      className="min-h-screen bg-background px-4 py-6 font-ui text-foreground sm:px-6"
      data-hero-board-study={state.stage}
    >
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
        <header className="flex flex-col gap-2">
          <p className="font-mono text-chrome-micro text-muted-foreground">
            <Link href="/hud-gallery" className="hover:text-foreground">
              HUD Gallery
            </Link>{' '}
            / Hero board
          </p>
          <h1 className="text-surface-title font-semibold">
            Hero board idle options
          </h1>
          <p className="max-w-[80ch] text-sm text-muted-foreground">
            Three idle behaviours for the homepage hero, over one capture of the
            Demo Workspace: {HERO_BOARD_CAPTURE.counts.units} units across{' '}
            {HERO_BOARD_CAPTURE.counts.projects} Projects,{' '}
            {HERO_BOARD_CAPTURE.counts.needsYou} of them needing a human. Each
            board measures its own idle motion once a second against the budget
            below. Pick one; the winner ships in the fold band.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border p-3">
          <Control
            label="Option"
            options={STAGES.map(entry => ({
              value: entry.id,
              label: entry.label,
              href: href(state, { stage: entry.id }),
            }))}
            current={state.stage}
          />
          <Control
            label="Theme"
            options={(Object.keys(HERO_THEMES) as HeroThemeKey[]).map(
              value => ({
                value,
                label: value,
                href: href(state, { theme: value }),
              })
            )}
            current={state.theme}
          />
          <Control
            label="Path"
            options={(['auto', 'frozen', 'poster'] as ForceMode[]).map(
              value => ({
                value,
                label:
                  value === 'auto'
                    ? 'Live'
                    : value === 'frozen'
                      ? 'Frozen'
                      : 'Poster',
                href: href(state, { force: value }),
              })
            )}
            current={state.force}
          />
          <Control
            label="Active mark turns"
            options={[
              {
                value: '1',
                label: 'On',
                href: href(state, { protocol: true }),
              },
              {
                value: '0',
                label: 'Off',
                href: href(state, { protocol: false }),
              },
            ]}
            current={state.protocol ? '1' : '0'}
          />
          <Control
            label="Status changes"
            options={[
              { value: '1', label: 'On', href: href(state, { changes: true }) },
              {
                value: '0',
                label: 'Off',
                href: href(state, { changes: false }),
              },
            ]}
            current={state.changes ? '1' : '0'}
          />
        </div>

        <div
          className={
            state.stage === 'compare'
              ? 'grid gap-6 lg:grid-cols-3'
              : 'grid gap-6'
          }
        >
          {stages.map(option => (
            <OptionStage
              key={`${option}-${state.theme}-${state.force}-${state.protocol}-${state.changes}`}
              option={option}
              state={state}
              compact={state.stage === 'compare'}
            />
          ))}
        </div>

        <section
          aria-labelledby="hero-arguments"
          className="flex flex-col gap-3"
        >
          <h2 id="hero-arguments" className="text-chrome-title font-semibold">
            What each option costs
          </h2>
          <div className="grid gap-3 lg:grid-cols-3">
            {HERO_IDLE_OPTIONS.map(option => (
              <article
                key={option.id}
                className="flex flex-col gap-2 rounded-lg border border-border p-4"
                data-hero-argument={option.id}
              >
                <h3 className="text-chrome-title font-semibold">
                  {option.ordinal}. {option.title}
                </h3>
                <Note label="Mechanism">{option.mechanism}</Note>
                <Note label="For">{option.argument}</Note>
                <Note label="Against">{option.risk}</Note>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="hero-method" className="flex flex-col gap-2">
          <h2 id="hero-method" className="text-chrome-title font-semibold">
            How the numbers are measured
          </h2>
          <p className="max-w-[80ch] text-sm text-muted-foreground">
            Two frames one second apart, sampled straight off the canvas and
            compared per channel. Mean Δ is the average absolute difference
            across R, G and B over every sampled pixel, in 0–255 units. A pixel
            counts as changed when any channel moves by two or more, which
            ignores dither noise. Both figures are a rolling mean of the last
            five samples. The share is relative to the canvas, so a small tile
            reads higher than a full-width hero over the same motion; the
            full-width number is the one the budget is written against. Budget:
            mean Δ under {IDLE_BUDGET.meanChannelDelta}, changed pixels under{' '}
            {IDLE_BUDGET.changedPixelShare * 100}% per second. Above 10% is
            showreel territory (GitHub measures 0.0%, Vercel 0.6%, Spline 1.4%,
            Lusion 46%).
          </p>
          <p className="max-w-[80ch] text-sm text-muted-foreground">
            Reading pixels back needs the drawing buffer preserved, which the
            study turns on and the production hero never does. Everything else
            is exactly how the hero would ship: antialias off with the marks
            antialiased in shader, DPR capped at {IDLE_BUDGET.maxDpr}, one
            instanced mesh for all {HERO_BOARD_CAPTURE.counts.units} units, and
            a demand frameloop that parks when the board leaves the viewport or
            the tab is hidden.
          </p>
        </section>
      </div>
    </main>
  );
}

function Note({ label, children }: { label: string; children: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      <span className="font-mono text-chrome-micro uppercase tracking-[0.14em] text-foreground">
        {label}
      </span>{' '}
      {children}
    </p>
  );
}

function Control({
  label,
  options,
  current,
}: {
  label: string;
  options: Array<{ value: string; label: string; href: string }>;
  current: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-chrome-micro text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map(option => (
          <Link
            key={option.value}
            href={option.href}
            data-study-option={option.value}
            aria-current={option.value === current ? 'true' : undefined}
            className={`rounded border px-2 py-1 text-chrome-micro transition-colors ${
              option.value === current
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:bg-secondary'
            }`}
          >
            {option.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
