'use client';

/**
 * Hero board study (ENG-031 W2).
 *
 * ONE board, the one the operator chose on 2026-08-17: planted at rest, and the
 * page scroll drives the altitude pull from Fleet to Team to Agent. The orbit
 * option and its measurement path were deleted, not demoted.
 *
 * The study is the board and nothing else. Its own review verdict was "I don't
 * want to read all the text on that page", so the prose is gone: the page is a
 * sticky full-height board with a thin bar of controls, an altitude rail, and
 * one line of measured motion. Scroll the page to fly the camera.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { RootState } from '@react-three/fiber';
import {
  HeroBoard,
  type HeroBoardMode,
} from '@/components/site/hero-board/hero-board';
import { IDLE_BUDGET } from '@/components/site/hero-board/hero-board-budget';
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

type RenderPath = 'live' | 'reduced';

interface StudyState {
  theme: HeroThemeKey;
  path: RenderPath;
}

const ALTITUDES = ['Fleet', 'Team', 'Agent'] as const;

/** Viewport heights of scroll travel behind the sticky board. Progress is a
 *  fraction of a FIXED range, never a raw pixel offset. */
const SCROLL_SCREENS = 4;

function readState(search: string): StudyState {
  const params = new URLSearchParams(search);
  const theme = params.get('theme');
  return {
    theme: theme && theme in HERO_THEMES ? (theme as HeroThemeKey) : 'classic',
    path: params.get('path') === 'reduced' ? 'reduced' : 'live',
  };
}

function href(state: StudyState, patch: Partial<StudyState>): string {
  const next = { ...state, ...patch };
  return `/hud-gallery/hero-board?theme=${next.theme}&path=${next.path}`;
}

/* ------------------------------------------------------------------ */
/* measurement                                                         */
/* ------------------------------------------------------------------ */

interface BoardMetrics {
  delta: IdleFrameDelta | null;
  drawCalls: number;
  dpr: number;
  framesPerSecond: number;
  /** Where the camera was resting when the sample was taken. The budget is
   *  written against the FOLD, which is the Fleet framing; the same telemetry
   *  costs far more pixel share once one mark fills a tenth of the screen, so
   *  a Team or Agent reading is data, not a failure. */
  altitude: (typeof ALTITUDES)[number];
}

const EMPTY_METRICS: BoardMetrics = {
  delta: null,
  drawCalls: 0,
  dpr: 0,
  framesPerSecond: 0,
  altitude: 'Fleet',
};

/** One sample a second: the budget is stated per second, so it is measured per
 *  second. The rolling mean over the last five keeps a single status change
 *  from reading as a trend.
 *
 *  Samples taken while the camera is moving are DROPPED, not averaged in. The
 *  budget is an idle budget and scroll-driven motion is input-driven, so a
 *  visitor dragging the page through the altitude pull must not turn the
 *  readout red for the next five seconds. Two consecutive still ticks are
 *  required before a sample counts, which covers the camera's damping tail. */
function useBoardMetrics(
  root: RootState | null,
  enabled: boolean,
  progressRef: RefObject<number>
) {
  const [metrics, setMetrics] = useState<BoardMetrics>(EMPTY_METRICS);
  useEffect(() => {
    if (!root || !enabled) {
      setMetrics(EMPTY_METRICS);
      return;
    }
    const scratch = document.createElement('canvas');
    const means: number[] = [];
    const shares: number[] = [];
    let previous: Uint8ClampedArray | null = null;
    let lastFrame = root.gl.info.render.frame;
    let lastProgress = progressRef.current;
    let stillTicks = 0;
    let lastAltitude: (typeof ALTITUDES)[number] = 'Fleet';
    const timer = globalThis.setInterval(() => {
      const sample = sampleCanvas(root.gl.domElement, scratch);
      const frame = root.gl.info.render.frame;
      const framesPerSecond = Math.max(0, frame - lastFrame);
      lastFrame = frame;
      stillTicks = progressRef.current === lastProgress ? stillTicks + 1 : 0;
      lastProgress = progressRef.current;
      if (stillTicks < 2) {
        previous = sample;
        return;
      }
      const altitude: (typeof ALTITUDES)[number] =
        lastProgress < 0.08 ? 'Fleet' : lastProgress < 0.75 ? 'Team' : 'Agent';
      // The rolling mean never spans two altitudes: one mark fills a tenth of
      // the screen at Agent altitude and two pixels at Fleet, so averaging
      // across the pull would report a number that describes neither.
      if (altitude !== lastAltitude) {
        means.length = 0;
        shares.length = 0;
        lastAltitude = altitude;
      }
      if (sample && previous) {
        const delta = compareFrames(previous, sample);
        means.push(delta.meanChannelDelta);
        shares.push(delta.changedPixelShare);
        if (means.length > 5) means.shift();
        if (shares.length > 5) shares.shift();
        const mean = (values: number[]) =>
          values.reduce((sum, value) => sum + value, 0) / values.length;
        setMetrics({
          delta: {
            ...delta,
            meanChannelDelta: mean(means),
            changedPixelShare: mean(shares),
          },
          drawCalls: root.gl.info.render.calls,
          dpr: root.gl.getPixelRatio(),
          framesPerSecond,
          altitude,
        });
      }
      previous = sample;
    }, 1000);
    return () => globalThis.clearInterval(timer);
  }, [root, enabled, progressRef]);
  return metrics;
}

