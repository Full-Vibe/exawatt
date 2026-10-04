export const NEW_AGENT_TITLE = 'New agent';

export interface SessionDisplayCopyInput {
  harness: string;
  title: string;
  titleKind: 'default' | 'operator';
  lifecycle: string;
  summary?: string | null;
}

export interface SessionDisplayCopy {
  /** The copy every Session surface must render as its visible identity. */
  primary: string;
  /** A durable context cue beneath an operator-authored title, when distinct. */
  context: string | null;
  primaryKind: 'context' | 'fallback' | 'operator' | 'shell';
}

function clean(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

/**
 * Total Session identity projection.
 *
 * Agent Source already has its glyph, so provider labels such as `Codex` and
 * `Claude Code` are not useful primary copy. A server-owned context label wins;
 * an explicit operator rename stays primary; and the final fallback is always
 * `New agent`. No tab or Sessions card is allowed to collapse to icons alone.
 */
export function sessionDisplayCopy(
  input: SessionDisplayCopyInput
): SessionDisplayCopy {
  const title = clean(input.title);
  const summary = clean(input.summary);

  if (input.lifecycle === 'draft') {
    return {
      primary: NEW_AGENT_TITLE,
      context: null,
      primaryKind: 'fallback',
    };
  }

  if (input.harness === 'shell') {
    return {
      primary: title ?? 'Shell',
      context: summary && summary !== title ? summary : null,
      primaryKind: 'shell',
    };
  }

  if (input.titleKind === 'operator' && title) {
    return {
      primary: title,
      context: summary && summary !== title ? summary : null,
      primaryKind: 'operator',
    };
  }

  if (summary) {
    return { primary: summary, context: null, primaryKind: 'context' };
  }

  return {
    primary: NEW_AGENT_TITLE,
    context: null,
    primaryKind: 'fallback',
  };
}
