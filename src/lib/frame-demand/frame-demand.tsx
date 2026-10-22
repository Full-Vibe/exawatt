'use client';

/**
 * The React and R3F side of the frame scheduler (`frame-scheduler.ts`).
 *
 * Outside the `<Canvas>`, `useCanvasFrames(policy)` owns one scheduler per
 * canvas and the `frameloop` prop that goes with the policy. Inside it,
 * `<FrameDemandRoot>` hands the scheduler the canvas's `invalidate`, reports
 * every painted frame and provides the scheduler to the layers, which hold
 * claims through the hooks below and never call `invalidate()` themselves.
 */

import { useFrame, useThree } from '@react-three/fiber';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useHostRenderPolicy } from '@/lib/host-power/use-host-render-policy';
import {
  createFrameScheduler,
  resolveFramePolicy,
  type AmbientCadence,
  type FrameDemand,
  type FrameDemandDetail,
  type FrameDemandKind,
  type FramePolicy,
  type FrameScheduler,
} from './frame-scheduler';

/** One canvas's policy from the host facts every canvas shares: page
 * visibility, host lock and sleep, battery, plus what the owner knows. */
export function useFramePolicy({
  reduced,
  lowPower,
  frozen = false,
  onscreen = true,
}: {
  reduced: boolean;
  lowPower: boolean;
  frozen?: boolean;
  /** The canvas is inside the viewport (an IntersectionObserver's answer). */
  onscreen?: boolean;
}): FramePolicy {
  const host = useHostRenderPolicy();
  const { render, ambient } = resolveFramePolicy({
    seen: host.renderAllowed && onscreen,
    ambientSeen: host.ambientAllowed && onscreen,
    reduced,
    frozen,
    lowPower,
    onBattery: host.onBattery,
  });
  // Identity follows the two facts, so an unrelated host push re-arms nothing.
  return useMemo(() => ({ render, ambient }), [render, ambient]);
}

/** The scheduler for one canvas and its `frameloop`: `'never'` whenever the
 * policy says nobody can see it, so nothing at all can paint it then. */
export function useCanvasFrames(policy: FramePolicy): {
  scheduler: FrameScheduler;
  frameloop: 'demand' | 'never';
} {
  const [scheduler] = useState(() => createFrameScheduler(policy));
  useLayoutEffect(() => {
    scheduler.setPolicy(policy);
  }, [scheduler, policy]);
  useEffect(() => () => scheduler.dispose(), [scheduler]);
  return { scheduler, frameloop: policy.render ? 'demand' : 'never' };
}

const FrameSchedulerContext = createContext<FrameScheduler | null>(null);

/** Mount once, first, inside a demand `<Canvas>`. */
export function FrameDemandRoot({
  scheduler,
  children,
}: {
  scheduler: FrameScheduler;
  children?: ReactNode;
}) {
  const invalidate = useThree(state => state.invalidate);
  useLayoutEffect(() => scheduler.attach(invalidate), [scheduler, invalidate]);
  useFrame(() => scheduler.frame(performance.now()));
  return (
    <FrameSchedulerContext.Provider value={scheduler}>
      {children}
    </FrameSchedulerContext.Provider>
  );
}

export function useFrameScheduler(): FrameScheduler {
  const scheduler = useContext(FrameSchedulerContext);
  if (!scheduler) {
    throw new Error('A frame-demand layer rendered outside <FrameDemandRoot>.');
  }
  return scheduler;
}

/** A claim held for the layer's lifetime; `initial` holds it from mount
 * (an entrance that starts with the layer). */
export function useFrameDemand(
  kind: FrameDemandKind,
  label: string,
  {
    initial = false,
    detail,
  }: { initial?: boolean; detail?: FrameDemandDetail } = {}
): FrameDemand {
  const scheduler = useFrameScheduler();
  const [demand] = useState(() => scheduler.demand(kind, label, detail));
  // Read at mount only, as its name says.
  const held = useRef(initial);
  useLayoutEffect(() => {
    if (held.current) demand.set(true);
    return () => demand.dispose();
  }, [demand]);
  return demand;
}

/** An ambient claim that follows data: held while `active`. */
export function useAmbientDemand(
  label: string,
  active: boolean,
  detail?: FrameDemandDetail
): FrameDemand {
  const demand = useFrameDemand('ambient', label, { detail });
  useLayoutEffect(() => {
    demand.set(active);
  }, [demand, active]);
  return demand;
}

/** One frame whenever `value` changes identity (a theme, a model). */
export function usePaintOnChange(value: unknown): void {
  const scheduler = useFrameScheduler();
  useEffect(() => {
    scheduler.request();
  }, [scheduler, value]);
}

/** The ambient cadence for React readers (a prop that must follow it). */
export function useAmbientCadence(): AmbientCadence {
  const scheduler = useFrameScheduler();
  return useSyncExternalStore(
    scheduler.subscribe,
    () => scheduler.policy.ambient,
    () => scheduler.policy.ambient
  );
}
