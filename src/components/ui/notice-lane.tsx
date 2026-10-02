'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// Presentation slots only. Each caller still owns its operation and lifetime.
// DOM order matches visual/keyboard order; update actions remain before hints.
const LANES = ['update', 'hint', 'chord'] as const;
type NoticeLane = (typeof LANES)[number];
type Targets = Partial<Record<NoticeLane, HTMLDivElement | null>>;
const NoticeLaneContext = createContext<Targets | null>(null);

export function NoticeLaneProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<Targets>({});
  const refs = useMemo(
    () =>
      Object.fromEntries(
        LANES.map(lane => [
          lane,
          (element: HTMLDivElement | null) => {
            setTargets(previous => ({ ...previous, [lane]: element }));
          },
        ])
      ) as Record<NoticeLane, (element: HTMLDivElement | null) => void>,
    []
  );

  return (
    <NoticeLaneContext.Provider value={targets}>
      {children}
      <div
        data-notice-lane
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-h-[calc(100dvh-6rem)] w-[min(42rem,calc(100%-2rem))] flex-col gap-2 overflow-y-auto overscroll-contain"
      >
        {LANES.map(lane => (
          <div
            key={lane}
            ref={refs[lane]}
            data-notice-slot={lane}
            className="shrink-0 empty:hidden"
          />
        ))}
      </div>
    </NoticeLaneContext.Provider>
  );
}

export function NoticeLaneItem({
  lane,
  children,
}: {
  lane: NoticeLane;
  children: ReactNode;
}) {
  const targets = useContext(NoticeLaneContext);
  if (targets === null) {
    // Standalone rendering, e.g. focused component tests or an isolated study.
    return (
      <div className="fixed bottom-4 right-4 z-[100] w-[min(42rem,calc(100%-2rem))]">
        {children}
      </div>
    );
  }
  const target = targets[lane];
  return target
    ? createPortal(
        <div className="pointer-events-auto">{children}</div>,
        target
      )
    : null;
}
