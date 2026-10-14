'use client';

/**
 * Agent material study (ENG-031 W15d, operator 2026-10-09: "the materials /
 * single-agent study should be separate, so we can nail that down
 * independently of the motion scroll / homepage experience").
 *
 * One cluster, close, in the exact renderer the homepage study uses, with
 * every dial on the agent itself: material, signal treatment, the harness
 * mark, the tile's shape, how it moves while it works, the hero's status
 * and harness, the reflection room, and how many agents stand around it.
 * A change of status or harness changes the hero in place; nothing else
 * in the scene moves (operator 2026-10-13). Drag to orbit. Hover to feel
 * it. Click to open it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { StatusLightState } from '@/components/status-light/protocol';
import { heroBoardTheme } from '@/components/site/hero-board/hero-board-theme';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import { STATUS_LABEL } from '../homepage-study/fleet-model';
import { PinnedAgentPanel } from '../homepage-study/pinned-agent-panel';
import { STAGES } from '../homepage-study/stages';
import {
  STATUS_ORDER,
  VisualAnchor,
  type StoryDrive,
} from '../homepage-study/visual-contract';
import { VisualCanvas } from '../homepage-study/visual-canvas';
import {
  CRUST_MARKS,
  type CrustMarkId,
} from '../homepage-study/visuals/crust-marks';
import {
  CRUST_MATERIALS,
  type CrustMaterialId,
} from '../homepage-study/visuals/crust-materials';
import {
  CRUST_GLOWS,
  CRUST_LIFTS,
  motionParam,
  parseMotion,
  toggleGlow,
  type CrustMotion,
} from '../homepage-study/visuals/crust-motion';
import {
  CRUST_SHAPES,
  type CrustShapeId,
} from '../homepage-study/visuals/crust-shape';
import {
  CRUST_SIGNALS,
  type CrustSignalId,
} from '../homepage-study/visuals/crust-signal';
import type { EnvironmentKind } from '../homepage-study/visuals/environment';
import { CLUSTER_SOURCES, clusterModel } from './cluster-model';

interface StudyState {
  material: CrustMaterialId;
  signal: CrustSignalId;
  mark: CrustMarkId;
  shape: CrustShapeId;
  motion: CrustMotion;
  status: StatusLightState;
  source: string;
  light: EnvironmentKind;
  count: 1 | 7;
  sound: boolean;
}

function readState(params: URLSearchParams): StudyState {
  const material = params.get('material');
  const signal = params.get('signal');
  const mark = params.get('mark');
  const shape = params.get('shape');
  const status = params.get('status');
  const source = params.get('source');
  return {
    material: CRUST_MATERIALS.some(m => m.id === material)
      ? (material as CrustMaterialId)
      : 'acrylic',
    signal: CRUST_SIGNALS.some(x => x.id === signal)
      ? (signal as CrustSignalId)
      : 'paint',
    mark: CRUST_MARKS.some(m => m.id === mark)
      ? (mark as CrustMarkId)
      : 'relief',
    shape: CRUST_SHAPES.some(m => m.id === shape)
      ? (shape as CrustShapeId)
      : 'rounded',
    motion: parseMotion(params.get('motion')),
    status: STATUS_ORDER.includes(status as StatusLightState)
      ? (status as StatusLightState)
      : 'active',
    source: (CLUSTER_SOURCES as readonly string[]).includes(source ?? '')
      ? (source as string)
      : 'Claude Code',
    light: params.get('light') === 'room' ? 'room' : 'studio',
    count: params.get('count') === '7' ? 7 : 1,
    sound: params.get('sound') !== 'off',
  };
}

function href(state: StudyState): string {
  const q = new URLSearchParams({
    material: state.material,
    signal: state.signal,
    mark: state.mark,
    shape: state.shape,
    motion: motionParam(state.motion),
    status: state.status,
    source: state.source,
    light: state.light,
    count: String(state.count),
    sound: state.sound ? 'on' : 'off',
  });
  return `/hud-gallery/agent-material?${q.toString()}`;
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

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 w-[7.5rem] font-mono text-chrome-micro uppercase tracking-[0.18em] text-white/40">
        {label}
      </span>
      {children}
    </div>
  );
}

export function AgentMaterialStudy() {
  const searchParams = useSearchParams();
  const state = useMemo(() => readState(searchParams), [searchParams]);
  const theme = useMemo(() => heroBoardTheme('classic'), []);
  const reducedMotion = usePrefersReducedMotion();
  const router = useRouter();
  const model = useMemo(
    () => clusterModel(state.status, state.source),
    [state.status, state.source]
  );
  const count = state.count;

  // A still story: the working stage's framing, nothing lifted.
  const drive = useRef<StoryDrive>({
    progress: 1,
    base: count,
    count,
    highlights: STAGES.map(() => null),
    exemplar: -1,
    selected: -1,
    rate: 4.5,
    rail: 1,
    moving: 0,
  });
  useEffect(() => {
    drive.current.base = count;
    drive.current.count = count;
  }, [count]);
  const anchor = useRef(new VisualAnchor());

  // Hover to feel it, click to open it, click it again to close it.
  const [openAgent, setOpenAgent] = useState(-1);
  const onHoverChange = useCallback(() => {}, []);
  const onSelect = useCallback((agent: number) => {
    setOpenAgent(previous => (agent === previous ? -1 : agent));
  }, []);
  // An agent the cluster no longer has cannot stay open.
  const selected = openAgent >= 0 && openAgent < count ? openAgent : -1;
  useEffect(() => {
    drive.current.selected = selected;
  }, [selected]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenAgent(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selectedAgent = selected >= 0 ? model.agents[selected] : null;
  // A lone agent's empty slots answer the pointer; a press on one fills the
  // cluster (operator 2026-10-13: "Add an affordance to click one of the
  // unfinished tombstone agents when I'm in one-agent mode to transition to
  // seven-agent mode").
  const expand = useCallback(
    () => router.replace(href({ ...state, count: 7 }), { scroll: false }),
    [router, state]
  );

  return (
    <main
      className="min-h-screen bg-[#04060b] font-ui text-white"
      data-agent-material-study
      data-public-exhibition-surface="true"
    >
      <div className="flex flex-col gap-4 px-4 py-4 lg:flex-row lg:items-start">
        {/* On a phone the controls scroll beneath the pinned stage (the stage
            is first, below), so a tap on any option changes a scene that is
            still in view. From `lg` up they stand beside it, as before. */}
        <div className="order-2 flex w-full flex-col gap-2 lg:order-1 lg:w-[26rem] lg:shrink-0">
          <p className="mb-2 font-mono text-chrome-micro text-white/50">
            <Link href="/hud-gallery" className="hover:text-white">
              HUD Gallery
            </Link>{' '}
            / <span className="text-white">Agent material</span>
          </p>
          <Row label="Material">
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
          </Row>
          <Row label="Signal">
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
          </Row>
          <Row label="Harness mark">
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
          </Row>
          <Row label="Shape">
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
          </Row>
          <Row label="Working">
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
          </Row>
          <Row label="Working lift">
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
          </Row>
          <Row label="Status">
            {STATUS_ORDER.map(status => (
              <Option
                key={status}
                active={status === state.status}
                href={href({ ...state, status })}
              >
                {STATUS_LABEL[status]}
              </Option>
            ))}
          </Row>
          <Row label="Harness">
            {CLUSTER_SOURCES.map(source => (
              <Option
                key={source}
                active={source === state.source}
                href={href({ ...state, source })}
              >
                {source}
              </Option>
            ))}
          </Row>
          <Row label="Light">
            <Option
              active={state.light === 'studio'}
              href={href({ ...state, light: 'studio' })}
              title="A dark box with a few bright strips. Metal shows a band; glass gets one sharp highlight."
            >
              Studio
            </Option>
            <Option
              active={state.light === 'room'}
              href={href({ ...state, light: 'room' })}
              title="The soft grey room the homepage study lights with today."
            >
              Site
            </Option>
          </Row>
          <Row label="Agents">
            <Option
              active={state.count === 1}
              href={href({ ...state, count: 1 })}
            >
              1
            </Option>
            <Option
              active={state.count === 7}
              href={href({ ...state, count: 7 })}
            >
              7
            </Option>
          </Row>
          <Row label="Sound">
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
          </Row>
          <p className="mt-4 max-w-[36ch] text-[13px] leading-relaxed text-white/45">
            The same renderer as the homepage study, one cluster, close. Drag to
            orbit. Hover to feel it, press it, click it to open it. Around one
            agent, click an outlined slot to fill the cluster. What is decided
            here lands in the scroll unchanged.
          </p>
        </div>

        <div
          className="sticky top-12 z-10 order-1 h-[52svh] min-h-[240px] w-full select-none overflow-hidden rounded-xl border border-white/10 bg-[#04060b] [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] lg:relative lg:top-auto lg:z-auto lg:order-2 lg:h-[calc(100svh-5rem)] lg:min-h-[420px]"
          data-agent-material-stage
        >
          <VisualCanvas
            visual="crust"
            model={model}
            theme={theme}
            drive={drive}
            anchor={anchor.current}
            reducedMotion={reducedMotion}
            visible
            material={state.material}
            mark={state.mark}
            shape={state.shape}
            motion={state.motion}
            signal={state.signal}
            light={state.light}
            closeUp
            onExpand={expand}
            expandable={count === 1}
            sound={state.sound}
            onHoverChange={onHoverChange}
            onSelect={onSelect}
          />
          <PinnedAgentPanel
            agent={selectedAgent}
            theme={theme}
            anchor={anchor.current}
            column={0}
            insetTop={12}
            insetBottom={32}
            narrowSlack={0}
            reducedMotion={reducedMotion}
          />
          <p className="pointer-events-none absolute bottom-3 left-4 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
            Demo workspace · synthetic agent
          </p>
        </div>
      </div>
    </main>
  );
}
