'use client';

/**
 * Agent material study (ENG-031 W15d, operator 2026-10-09: "the materials /
 * single-agent study should be separate, so we can nail that down
 * independently of the motion scroll / homepage experience").
 *
 * One cluster, close, in the exact renderer the homepage study uses, with
 * every dial on the agent itself: material, signal treatment, kind marks,
 * the hero's status and harness, subagents, the reflection room, and how
 * many agents stand around it. Drag to orbit. Hover to feel it. Click to
 * open it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { StatusLightState } from '@/components/status-light/protocol';
import { heroBoardTheme } from '@/components/site/hero-board/hero-board-theme';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import { AgentPanel } from '../homepage-study/agent-panel';
import { STATUS_LABEL } from '../homepage-study/fleet-model';
import {
  STATUS_ORDER,
  VisualAnchor,
  type StoryDrive,
} from '../homepage-study/visual-contract';
import { VisualCanvas } from '../homepage-study/visual-canvas';
import {
  CRUST_MATERIALS,
  type CrustMaterialId,
} from '../homepage-study/visuals/crust-materials';
import {
  CRUST_SIGNALS,
  type CrustSignalId,
} from '../homepage-study/visuals/crust-signal';
import type { EnvironmentKind } from '../homepage-study/visuals/environment';
import { CLUSTER_SOURCES, clusterModel } from './cluster-model';

interface StudyState {
  material: CrustMaterialId;
  signal: CrustSignalId;
  marks: boolean;
  status: StatusLightState;
  source: string;
  children: boolean;
  light: EnvironmentKind;
  count: 1 | 7;
}

function readState(params: URLSearchParams): StudyState {
  const material = params.get('material');
  const signal = params.get('signal');
  const status = params.get('status');
  const source = params.get('source');
  return {
    material: CRUST_MATERIALS.some(m => m.id === material)
      ? (material as CrustMaterialId)
      : 'gummy',
    signal: CRUST_SIGNALS.some(x => x.id === signal)
      ? (signal as CrustSignalId)
      : 'paint',
    marks: params.get('marks') !== 'off',
    status: STATUS_ORDER.includes(status as StatusLightState)
      ? (status as StatusLightState)
      : 'active',
    source: (CLUSTER_SOURCES as readonly string[]).includes(source ?? '')
      ? (source as string)
      : 'Claude Code',
    children: params.get('children') === 'on',
    light: params.get('light') === 'room' ? 'room' : 'studio',
    count: params.get('count') === '7' ? 7 : 1,
  };
}

function href(state: StudyState): string {
  const q = new URLSearchParams({
    material: state.material,
    signal: state.signal,
    marks: state.marks ? 'on' : 'off',
    status: state.status,
    source: state.source,
    children: state.children ? 'on' : 'off',
    light: state.light,
    count: String(state.count),
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
  const [extra, setExtra] = useState(0);
  const model = useMemo(
    () => clusterModel(state.status, state.source, state.children),
    [state.status, state.source, state.children]
  );
  const count = Math.min(7, state.count + extra);

  // A still story: the working stage's framing, nothing lifted, no recede.
  const drive = useRef<StoryDrive>({
    progress: 1,
    base: count,
    count,
    highlights: [null, null, null, null, null, null, null],
    exemplar: -1,
    selected: -1,
    rail: 1,
    recede: 0,
  });
  useEffect(() => {
    drive.current.base = count;
    drive.current.count = count;
  }, [count]);
  const anchor = useRef(new VisualAnchor());

  // Hover to feel it, click to open it.
  const [selected, setSelected] = useState(-1);
  const hoverRef = useRef(-1);
  const pressRef = useRef({ x: 0, y: 0 });
  const onHoverChange = useCallback((agent: number) => {
    hoverRef.current = agent;
  }, []);
  const press = useCallback((e: React.PointerEvent) => {
    pressRef.current.x = e.clientX;
    pressRef.current.y = e.clientY;
  }, []);
  const release = useCallback((e: React.PointerEvent) => {
    const moved =
      Math.abs(e.clientX - pressRef.current.x) +
      Math.abs(e.clientY - pressRef.current.y);
    if (moved > 6) return;
    setSelected(hoverRef.current);
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

  const stageRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const a = anchor.current;
      const focus = focusRef.current;
      const stageEl = stageRef.current;
      if (!focus || !stageEl) return;
      if (a.focusPoint && a.focus >= 0) {
        const toLeft = a.focusPoint.x > stageEl.clientWidth * 0.62;
        focus.style.opacity = '1';
        focus.style.pointerEvents = 'auto';
        focus.style.transform = toLeft
          ? `translate(${a.focusPoint.x - 22}px, ${a.focusPoint.y}px) translate(-100%, -50%)`
          : `translate(${a.focusPoint.x + 22}px, ${a.focusPoint.y}px) translate(0, -50%)`;
      } else {
        focus.style.opacity = '0';
        focus.style.pointerEvents = 'none';
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const selectedAgent = selected >= 0 ? model.agents[selected] : null;
  const expand = useCallback(() => setExtra(value => value + 1), []);

  return (
    <main
      className="min-h-screen bg-[#04060b] font-ui text-white"
      data-agent-material-study
      data-public-exhibition-surface="true"
    >
      <div className="flex flex-col gap-4 px-4 py-4 lg:flex-row lg:items-start">
        <div className="flex w-full flex-col gap-2 lg:w-[26rem] lg:shrink-0">
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
          <Row label="Kind marks">
            <Option active={state.marks} href={href({ ...state, marks: true })}>
              On
            </Option>
            <Option
              active={!state.marks}
              href={href({ ...state, marks: false })}
            >
              Off
            </Option>
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
          <Row label="Subagents">
            <Option
              active={state.children}
              href={href({ ...state, children: true })}
            >
              On
            </Option>
            <Option
              active={!state.children}
              href={href({ ...state, children: false })}
            >
              Off
            </Option>
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
            {extra > 0 ? (
              <span className="ml-1 font-mono text-chrome-micro text-white/50">
                +{extra}
              </span>
            ) : null}
          </Row>
          <p className="mt-4 max-w-[36ch] text-[13px] leading-relaxed text-white/45">
            The same renderer as the homepage study, one cluster, close. Drag to
            orbit. Hover to feel it. Click an agent to open it, an outlined slot
            to add one. What is decided here lands in the scroll unchanged.
          </p>
        </div>

        <div
          ref={stageRef}
          className="relative h-[70svh] min-h-[420px] w-full overflow-hidden rounded-xl border border-white/10 bg-[#04060b] lg:h-[calc(100svh-5rem)]"
          onPointerDown={press}
          onPointerUp={release}
          data-agent-material-stage
        >
          <VisualCanvas
            key={`${state.status}-${state.source}-${state.children}`}
            visual="crust"
            model={model}
            theme={theme}
            drive={drive}
            anchor={anchor.current}
            reducedMotion={reducedMotion}
            visible
            material={state.material}
            marks={state.marks}
            signal={state.signal}
            light={state.light}
            closeUp
            onExpand={expand}
            onHoverChange={onHoverChange}
          />
          <div
            ref={focusRef}
            className="absolute left-0 top-0 opacity-0 transition-opacity duration-150 will-change-transform"
            onPointerDown={e => e.stopPropagation()}
            onPointerUp={e => e.stopPropagation()}
          >
            {selectedAgent ? (
              <AgentPanel agent={selectedAgent} theme={theme} />
            ) : null}
          </div>
          <p className="pointer-events-none absolute bottom-3 left-4 font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
            Demo workspace · synthetic agent
          </p>
        </div>
      </div>
    </main>
  );
}
