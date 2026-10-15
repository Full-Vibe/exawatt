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

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
} from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  NAMES,
  parseNames,
  type NamesId,
} from '@/components/site/fleet-story/names';
import {
  ScrollExperience,
  type SnapMode,
} from '@/components/site/fleet-story/scroll-experience';
import type { CopySetId } from '@/components/site/fleet-story/stages';
import type { VisualProps } from '@/components/site/fleet-story/visual-contract';
import { CrustVisual } from '@/components/site/fleet-story/visuals/crust-visual';
import {
  CRUST_MARKS,
  type CrustMarkId,
} from '@/components/site/fleet-story/visuals/crust-marks';
import {
  CRUST_MATERIALS,
  type CrustMaterialId,
} from '@/components/site/fleet-story/visuals/crust-materials';
import {
  CRUST_GLOWS,
  CRUST_LIFTS,
  motionParam,
  parseMotion,
  toggleGlow,
  type CrustMotion,
} from '@/components/site/fleet-story/visuals/crust-motion';
import {
  CRUST_SHAPES,
  type CrustShapeId,
} from '@/components/site/fleet-story/visuals/crust-shape';
import {
  CRUST_SIGNALS,
  type CrustSignalId,
} from '@/components/site/fleet-story/visuals/crust-signal';
import type { EnvironmentKind } from '@/components/site/fleet-story/visuals/environment';
import { HOMEPAGE_STORY } from '@/components/site/fleet-story/homepage-settings';
import { DomeVisual } from './visuals/dome-visual';
import { LidarVisual } from './visuals/lidar-visual';
import { MercuryVisual } from './visuals/mercury-visual';
import { PrismVisual } from './visuals/prism-visual';
import styles from './study.module.css';

type VisualId = 'crust' | 'lidar' | 'dome' | 'prism' | 'mercury';

/** The candidates the homepage chose Crust from (W15), kept to compare. */
const VISUALS: {
  id: VisualId;
  name: string;
  note: string;
  component: ComponentType<VisualProps>;
}[] = [
  {
    id: 'crust',
    name: 'Crust',
    note: 'Hex territory on a section of a sphere. Grows with the fleet.',
    component: CrustVisual,
  },
  {
    id: 'lidar',
    name: 'LiDAR',
    note: 'The same world as a scanned point cloud with a live sweep.',
    component: LidarVisual,
  },
  {
    id: 'dome',
    name: 'Dome',
    note: "Today's board, bent onto the sphere. The nearest step from what ships.",
    component: DomeVisual,
  },
  {
    id: 'prism',
    name: 'Prism',
    note: 'Crystal glass with a status light inside each agent. Dispersion and iridescence.',
    component: PrismVisual,
  },
  {
    id: 'mercury',
    name: 'Mercury',
    note: 'Liquid metal. Agents are droplets that merge into a pool as a Project fills.',
    component: MercuryVisual,
  },
];

const SNAPS: SnapMode[] = ['page', 'soft', 'off'];
const HEADLINE_FONTS = [
  {
    id: 'geist',
    name: 'Geist',
    note: 'Current homepage: clean and quiet.',
    family: 'var(--font-geist-sans)',
  },
  {
    id: 'manrope',
    name: 'Manrope',
    note: 'Sleek geometry with a sharper display silhouette.',
    family: 'var(--study-manrope)',
  },
  {
    id: 'hanken',
    name: 'Hanken',
    note: 'A confident grotesk with a more human rhythm.',
    family: 'var(--study-hanken)',
  },
] as const;
const INTERFACE_FONTS = [
  {
    id: 'geist',
    name: 'Geist',
    note: 'Current product copy and labels.',
    family: 'var(--font-geist-sans)',
  },
  {
    id: 'tabs',
    name: 'Tab labels',
    note: 'The app tab face, Geist Mono, on short labels; Geist Sans for sentences.',
    family: 'var(--font-geist-sans)',
  },
  {
    id: 'hanken',
    name: 'Hanken',
    note: 'A warmer reading face for product copy and controls.',
    family: 'var(--study-hanken)',
  },
] as const;
type HeadlineFontId = (typeof HEADLINE_FONTS)[number]['id'];
type InterfaceFontId = (typeof INTERFACE_FONTS)[number]['id'];

interface StudyState {
  visual: VisualId;
  copy: CopySetId;
  material: CrustMaterialId;
  mark: CrustMarkId;
  shape: CrustShapeId;
  motion: CrustMotion;
  signal: CrustSignalId;
  light: EnvironmentKind;
  snap: SnapMode;
  sound: boolean;
  names: NamesId;
  headlineFont: HeadlineFontId;
  interfaceFont: InterfaceFontId;
}

