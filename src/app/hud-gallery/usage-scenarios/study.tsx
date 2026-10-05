'use client';

/**
 * Usage scenario workbench (ENG-008 E15).
 *
 * Every named scenario from `usage-scenarios.ts`, rendered through the
 * production Overview body and the production chrome meter, with a time
 * scrubber and a burn multiplier that run the scenario forward through the
 * same simulator the tests use. Replaces the E12 directions study and the E9
 * pace-opportunity study, whose subjects shipped as the account cards.
 *
 * Deep links: `?s=<scenario>&h=<hours ahead>&burn=<multiplier>`.
 */
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import {
  CONSUMPTION_CHROME as CHROME,
} from '@/components/consumption/flux';
import { AmbientMeterControl } from '@/components/consumption/meter/ambient-meter-chrome';
import { UsageOverviewBody } from '@/components/consumption/usage-overview';
import {
  SCENARIO_TIME_ZONE,
  USAGE_SCENARIOS,
  advanceScenario,
  scenarioOverview,
  usageScenario,
} from '@/components/consumption/usage-scenarios';

const BURNS = [0.5, 1, 2, 3] as const;
const MAX_HOURS = 120;

function clampHours(raw: string | null): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_HOURS, Math.round(n))) : 0;
}

function parseBurn(raw: string | null): number {
  const n = Number(raw ?? 1);
  return (BURNS as readonly number[]).includes(n) ? n : 1;
}

export function UsageScenariosStudy() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const base = usageScenario(params.get('s'));
  const hours = clampHours(params.get('h'));
  const burn = parseBurn(params.get('burn'));
  const overview = useMemo(
    () => scenarioOverview(advanceScenario(base, hours, burn)),
    [base, hours, burn]
  );
  const phrase = { timeZone: SCENARIO_TIME_ZONE };

  const href = (next: { s?: string; h?: number; burn?: number }) => {
    const q = new URLSearchParams({
      s: next.s ?? base.id,
      h: String(next.h ?? hours),
      burn: String(next.burn ?? burn),
    });
    return `${pathname}?${q.toString()}`;
  };

  return (
    <main
      data-usage-scenarios
      data-usage-scenario={base.id}
      className="min-h-svh font-ui"
      style={{ background: CHROME.canvas, color: CHROME.text }}
    >
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-6 py-8 lg:flex-row lg:items-start">
        <aside className="flex shrink-0 flex-col gap-4 lg:sticky lg:top-8 lg:w-72">
          <div>
            <Link
              href="/hud-gallery"
              className="text-chrome-meta underline underline-offset-4"
              style={{ color: CHROME.textDim }}
            >
              HUD gallery
            </Link>
            <h1 className="mt-2 text-surface-title font-semibold">
              Usage scenarios
            </h1>
          </div>

          <nav aria-label="Scenarios" className="flex flex-col gap-1">
            {USAGE_SCENARIOS.map(s => (
              <Link
                key={s.id}
                href={href({ s: s.id, h: 0, burn: 1 })}
                aria-current={s.id === base.id ? 'page' : undefined}
                className="rounded px-2 py-1.5 text-sm outline-none hover:bg-[var(--exa-hud-fill)] focus-visible:ring-1 focus-visible:ring-[var(--exa-foundation-focus)]"
                style={{
                  color: s.id === base.id ? CHROME.text : CHROME.textDim,
                  background: s.id === base.id ? 'var(--exa-hud-fill)' : undefined,
                }}
              >
                {s.title}
              </Link>
            ))}
          </nav>

          <p className="text-chrome-meta" style={{ color: CHROME.textDim }}>
            {base.shows}
          </p>

          <label className="flex flex-col gap-1.5">
            <span className="text-chrome-meta" style={{ color: CHROME.textDim }}>
              {hours === 0 ? 'Now' : `${hours} hours later`}
            </span>
            <input
              type="range"
              min={0}
              max={MAX_HOURS}
              step={1}
              value={hours}
              aria-label="Hours ahead"
              data-usage-scrubber
              onChange={e =>
                router.replace(href({ h: Number(e.currentTarget.value) }), {
                  scroll: false,
                })
              }
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-chrome-meta" style={{ color: CHROME.textDim }}>
              Burn rate
            </span>
            <div className="flex gap-1">
              {BURNS.map(b => (
                <Link
                  key={b}
                  href={href({ burn: b })}
                  scroll={false}
                  aria-current={b === burn ? 'true' : undefined}
                  className="rounded border px-2 py-0.5 text-chrome-meta"
                  style={{
                    borderColor: b === burn ? CHROME.borderStrong : CHROME.border,
                    color: b === burn ? CHROME.text : CHROME.textDim,
                  }}
                >
                  {b}×
                </Link>
              ))}
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-6">
          <div
            data-usage-scenario-chrome
            className="flex h-9 items-center justify-end rounded-md border px-2"
            style={{ borderColor: CHROME.border }}
          >
            <AmbientMeterControl overview={overview} href="#" />
          </div>
          <div className="flex max-w-3xl flex-col gap-6">
            <UsageOverviewBody
              overview={overview}
              phrase={phrase}
              // Simulated: the workbench never spends a real reset.
              onUseReset={async () => 'reset'}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
