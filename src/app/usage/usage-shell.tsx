'use client';

/**
 * The frame both Usage tabs share (ENG-008 E15): the title, the Overview /
 * Analytics tabs, and the one read-state banner. Tabs are real routes so the
 * app's back stack (⌘[ / ⌘]) walks them like any other location.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CONSUMPTION_SURFACE_NAME } from '@exawatt/core';
import { CONSUMPTION_CHROME as CHROME } from '@/components/consumption/flux';
import type { TenantConsumption } from '@/components/consumption/use-tenant-consumption';
import { DemoBanner, EngineStoppedBanner, LiveScanNotice } from './chrome';

type UsageTab = 'overview' | 'analytics';

const TABS: ReadonlyArray<{ id: UsageTab; label: string; href: string }> = [
  { id: 'overview', label: 'Overview', href: '/usage' },
  { id: 'analytics', label: 'Analytics', href: '/usage/analytics' },
];

export function UsageShell({
  tab,
  tenant,
  width = 'reading',
  children,
}: {
  tab: UsageTab;
  tenant: TenantConsumption;
  /** Overview reads like a settings page; Analytics needs the wide grid. */
  width?: 'reading' | 'wide';
  children: ReactNode;
}) {
  return (
    <main
      data-consumption-surface
      data-usage-tab={tab}
      className="min-h-svh font-ui"
      style={{ background: CHROME.canvas, color: CHROME.text }}
    >
      <div
        className={`mx-auto flex w-full flex-col gap-6 px-6 pb-16 pt-8 sm:px-8 ${
          width === 'wide' ? 'max-w-[1280px]' : 'max-w-3xl'
        }`}
      >
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <h1 className="text-surface-title font-semibold tracking-tight">
            {CONSUMPTION_SURFACE_NAME}
          </h1>
          <nav aria-label="Usage views" className="flex items-center gap-1">
            {TABS.map(t => {
              const active = t.id === tab;
              return (
                <Link
                  key={t.id}
                  href={t.href}
                  aria-current={active ? 'page' : undefined}
                  className="rounded-full px-3 py-1 text-sm outline-none transition-colors hover:bg-[var(--exa-hud-fill)] focus-visible:ring-1 focus-visible:ring-[var(--exa-foundation-focus)] motion-reduce:transition-none"
                  style={{
                    color: active ? CHROME.text : CHROME.textDim,
                    background: active ? 'var(--exa-hud-fill)' : undefined,
                  }}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </header>

        {/* Three read states, three presentations (BUG-016): no bridge is
            a demo corpus, a bridge whose engine is not running is neither a
            demo nor a read, and a live read only speaks while partial. */}
        {!tenant.live ? (
          <DemoBanner voltaic={tenant.voltaic} />
        ) : tenant.stopped ? (
          <EngineStoppedBanner />
        ) : (
          <LiveScanNotice scan={tenant.scan} />
        )}

        {children}
      </div>
    </main>
  );
}