function readState(params: URLSearchParams): StudyState {
  const visual = params.get('visual');
  const copy = params.get('copy');
  const material = params.get('material');
  const mark = params.get('mark');
  const shape = params.get('shape');
  const signal = params.get('signal');
  const headlineFont = params.get('headline');
  const interfaceFont = params.get('interface');
  return {
    headlineFont: HEADLINE_FONTS.some(font => font.id === headlineFont)
      ? (headlineFont as HeadlineFontId)
      : 'geist',
    interfaceFont: INTERFACE_FONTS.some(font => font.id === interfaceFont)
      ? (interfaceFont as InterfaceFontId)
      : 'geist',
    signal: CRUST_SIGNALS.some(x => x.id === signal)
      ? (signal as CrustSignalId)
      : HOMEPAGE_STORY.signal,
    light:
      params.get('light') === 'room' || params.get('light') === 'studio'
        ? (params.get('light') as EnvironmentKind)
        : HOMEPAGE_STORY.light,
    snap: SNAPS.some(x => x === params.get('snap'))
      ? (params.get('snap') as SnapMode)
      : HOMEPAGE_STORY.snap,
    material: CRUST_MATERIALS.some(m => m.id === material)
      ? (material as CrustMaterialId)
      : HOMEPAGE_STORY.material,
    mark: CRUST_MARKS.some(m => m.id === mark)
      ? (mark as CrustMarkId)
      : HOMEPAGE_STORY.mark,
    shape: CRUST_SHAPES.some(m => m.id === shape)
      ? (shape as CrustShapeId)
      : HOMEPAGE_STORY.shape,
    motion: params.has('motion')
      ? parseMotion(params.get('motion'))
      : HOMEPAGE_STORY.motion,
    sound: params.has('sound')
      ? params.get('sound') !== 'off'
      : HOMEPAGE_STORY.sound,
    names: params.has('names')
      ? parseNames(params.get('names'))
      : HOMEPAGE_STORY.names,
    visual: VISUALS.some(v => v.id === visual) ? (visual as VisualId) : 'crust',
    copy: copy === 'deck' || copy === 'canon' ? copy : HOMEPAGE_STORY.copySet,
  };
}

