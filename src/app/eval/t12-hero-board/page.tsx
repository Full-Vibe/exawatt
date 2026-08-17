'use client';

/**
 * t12-hero-board — the marketing hero board (ENG-031 W2).
 *
 * The board over the frozen Demo Workspace capture, in a deterministic
 * full-viewport rig. Drives three checks that cannot be made from a screenshot
 * alone: the whole board is three draw calls, the demand frameloop parks when
 * nothing is animating, and the reduced-motion path drops the canvas count to
 * zero.
 *
 * `?force=auto|frozen|poster` · `?theme=classic|night|air` · `?protocol=0` ·
 * `?changes=0` · `?highlight=whole-fleet|needs-you|one-project|one-agent`.
 * `window.__HERO_PROGRESS__(p)` drives the altitude pull without a scroll.
 *
 * The highlight matters to the budget, not only to the look: the pinned
 * sequence's RESTING state is a highlighted one (ENG-031 W4), so the eval
 * measures that state rather than assuming an unhighlighted board stands in
 * for it.
 */

import { Suspense, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import type { RootState } from '@react-three/fiber';
import type { WebGLRenderer } from 'three';
import { HeroBoard } from '@/components/site/hero-board/hero-board';
import type { HeroHighlightId } from '@/components/site/hero-board/hero-board-highlight';
import {
  HERO_THEMES,
  type HeroThemeKey,
} from '@/components/site/hero-board/hero-board-theme';
import {
  compareFrames,
  sampleCanvas,
  type IdleFrameDelta,
} from '@/components/site/hero-board/idle-measure';

/** The harness reads the SAME measurement the study displays, so a number in
 *  the eval report and a number on screen cannot disagree. */
export interface HeroEvalSample extends IdleFrameDelta {
  drawCalls: number;
  dpr: number;
  frame: number;
}

function Rig() {
  const params = useSearchParams();
  const progress = useRef(0);
  const theme = params.get('theme');
  const force = params.get('force');
  const highlight = params.get('highlight');

  const onCreated = useCallback((state: RootState) => {
    (window as unknown as { __EVAL_GL__?: WebGLRenderer }).__EVAL_GL__ =
      state.gl;
    (
      window as unknown as { __HERO_PROGRESS__?: (value: number) => void }
    ).__HERO_PROGRESS__ = (value: number) => {
      progress.current = value;
      state.invalidate();
    };
    const scratch = document.createElement('canvas');
    let previous: Uint8ClampedArray | null = null;
    function measure(): HeroEvalSample | null {
      const sample = sampleCanvas(state.gl.domElement, scratch);
      const delta = previous && sample ? compareFrames(previous, sample) : null;
      previous = sample;
      return delta
        ? {
            ...delta,
            drawCalls: state.gl.info.render.calls,
            dpr: state.gl.getPixelRatio(),
            frame: state.gl.info.render.frame,
          }
        : null;
    }
    (
      window as unknown as { __HERO_MEASURE__?: () => HeroEvalSample | null }
    ).__HERO_MEASURE__ = measure;
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <HeroBoard
        themeKey={
          theme && theme in HERO_THEMES ? (theme as HeroThemeKey) : 'classic'
        }
        force={force === 'frozen' || force === 'poster' ? force : 'auto'}
        highlight={(highlight as HeroHighlightId | null) ?? 'whole-fleet'}
        progressRef={progress}
        preserveDrawingBuffer
        statusProtocolMotion={params.get('protocol') !== '0'}
        statusChanges={params.get('changes') !== '0'}
        onCreated={onCreated}
      />
    </div>
  );
}

export default function T12HeroBoardPage() {
  return (
    <Suspense fallback={null}>
      <Rig />
    </Suspense>
  );
}
