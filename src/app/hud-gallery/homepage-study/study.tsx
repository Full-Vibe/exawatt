'use client';

/**
 * Homepage study (ENG-031 W15): the design partner's scroll structure over
 * three candidate fleet visuals, switchable on the page, judged at four
 * fleet sizes and under two copy sets.
 *
 * One row of controls and then the page. Scroll it. Drag the visual to turn
 * it. Click a ghost tile to add an agent.
 */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { FLEET_COUNTS, FLEET_MAX } from './fleet-model';
import { ScrollExperience } from './scroll-experience';
import type { CopySetId } from './stages';
import { VISUALS, type VisualId } from './visual-contract';
import {
  CRUST_MATERIALS,
  type CrustMaterialId,
} from './visuals/crust-materials';

interface StudyState {
  visual: VisualId;
  count: number;
  copy: CopySetId;
  material: CrustMaterialId;
  marks: boolean;
}

function readState(params: URLSearchParams): StudyState {
  const visual = params.get('visual');
  const count = Number(params.get('count'));
  const copy = params.get('copy');
  const material = params.get('material');
  return {
    material: CRUST_MATERIALS.some(m => m.id === material)
      ? (material as CrustMaterialId)
      : 'matte',
    marks: params.get('marks') !== 'off',
    visual: VISUALS.some(v => v.id === visual) ? (visual as VisualId) : 'crust',
    count:
      Number.isFinite(count) && count >= 1
        ? Math.min(FLEET_MAX, Math.round(count))
        : 10,
    copy: copy === 'deck' ? 'deck' : 'canon',
  };
}

function href(state: StudyState): string {
  return `/hud-gallery/homepage-study?visual=${state.visual}&count=${state.count}&copy=${state.copy}&material=${state.material}&marks=${state.marks ? 'on' : 'off'}`;
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = useMemo(() => readState(searchParams), [searchParams]);
  const [extra, setExtra] = useState(0);
  const count = Math.min(FLEET_MAX, state.count + extra);

  const expand = useCallback(() => setExtra(value => value + 1), []);
  const setCount = useCallback(
    (value: number) => {
      setExtra(0);
      router.replace(href({ ...state, count: value }), { scroll: false });
    },
    [router, state]
  );

  return (
    <main
      className="min-h-screen bg-[#04060b] font-ui text-white"
      data-homepage-study
      data-public-exhibition-surface="true"
    >
      <div className="sticky top-12 z-30 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-white/10 bg-[#04060b]/90 px-4 py-2 backdrop-blur">
        <p className="font-mono text-chrome-micro text-white/50">
          <Link href="/hud-gallery" className="hover:text-white">
            HUD Gallery
          </Link>{' '}
          / <span className="text-white">Homepage study</span>
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
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
                  Kind marks
                </span>
                <Option
                  active={state.marks}
                  href={href({ ...state, marks: true })}
                  title="The inlay is a glyph for the harness: hexagon Claude Code, open ring Codex, triangle OpenCode, square Grok Build, ring OpenClaw, bar Antigravity."
                >
                  On
                </Option>
                <Option
                  active={!state.marks}
                  href={href({ ...state, marks: false })}
                  title="Every agent wears the hexagon."
                >
                  Off
                </Option>
              </div>
            </>
          ) : null}
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-chrome-micro uppercase tracking-[0.18em] text-white/40">
              Fleet
            </span>
            {FLEET_COUNTS.map(value => (
              <button
                key={value}
                type="button"
                onClick={() => setCount(value)}
                aria-current={value === state.count ? 'true' : undefined}
                className={cn(
                  'rounded border px-2 py-1 font-mono text-chrome-micro transition-colors',
                  value === state.count
                    ? 'border-white bg-white text-black'
                    : 'border-white/15 text-white/70 hover:bg-white/10'
                )}
              >
                {value}
              </button>
            ))}
            {extra > 0 ? (
              <span className="ml-1 font-mono text-chrome-micro text-white/50">
                +{extra} · {count}
              </span>
            ) : null}
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
        key={`${state.visual}-${state.copy}`}
        visual={state.visual}
        baseCount={count}
        copySet={state.copy}
        material={state.material}
        marks={state.marks}
        onExpand={expand}
      />

      <footer className="border-t border-white/10 px-6 py-8 text-[13px] text-white/45">
        <p className="max-w-[60ch]">
          Structure from the design partner&apos;s deck, slides 15 to 21. Three
          visuals on one synthetic fleet, laid out once at 300 agents so a
          smaller fleet is a prefix of the same layout and growth never moves an
          agent. Drag to turn. Click an outlined tile to add one.
        </p>
      </footer>
    </main>
  );
}
