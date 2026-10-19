/**
 * Agent Source identity, resolved in one place (BUG-292, BUG-293): who an id
 * names, its identity colour, which glyph it wears, and the paint a bare mark
 * may use on the active theme. Pure data and arithmetic, so the session
 * registry (`harnesses.ts`) and the mark component (`agent-source-mark.tsx`)
 * read the same answer. The design system's Agent Source identity rung is the
 * contract; `agent-source-identity.test.ts` holds every declared colour to it
 * on every production theme.
 */

import {
  AGENT_SOURCE_DECLARATIONS,
  FUTURE_AGENT_SOURCE_CATALOG,
} from '@/generated/agent-source-declarations';
import { contrastRatio, parseHexColor } from '@/lib/appearance/color';
import type { ThemeDefinitionV1 } from '@/lib/appearance/types';
import { sourceMarkExists } from './harness-icons';

/** The fixed plate's paint. Stable across themes by design: the plate is an
 *  instrument, and the brand colours are authored to read on it. */
export const SOURCE_IDENTITY_BACKPLATE = '#111820';
export const SOURCE_IDENTITY_BORDER = '#566A76';
/** Ink for a plated mark whose source carries no colour of its own. */
export const SOURCE_IDENTITY_NEUTRAL = '#B9C6CF';

/** WCAG 2.2 SC 1.4.11: a graphical object that identifies something needs
 *  3:1 against the colours adjacent to it. */
export const MARK_MINIMUM_CONTRAST = 3;

export const SHELL_SOURCE_COLOR = '#6A7585';

export type AgentSourceMarkKind = 'vendor' | 'unmarked' | 'shell' | 'unknown';

export interface AgentSourceIdentity {
  id: string;
  label: string;
  /** The source's identity colour, or null when it has none. */
  color: string | null;
  kind: AgentSourceMarkKind;
}

/** Who an id names, from the one registry every surface shares. Total: a
 *  saved record may carry an id this build no longer declares. */
export function agentSourceIdentity(source: string): AgentSourceIdentity {
  if (source === 'shell') {
    return {
      id: source,
      label: 'Shell',
      color: SHELL_SOURCE_COLOR,
      kind: 'shell',
    };
  }
  const declared = AGENT_SOURCE_DECLARATIONS.find(
    candidate => candidate.adapterId === source
  );
  if (declared) {
    return {
      id: source,
      label: declared.label,
      color: declared.color,
      kind: sourceMarkExists(source) ? 'vendor' : 'unmarked',
    };
  }
  const catalog = FUTURE_AGENT_SOURCE_CATALOG.find(
    candidate => candidate.adapterId === source
  );
  if (catalog) {
    return { id: source, label: catalog.label, color: null, kind: 'unmarked' };
  }
  return { id: source, label: source, color: null, kind: 'unknown' };
}

/** The opaque grounds a mark can sit on in a theme: the semantic chrome
 *  grounds (page, card, raised card, popover, hover/secondary fill) and the
 *  HUD grounds. Translucent fills composite over one of these. */
export function themeMarkGrounds(theme: ThemeDefinitionV1): string[] {
  const { foundation, hud } = theme;
  return [
    foundation.canvas,
    foundation.surface,
    foundation.surfaceRaised,
    foundation.overlay,
    foundation.secondary,
    hud.void,
    hud.deep,
    hud.panel,
  ];
}

/**
 * The paint for a bare mark on the active theme.
 *
 * `brand` when the source colour clears `MARK_MINIMUM_CONTRAST` against every
 * ground of the theme; otherwise the theme's own quiet ink
 * (`foundation.textMuted`), named explicitly rather than inherited, because
 * an ancestor's colour is not a contract (the launcher bench's Classic-only
 * page ink turned an inherited Codex mark pale on Air). Without a theme
 * (outside the provider) the mark inherits, the only answer left.
 */
export function bareMarkPaint(
  color: string | null,
  theme: ThemeDefinitionV1 | null
): { kind: 'brand' | 'ink'; color: string | null } {
  if (!theme) return { kind: 'ink', color: null };
  const brandReads =
    color !== null &&
    parseHexColor(color) !== null &&
    themeMarkGrounds(theme).every(
      ground => contrastRatio(color, ground) >= MARK_MINIMUM_CONTRAST
    );
  return brandReads
    ? { kind: 'brand', color }
    : { kind: 'ink', color: theme.foundation.textMuted };
}
