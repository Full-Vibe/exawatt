'use client';

/**
 * Homepage study (ENG-031 W15): the design partner's scroll structure over
 * five candidate fleet visuals, switchable on the page, under two copy
 * sets. The fleet's size is the story's own (`Stage.count`): ten, then one,
 * then the whole fleet.
 *
 * One bar of controls over the page. Scroll it. Drag the visual to turn it.
 * Click an agent to open it. On a phone the bar folds to one button.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ScrollExperience, type SnapMode } from './scroll-experience';
import type { CopySetId } from './stages';
import { VISUALS, type VisualId } from './visual-contract';
import { CRUST_MARKS, type CrustMarkId } from './visuals/crust-marks';
import {
  CRUST_MATERIALS,
  type CrustMaterialId,
} from './visuals/crust-materials';
import { CRUST_MOTIONS, type CrustMotionId } from './visuals/crust-motion';
import { CRUST_SHAPES, type CrustShapeId } from './visuals/crust-shape';
import { CRUST_SIGNALS, type CrustSignalId } from './visuals/crust-signal';
import type { EnvironmentKind } from './visuals/environment';

interface StudyState {
  visual: VisualId;
  copy: CopySetId;
  material: CrustMaterialId;
  mark: CrustMarkId;
  shape: CrustShapeId;
  motion: CrustMotionId;
  signal: CrustSignalId;
  light: EnvironmentKind;
  snap: SnapMode;
}

function readState(params: URLSearchParams): StudyState {
  const visual = params.get('visual');
  const copy = params.get('copy');
  const material = params.get('material');
  const mark = params.get('mark');
  const shape = params.get('shape');
  const motion = params.get('motion');
  const signal = params.get('signal');
  return {
    signal: CRUST_SIGNALS.some(x => x.id === signal)
      ? (signal as CrustSignalId)
      : 'paint',
    light: params.get('light') === 'room' ? 'room' : 'studio',
    snap:
      params.get('snap') === 'soft' || params.get('snap') === 'off'
        ? (params.get('snap') as SnapMode)
        : 'page',
    material: CRUST_MATERIALS.some(m => m.id === material)
      ? (material as CrustMaterialId)
      : 'acrylic',
    mark: CRUST_MARKS.some(m => m.id === mark)
      ? (mark as CrustMarkId)
      : 'relief',
    shape: CRUST_SHAPES.some(m => m.id === shape)
      ? (shape as CrustShapeId)
      : 'rounded',
    motion: CRUST_MOTIONS.some(m => m.id === motion)
      ? (motion as CrustMotionId)
      : 'sheen',
    visual: VISUALS.some(v => v.id === visual) ? (visual as VisualId) : 'crust',
    copy: copy === 'deck' ? 'deck' : 'canon',
  };
}

function href(state: StudyState): string {
  return `/hud-gallery/homepage-study?visual=${state.visual}&copy=${state.copy}&material=${state.material}&mark=${state.mark}&shape=${state.shape}&motion=${state.motion}&signal=${state.signal}&light=${state.light}&snap=${state.snap}`;
}

function Option({
  active,
  href: to,
  children,
  title,
}: {
  active: boolean;
  href: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <Link
      href={to}
      scroll={false}
      title={title}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'rounded border px-2 py-1 text-chrome-micro transition-colors',
        active
          ? 'border-white bg-white text-black'
          : 'border-white/15 text-white/70 hover:bg-white/10'
      )}
    >
      {children}
    </Link>
  );
}

export function HomepageStudy() {
  const searchParams = useSearchParams();
  const state = useMemo(() => readState(searchParams), [searchParams]);
  const [open, setOpen] = useState(false);
  // How much of the stage's top the bar covers, for the open panel to clear.
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () => setBarHeight(bar.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  return (
    <main
      className="min-h-screen bg-[#04060b] font-ui text-white"
      data-homepage-study
      data-public-exhibition-surface="true"
    >
      {/* The controls float over the pinned stage rather than sitting above
          it in the flow, so the scene is pinned from the first pixel of
          scroll and never shoves up under the bar first. On a phone they
          fold behind one button so the world keeps the screen. */}
      <div
        ref={barRef}
        className="fixed inset-x-0 top-12 z-30 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-white/10 bg-[#04060b]/90 px-4 py-2"
      >
        <p className="font-mono text-chrome-micro text-white/50">
          <Link href="/hud-gallery" className="hover:text-white">
            HUD Gallery
          </Link>{' '}
          / <span className="text-white">Homepage study</span>
        </p>
        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          aria-expanded={open}
          className="rounded border border-white/15 px-2 py-1 font-mono text-chrome-micro text-white/70 md:hidden"
        >
          {open ? 'Hide controls' : 'Controls'}
        </button>
        <div
          className={cn(
            'w-full flex-col items-start gap-y-2 md:flex md:w-auto md:flex-row md:flex-wrap md:items-center md:gap-x-5',
            open ? 'flex' : 'hidden'
          )}
        >
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-chrome-micro uppercase tracking-[0.18em] text-white/40">
              Visual
            </span>
            {VISUALS.map(option => (
              <Option
                key={option.id}
                active={option.id === state.visual}
                href={href({ ...state, visual: option.id })}
                title={option.note}
              >
                {option.name}
              </Option>
            ))}
          </div>
          {state.visual === 'crust' ? (
            <>
              <div className="flex items-center gap-1">
                <span className="mr-1 font-mono text-chrome-micro uppercase tracking-[0.18em] text-white/40">
                  Material
                </span>
                {CRUST_MATERIALS.map(option => (
                  <Option
                    key={option.id}
                    active={option.id === state.material}
                    href={href({ ...state, material: option.id })}
                    title={option.note}
                  >
                    {option.name}
                  </Option>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="mr-1 font-mono text-chrome-micro uppercase tracking-[0.18em] text-white/40">
                  Signal
                </span>
                {CRUST_SIGNALS.map(option => (
                  <Option
                    key={option.id}
                    active={option.id === state.signal}
                    href={href({ ...state, signal: option.id })}
                    title={option.note}
                  >
                    {option.name}
                  </Option>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="mr-1 font-mono text-chrome-micro uppercase tracking-[0.18em] text-white/40">
                  Light
                </span>
                <Option
                  active={state.light === 'studio'}
                  href={href({ ...state, light: 'studio' })}
                >
                  Studio
                </Option>
                <Option
                  active={state.light === 'room'}
                  href={href({ ...state, light: 'room' })}
                >
                  Room
                </Option>
              </div>
              <div className="flex items-center gap-1">
                <span className="mr-1 font-mono text-chrome-micro uppercase tracking-[0.18em] text-white/40">
                  Harness mark
                </span>
                {CRUST_MARKS.map(option => (
                  <Option
                    key={option.id}
                    active={option.id === state.mark}
                    href={href({ ...state, mark: option.id })}
                    title={option.note}
                  >
                    {option.name}
                  </Option>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="mr-1 font-mono text-chrome-micro uppercase tracking-[0.18em] text-white/40">
                  Shape
                </span>
                {CRUST_SHAPES.map(option => (
                  <Option
                    key={option.id}
                    active={option.id === state.shape}
                    href={href({ ...state, shape: option.id })}
                    title={option.note}
                  >
                    {option.name}
                  </Option>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="mr-1 font-mono text-chrome-micro uppercase tracking-[0.18em] text-white/40">
                  Working
                </span>
                {CRUST_MOTIONS.map(option => (
                  <Option
                    key={option.id}
                    active={option.id === state.motion}
                    href={href({ ...state, motion: option.id })}
                    title={option.note}
                  >
                    {option.name}
                  </Option>
                ))}
              </div>
            </>
          ) : null}
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-chrome-micro uppercase tracking-[0.18em] text-white/40">
              Snap
            </span>
            {(['page', 'soft', 'off'] as SnapMode[]).map(mode => (
              <Option
                key={mode}
                active={state.snap === mode}
                href={href({ ...state, snap: mode })}
                title={
                  mode === 'off'
                    ? 'Park anywhere.'
                    : mode === 'soft'
                      ? 'A pull to the nearest frame when the scroll stops near one.'
                      : 'One scene per gesture: a wheel flick, a key or a swipe moves one scene and lands.'
                }
              >
                {mode[0].toUpperCase() + mode.slice(1)}
              </Option>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-chrome-micro uppercase tracking-[0.18em] text-white/40">
              Copy
            </span>
            <Option
              active={state.copy === 'canon'}
              href={href({ ...state, copy: 'canon' })}
            >
              Canon
            </Option>
            <Option
              active={state.copy === 'deck'}
              href={href({ ...state, copy: 'deck' })}
            >
              Deck
            </Option>
          </div>
        </div>
      </div>

      <ScrollExperience
        visual={state.visual}
        copySet={state.copy}
        material={state.material}
        mark={state.mark}
        shape={state.shape}
        motion={state.motion}
        signal={state.signal}
        light={state.light}
        snap={state.snap}
        insetTop={barHeight}
      />

      {/* Under Page on a touch screen the browser snaps to each scene and may
          not skip one; the page's own end is a snap point too, so the footer
          stays reachable. */}
      <footer
        className={cn(
          'border-t border-white/10 px-6 py-8 text-[13px] text-white/45',
          state.snap === 'page' && 'snap-end'
        )}
      >
        <p className="max-w-[60ch]">
          Structure from the design partner&apos;s deck, slides 15 to 21. Five
          visuals on one synthetic fleet, laid out once at 300 agents so a
          smaller fleet is a prefix of the same layout and growth never moves an
          agent. The story opens on ten agents, closes in on one, and grows to
          the whole fleet. Drag to turn; it settles back. Click an agent to open
          it. Outlined tiles are the slots the next agents would take. Harness
          marks are the vendors&apos; own, used to name the product that runs
          each agent.
        </p>
      </footer>
    </main>
  );
}
