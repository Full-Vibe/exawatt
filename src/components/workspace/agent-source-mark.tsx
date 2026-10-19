'use client';

/**
 * THE ONE WAY A SURFACE DRAWS AN AGENT SOURCE'S MARK (BUG-292, BUG-293).
 *
 * Every product surface that shows which harness runs an Agent (the ⌘T
 * launcher, Team tiles, the tab strip, Chatter, Direct, ⌘K, Settings, the
 * Start screen) renders `AgentSourceMark` with the source id and nothing
 * else. The component owns the three decisions that used to be made at each
 * call site, and so used to disagree:
 *
 * - **Identity** comes from one place, `agentSourceIdentity`: the declared
 *   Agent Source (`contracts/agent-sources.json`), the shell, the catalog's
 *   coming-soon entries, or an undeclared id a saved record outlived. A caller
 *   cannot pass a colour, so no surface can paint a mark in a Project colour
 *   or a ledger's colour.
 * - **Glyph**: the vendor's own mark where Exawatt may draw one
 *   (`harness-icons.tsx`), the terminal for the shell, a neutral sparkle for a
 *   declared source without a vendor mark, a question mark for an id this
 *   build does not know.
 * - **Paint**, under the design system's Agent Source identity rung: on the
 *   fixed dark instrument plate (`plate`) the brand colour always reads; bare
 *   on the ground, the brand colour is used only where it clears
 *   `MARK_MINIMUM_CONTRAST` against every ground of the ACTIVE theme, and
 *   otherwise the mark takes the theme's quiet ink. Codex's near-white colour is
 *   the case that made this a rule: drawn straight onto Air it vanished.
 */

import {
  CircleHelp,
  LoaderCircle,
  Sparkles,
  TerminalSquare,
} from 'lucide-react';
import { useActiveTheme } from '@/components/appearance/active-theme';
import { cn } from '@/lib/utils';
import {
  agentSourceIdentity,
  bareMarkPaint,
  SOURCE_IDENTITY_BACKPLATE,
  SOURCE_IDENTITY_BORDER,
  SOURCE_IDENTITY_NEUTRAL,
  type AgentSourceIdentity,
} from './agent-source-identity';
import { SourceGlyph } from './harness-icons';

function MarkGlyph({
  identity,
  size,
}: {
  identity: AgentSourceIdentity;
  size: number;
}) {
  switch (identity.kind) {
    case 'vendor':
      return <SourceGlyph source={identity.id} size={size} />;
    case 'shell':
      return (
        <TerminalSquare size={size} strokeWidth={1.8} aria-hidden="true" />
      );
    case 'unmarked':
      return <Sparkles size={size} aria-hidden="true" />;
    case 'unknown':
      return <CircleHelp size={size} aria-hidden="true" />;
  }
}

export function AgentSourceMark({
  source,
  size = 12,
  plate = false,
  busy = false,
  labelled = false,
  className,
}: {
  /** An Agent Source adapter id, `shell`, or a saved id this build may not
   *  know. The only input: identity and colour are resolved here. */
  source: string;
  size?: number;
  /** Draw on the fixed dark instrument plate (rows and cards that carry an
   *  identity tile). Size the plate with `className`. */
  plate?: boolean;
  /** Replace the glyph with a spinner while the row's action runs. */
  busy?: boolean;
  /** Name the source to assistive technology, when no adjacent text does. */
  labelled?: boolean;
  className?: string;
}) {
  const theme = useActiveTheme();
  const identity = agentSourceIdentity(source);
  const glyph = busy ? (
    <LoaderCircle
      size={size}
      aria-hidden="true"
      className="animate-spin motion-reduce:animate-none"
    />
  ) : (
    <MarkGlyph identity={identity} size={size} />
  );
  const a11y = labelled
    ? ({ role: 'img', 'aria-label': identity.label } as const)
    : ({ 'aria-hidden': true } as const);

  if (plate) {
    return (
      <span
        {...a11y}
        data-source-identity-mark
        data-agent-source-mark={identity.id}
        className={cn(
          'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border',
          className
        )}
        style={{
          color: identity.color ?? SOURCE_IDENTITY_NEUTRAL,
          background: SOURCE_IDENTITY_BACKPLATE,
          borderColor: SOURCE_IDENTITY_BORDER,
        }}
      >
        {glyph}
      </span>
    );
  }

  const paint = bareMarkPaint(identity.color, theme);
  return (
    <span
      {...a11y}
      data-agent-source-mark={identity.id}
      data-mark-ink={paint.kind}
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        className
      )}
      style={{
        width: size,
        height: size,
        ...(paint.color ? { color: paint.color } : null),
      }}
    >
      {glyph}
    </span>
  );
}