function href(state: StudyState): string {
  return `/hud-gallery/homepage-study?visual=${state.visual}&copy=${state.copy}&material=${state.material}&mark=${state.mark}&shape=${state.shape}&motion=${motionParam(state.motion)}&signal=${state.signal}&light=${state.light}&snap=${state.snap}&sound=${state.sound ? 'on' : 'off'}&names=${state.names}&headline=${state.headlineFont}&interface=${state.interfaceFont}`;
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

export function HomepageStudy({ fontVariables }: { fontVariables: string }) {
  const searchParams = useSearchParams();
  const state = useMemo(() => readState(searchParams), [searchParams]);
  const [open, setOpen] = useState(false);
  const [showTypeProof, setShowTypeProof] = useState(false);
  const headlineFamily = HEADLINE_FONTS.find(
    font => font.id === state.headlineFont
  )!.family;
  const interfaceFamily = INTERFACE_FONTS.find(
    font => font.id === state.interfaceFont
  )!.family;
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
      className={cn(
        'min-h-screen bg-[#04060b] font-ui text-white',
        fontVariables,
        styles.study
      )}
      style={
        {
          '--study-headline-font': headlineFamily,
          '--font-ui': interfaceFamily,
          fontFamily: 'var(--font-ui)',
        } as CSSProperties
      }
      data-homepage-study
      data-interface-font={state.interfaceFont}
      data-public-exhibition-surface="true"
    >
      {/* The controls float over the pinned stage rather than sitting above
          it in the flow, so the scene is pinned from the first pixel of
          scroll and never shoves up under the bar first. On a phone they
          fold behind one button so the world keeps the screen. */}
      <div
        ref={barRef}
        className="fixed inset-x-0 top-12 z-30 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-white/10 bg-[#04060b] px-4 py-2"
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
                {CRUST_GLOWS.map(option => (
                  <Option
                    key={option.id}
                    active={state.motion[option.id]}
                    href={href({
                      ...state,
                      motion: toggleGlow(state.motion, option.id),
                    })}
                    title={option.note}
                  >
                    {option.name}
                  </Option>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="mr-1 font-mono text-chrome-micro uppercase tracking-[0.18em] text-white/40">
                  Lift
                </span>
                {CRUST_LIFTS.map(option => (
                  <Option
                    key={option.id}
                    active={option.id === state.motion.lift}
                    href={href({
                      ...state,
                      motion: { ...state.motion, lift: option.id },
                    })}
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
              Names
            </span>
            {NAMES.map(option => (
              <Option
                key={option.id}
                active={option.id === state.names}
                href={href({ ...state, names: option.id })}
                title={option.note}
              >
                {option.name}
              </Option>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-chrome-micro uppercase tracking-[0.18em] text-white/40">
              Snap
            </span>
            {SNAPS.map(mode => (
              <Option
                key={mode}
                active={state.snap === mode}
                href={href({ ...state, snap: mode })}
                title={
                  mode === 'off'
                    ? 'Park anywhere.'
                    : mode === 'soft'
                      ? 'A glide to the nearest frame wherever the scroll stops.'
                      : 'One scene per gesture: a wheel flick, a key or a swipe moves one scene and lands.'
                }
              >
                {mode[0].toUpperCase() + mode.slice(1)}
              </Option>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-chrome-micro uppercase tracking-[0.18em] text-white/40">
              Sound
            </span>
            <Option
              active={state.sound}
              href={href({ ...state, sound: true })}
              title="Pressing an agent clicks like the keyswitch study's Frosted thock."
            >
              On
            </Option>
            <Option
              active={!state.sound}
              href={href({ ...state, sound: false })}
            >
              Off
            </Option>
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
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-chrome-micro uppercase tracking-[0.18em] text-white/40">
              Headlines
            </span>
            {HEADLINE_FONTS.map(font => (
              <Option
                key={font.id}
                active={font.id === state.headlineFont}
                href={href({ ...state, headlineFont: font.id })}
                title={font.note}
              >
                {font.name}
              </Option>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-chrome-micro uppercase tracking-[0.18em] text-white/40">
              Product copy
            </span>
            {INTERFACE_FONTS.map(font => (
              <Option
                key={font.id}
                active={font.id === state.interfaceFont}
                href={href({ ...state, interfaceFont: font.id })}
                title={font.note}
              >
                {font.name}
              </Option>
            ))}
            <button
              type="button"
              onClick={() => setShowTypeProof(value => !value)}
              aria-expanded={showTypeProof}
              aria-controls="homepage-type-proof"
              className="rounded border border-white/15 px-2 py-1 text-chrome-micro text-white/70 hover:bg-white/10"
            >
              {showTypeProof ? 'Hide proof' : 'UI proof'}
            </button>
          </div>
        </div>
        {showTypeProof ? (
          <aside
            id="homepage-type-proof"
            aria-label="Product typography proof"
            className="absolute right-3 top-full mt-2 w-[min(25rem,calc(100vw-1.5rem))] rounded-xl border border-white/20 bg-[#10151d] p-5 text-white shadow-2xl"
          >
            <p className="mb-4 font-mono text-chrome-micro uppercase tracking-[0.16em] text-white/45">
              Product type ·{' '}
              {
                INTERFACE_FONTS.find(font => font.id === state.interfaceFont)
                  ?.name
              }
            </p>
            <div className="flex gap-5 border-b border-white/15 pb-2 text-chrome-title">
              <span className={styles.proofLabel}>Product launch</span>
              <span className="text-white/45">New session</span>
            </div>
            <div className="pt-5">
              <p
                className={cn(
                  'mb-2 text-chrome-micro uppercase tracking-[0.12em] text-amber-300',
                  styles.proofLabel
                )}
              >
                Approval needed
              </p>
              <h3 className="text-xl font-semibold">Review agent action</h3>
              <p className="mt-2 max-w-[32ch] text-base leading-relaxed text-white/65">
                This agent is waiting for your approval before it continues.
              </p>
              <div className="mt-5 flex justify-end gap-3 text-chrome-label font-medium">
                <span
                  className={cn(
                    'rounded border border-white/20 px-3 py-2',
                    styles.proofLabel
                  )}
                >
                  Cancel
                </span>
                <span
                  className={cn(
                    'rounded bg-white px-3 py-2 text-black',
                    styles.proofLabel
                  )}
                >
                  Approve
                </span>
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      <ScrollExperience
        Visual={VISUALS.find(option => option.id === state.visual)?.component}
        copySet={state.copy}
        material={state.material}
        mark={state.mark}
        shape={state.shape}
        motion={state.motion}
        signal={state.signal}
        light={state.light}
        snap={state.snap}
        sound={state.sound}
        names={state.names}
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
