'use client';

import type { ReactNode } from 'react';
import { FleetProvider } from '@/lib/fleet/fleet-provider';

/**
 * Render fixtures own constant source inputs. R3F bridges ancestor contexts,
 * so the app's unrelated Demo clock otherwise repaints even a frozen fixture
 * once per second. Shadow that source here using its existing test contract;
 * production routes retain the normal live Demo transport and cadence.
 */
export function FixtureSourceBoundary({ children }: { children: ReactNode }) {
  return <FleetProvider demoSimulationTickMs={0}>{children}</FleetProvider>;
}
