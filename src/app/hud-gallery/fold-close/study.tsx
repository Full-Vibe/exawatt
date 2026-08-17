'use client';

/**
 * Fold and close copy study (ENG-031 W3, reframed W3b).
 *
 * FOUR complete arrangements of the fold and the closing band, at real type
 * scale, in the real band components, under the real sticky header. Not a
 * mock: this page renders `BandSection` + `FoldHero` + `CloseBand` exactly as
 * the homepage will, so what the operator reads here is what ships.
 *
 * All four are developments of ONE frame, the operator's own draft: today into
 * tomorrow, the tools as the bottleneck, the team's fleets, one direct CTA.
 * The copy and the reasoning live in `fold-copy.ts`.
 *
 * The chrome is one row of pills on purpose. The operator does not want to
 * read a page of explanation to evaluate a page.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BandSection } from '@/components/site/bands/band-section';
import { CloseBand } from '@/components/site/bands/close-band';
import { FOLD_BAND_CLASS } from '@/components/site/bands/fold-band';
import {
  DEFAULT_FOLD_CLOSE_VARIANT,
  FOLD_CLOSE_VARIANTS,
  closeBudget,
  closeWords,
  foldBudget,
  foldCloseVariant,
  foldWords,
  type FoldCloseVariantId,
} from '@/components/site/bands/fold-copy';
import { FoldHero } from '@/components/site/bands/fold-hero';
import { bandById } from '@/components/site/bands/manifest';
import { cn } from '@/lib/utils';

const FOLD = bandById('fold');
const CLOSE = bandById('close');

function variantId(value: string | null): FoldCloseVariantId | null {
  return FOLD_CLOSE_VARIANTS.some(variant => variant.id === value)
    ? (value as FoldCloseVariantId)
    : null;
}

function href(fold: FoldCloseVariantId, close: FoldCloseVariantId): string {
  return `/hud-gallery/fold-close?v=${fold}&close=${close}`;
}

export function FoldCloseStudy() {
  const searchParams = useSearchParams();

  const { fold, close } = useMemo(() => {
    const selected =
      variantId(searchParams.get('v')) ?? DEFAULT_FOLD_CLOSE_VARIANT;
    return {
      fold: selected,
      // The closing line follows the fold unless it is overridden. Overriding
      // it is a real question and it stays independent: any fold can be read
      // against any of the four closing lines, including the two that carry
      // the thesis at 72px.
      close: variantId(searchParams.get('close')) ?? selected,
    };
  }, [searchParams]);

  const foldCopy = foldCloseVariant(fold);
  const closeCopy = foldCloseVariant(close);

  return (
    <main
      className="bg-black"
      data-fold-close-study={fold}
      data-public-exhibition-surface="true"
    >
      <BandSection band={FOLD} className={FOLD_BAND_CLASS}>
        <FoldHero variant={fold} />
      </BandSection>

      <CloseBand band={CLOSE} variant={close} />

      <div
        className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4"
        data-fold-close-switch
      >
        <div className="pointer-events-auto flex max-w-[min(100%,64rem)] flex-col items-center gap-2 rounded-2xl border border-white/15 bg-black/85 px-3 py-2.5 text-white shadow-2xl backdrop-blur">
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <Pills
              label="Fold"
              current={fold}
              hrefFor={id => href(id, close === fold ? id : close)}
            />
            <span className="mx-1 hidden h-5 w-px bg-white/15 sm:block" />
            <Pills
              label="Close"
              current={close}
              hrefFor={id => href(fold, id)}
              short
            />
          </div>
          <p className="text-center font-mono text-chrome-micro text-white/45">
            {foldWords(foldCopy)}/{foldBudget()} words above the fold ·{' '}
            {closeWords(closeCopy)}/{closeBudget()} at the close ·{' '}
            {foldCopy.note}
          </p>
        </div>
      </div>
    </main>
  );
}

function Pills({
  label,
  current,
  hrefFor,
  short = false,
}: {
  label: string;
  current: FoldCloseVariantId;
  hrefFor: (id: FoldCloseVariantId) => string;
  short?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="pr-1 font-mono text-chrome-micro text-white/40">
        {label}
      </span>
      {FOLD_CLOSE_VARIANTS.map(variant => (
        <Link
          className={cn(
            'rounded-full px-2.5 py-1 text-chrome-label transition-colors',
            variant.id === current
              ? 'bg-white text-black'
              : 'text-white/70 hover:bg-white/10 hover:text-white'
          )}
          data-fold-close-pill={`${label.toLowerCase()}-${variant.id}`}
          data-active={variant.id === current ? 'true' : undefined}
          href={hrefFor(variant.id)}
          key={variant.id}
          scroll={false}
        >
          <span className="font-mono">{variant.id.toUpperCase()}</span>
          {short ? null : (
            <span className="ml-1.5 hidden sm:inline">{variant.name}</span>
          )}
        </Link>
      ))}
    </div>
  );
}