function Readout({ metrics }: { metrics: BoardMetrics }) {
  // Only the fold's framing is graded. Everything else is reported.
  const graded = metrics.altitude === 'Fleet';
  const verdict =
    metrics.delta && graded ? gradeIdleDelta(metrics.delta, IDLE_BUDGET) : null;
  const number = (value: string, ok: boolean | null) => (
    <span
      className={
        ok === false ? 'text-destructive' : 'text-foreground tabular-nums'
      }
    >
      {value}
    </span>
  );
  return (
    <p
      className="font-mono text-chrome-micro text-muted-foreground"
      data-hero-readout
    >
      at rest, {metrics.altitude.toLowerCase()}
      {' · '}
      mean Δ{' '}
      {number(
        metrics.delta ? metrics.delta.meanChannelDelta.toFixed(2) : '—',
        verdict?.meanOk ?? null
      )}
      <span className="opacity-60">/{IDLE_BUDGET.meanChannelDelta}</span>
      {' · '}
      changed{' '}
      {number(
        metrics.delta
          ? `${(metrics.delta.changedPixelShare * 100).toFixed(2)}%`
          : '—',
        verdict?.shareOk ?? null
      )}
      <span className="opacity-60">
        /{IDLE_BUDGET.changedPixelShare * 100}%
      </span>
      {' · '}
      {number(
        metrics.drawCalls ? String(metrics.drawCalls) : '—',
        metrics.drawCalls ? metrics.drawCalls <= IDLE_BUDGET.maxDrawCalls : null
      )}{' '}
      draw calls<span className="opacity-60">/{IDLE_BUDGET.maxDrawCalls}</span>
      {' · '}
      dpr{' '}
      {number(
        metrics.dpr ? metrics.dpr.toFixed(2) : '—',
        metrics.dpr ? metrics.dpr <= IDLE_BUDGET.maxDpr : null
      )}
      <span className="opacity-60">/{IDLE_BUDGET.maxDpr}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export function HeroBoardStudy() {
  // Derived from the URL, not local state: the controls are <Link>s, so a
  // client-side navigation has to re-render the study.
  const searchParams = useSearchParams();
  const state = useMemo<StudyState>(
    () => readState(searchParams.toString()),
    [searchParams]
  );

  const [root, setRoot] = useState<RootState | null>(null);
  const [mode, setMode] = useState<HeroBoardMode>('live');
  const progress = useRef(0);
  const rail = useRef<HTMLDivElement>(null);
  const ticking = useRef(false);
  const metrics = useBoardMetrics(root, state.path === 'live', progress);

  const onScroll = useCallback(() => {
    if (ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      ticking.current = false;
      // Progress over a FIXED range, never a raw pixel offset.
      const travel = document.body.scrollHeight - window.innerHeight;
      const value = travel > 0 ? window.scrollY / travel : 0;
      progress.current = Math.min(1, Math.max(0, value));
      if (rail.current)
        rail.current.style.transform = `scaleX(${progress.current})`;
      // Demand frameloop: a programmatic change has to ask for a frame.
      root?.invalidate();
    });
  }, [root]);

  useEffect(() => {
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [onScroll]);

  return (
    <main
      className="bg-background font-ui text-foreground"
      style={{ height: `${SCROLL_SCREENS * 100}svh` }}
      data-hero-board-study
    >
      {/* The site header is `sticky top-0 h-12`, so the board sits under it and
          takes the rest: a full viewport at every scroll position, no dead
          strip and no clipped legend. */}
      <div className="sticky top-12 flex h-[calc(100svh-3rem)] flex-col">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2">
          <p className="font-mono text-chrome-micro text-muted-foreground">
            <Link href="/hud-gallery" className="hover:text-foreground">
              HUD Gallery
            </Link>{' '}
            / <span className="text-foreground">Hero board</span>
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Control
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
              options={[
                {
                  value: 'live',
                  label: 'Live board',
                  href: href(state, { path: 'live' }),
                },
                {
                  value: 'reduced',
                  label: 'Reduced motion',
                  href: href(state, { path: 'reduced' }),
                },
              ]}
              current={state.path}
            />
          </div>
        </header>

        <div className="relative min-h-0 flex-1 border-y border-border">
          <HeroBoard
            key={`${state.theme}-${state.path}`}
            themeKey={state.theme}
            force={state.path === 'reduced' ? 'poster' : 'auto'}
            progressRef={progress}
            preserveDrawingBuffer
            onCreated={setRoot}
            onModeChange={setMode}
          />
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2">
          <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
            <div className="h-0.5 w-full overflow-hidden rounded bg-secondary">
              <div
                ref={rail}
                className="bg-primary h-full w-full origin-left"
                style={{ transform: 'scaleX(0)' }}
                data-hero-scroll-rail
              />
            </div>
            <div className="text-muted-foreground flex justify-between font-mono text-chrome-micro tracking-[0.14em] uppercase">
              {ALTITUDES.map(altitude => (
                <span key={altitude}>{altitude}</span>
              ))}
            </div>
          </div>
          {mode === 'live' ? (
            <Readout metrics={metrics} />
          ) : (
            <p className="font-mono text-chrome-micro text-muted-foreground">
              poster · 0 canvases
            </p>
          )}
        </footer>
      </div>
    </main>
  );
}

function Control({
  options,
  current,
}: {
  options: Array<{ value: string; label: string; href: string }>;
  current: string;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(option => (
        <Link
          key={option.value}
          href={option.href}
          scroll={false}
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
  );
}
