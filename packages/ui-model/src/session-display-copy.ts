const NEW_AGENT_TITLE = 'New agent';

export interface SessionDisplayCopyInput {
  harness: string;
  title: string;
  titleKind: 'default' | 'operator';
  lifecycle: string;
  summary?: string | null;
  /** The Agent's short, stable name (`claude-1`, ENG-029 C4). Absent for a
   *  shell, a draft, and a Session main has not named yet. */
  name?: string | null;
}

interface SessionDisplayCopy {
  /** The copy every Session surface must render as its visible identity. */
  primary: string;
  /** The changing context label beside or beneath the identity, when distinct. */
  context: string | null;
  primaryKind: 'name' | 'context' | 'fallback' | 'operator' | 'shell';
}

function clean(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

/**
 * Total Session identity projection.
 *
 * An Agent's name (`claude-1`, or what the operator renamed it to) is its
 * identity on every surface, with the changing context label as the second
 * line of copy (ENG-029 C4). Until main has named a Session, a title the
 * operator gave it under an older build stays primary, then the context
 * label, and the final fallback is always `New agent`. Provider labels such
 * as `Codex` are never primary copy: Agent Source already has its glyph. No
 * tab or Sessions card is allowed to collapse to icons alone.
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

  const name = clean(input.name);
  if (name) {
    return {
      primary: name,
      context: summary && summary !== name ? summary : null,
      primaryKind: 'name',
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
