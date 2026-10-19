'use client';

/**
 * "Your projects" (ENG-046 O2): the folders Claude Code, Codex and
 * Antigravity already work in, read from their own stores, most recent
 * first, one click to open. One component for the Start screen and the ⌘N
 * chooser, so the two can never list different things.
 *
 * Opening a row is inert (ENG-016 D14) and goes through the same verb Browse
 * uses, so it creates exactly the Project Browse would have for that folder.
 * Nothing here writes to any harness store; the line under the title says
 * so in product words.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AgentSourceMark } from '../agent-source-mark';
import type { AgentSourceId } from '../agent-sources';
import { useAgentSourceRegistry } from '../use-agent-source-registry';
import { WORKSPACE_HUD as HUD } from '../workspace-theme';
import type { AgentSourceRegistrySnapshot } from '@exawatt/core';
import type {
  HarnessProjectSuggestion,
  ProjectSuggestionHarness,
} from '@exawatt/core/desktop-bridge';
import {
  displayPath,
  provenanceLine,
  relativeActivity,
  splitByRecency,
  suggestedSource,
  unreadableStoreLines,
} from './project-suggestions';
import { useProjectSuggestions } from './use-project-suggestions';
import { harnessStoreName } from './store-names';

export interface SuggestionOpen {
  suggestion: HarnessProjectSuggestion;
  /** The engine the opened Project's composer recommends, when one of the
   *  harnesses that knows the folder can launch here. */
  source: AgentSourceId | undefined;
}

function HarnessBadges({
  harnesses,
}: {
  harnesses: readonly ProjectSuggestionHarness[];
}) {
  return (
    <span className="flex shrink-0 items-center gap-1" data-harness-badges>
      {harnesses.map(harness => {
        const label = harnessStoreName(harness);
        return (
          <span key={harness} className="inline-flex" title={label}>
            <AgentSourceMark plate source={harness} size={11} />
            <span className="sr-only">{label}</span>
          </span>
        );
      })}
    </span>
  );
}

function SuggestionRow({
  suggestion,
  now,
  opening,
  disabled,
  onOpen,
}: {
  suggestion: HarnessProjectSuggestion;
  now: number;
  opening: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        data-project-suggestion={suggestion.path}
        disabled={disabled}
        onClick={onOpen}
        className="group flex w-full min-w-0 items-center gap-3 rounded-md border px-3 py-2 text-left outline-none transition-colors hover:bg-hud-fill disabled:opacity-60 focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
        style={{
          borderColor: HUD.strokeFaint,
          background: HUD.surfaceInputSoft,
        }}
      >
        <span
          aria-hidden
          className="block h-5 w-[3px] shrink-0 rounded-full"
          style={{ background: HUD.textDim }}
        />
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-sm font-medium"
            style={{ color: HUD.text }}
          >
            {suggestion.name}
          </span>
          <span
            className="block truncate font-mono text-chrome-micro"
            style={{ color: HUD.textDim }}
          >
            {displayPath(suggestion.path)}
          </span>
        </span>
        <HarnessBadges harnesses={suggestion.harnesses} />
        <span
          className="flex w-16 shrink-0 justify-end font-mono text-chrome-meta"
          style={{ color: HUD.textDim }}
        >
          {opening ? (
            <LoaderCircle
              aria-label="Opening"
              className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
            />
          ) : suggestion.lastActivityAt !== null ? (
            relativeActivity(suggestion.lastActivityAt, now)
          ) : null}
        </span>
      </button>
    </li>
  );
}

export function YourProjects({
  heading = 'Your projects',
  headingLevel = 'h2',
  emptyHeading,
  hiddenPaths,
  query = '',
  registry: providedRegistry,
  onOpen,
  onOpenAll,
  children,
  divided = false,
  onListedChange,
}: {
  heading?: string;
  headingLevel?: 'h2' | 'h3';
  /**
   * The title when no store suggests anything. Omitted, the section renders
   * nothing at all in that case (the chooser lists its own library below).
   */
  emptyHeading?: string;
  /** Folders the surface already lists, so a row never appears twice. */
  hiddenPaths?: ReadonlySet<string>;
  /** The surface's search text; rows match on name and folder. */
  query?: string;
  /** The launch registry when the surface already reads it. */
  registry?: AgentSourceRegistrySnapshot;
  onOpen: (open: SuggestionOpen) => Promise<boolean>;
  onOpenAll: (opens: SuggestionOpen[]) => Promise<boolean>;
  /** Rendered under the rows (the Start screen's Pick a folder routes). */
  children?: ReactNode;
  /** Ruled off from what follows it (the chooser's library). */
  divided?: boolean;
  /** How many rows the section lists, as it changes (0 while reading). */
  onListedChange?: (count: number) => void;
}) {
  const { state, refreshing, refresh } = useProjectSuggestions();
  const ownRegistry = useAgentSourceRegistry('launch', {
    enabled: !providedRegistry,
  });
  const registry = providedRegistry ?? ownRegistry.registry;
  const [showOlder, setShowOlder] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const headingId = useId();

  const listed = useMemo(() => {
    if (state.status !== 'ready') return [];
    const normalized = query.trim().toLocaleLowerCase();
    return state.suggestions.filter(
      suggestion =>
        !hiddenPaths?.has(suggestion.path) &&
        (!normalized ||
          `${suggestion.name} ${suggestion.path}`
            .toLocaleLowerCase()
            .includes(normalized))
    );
  }, [hiddenPaths, query, state]);
  const { recent, older } = useMemo(() => splitByRecency(listed), [listed]);
  useEffect(() => {
    onListedChange?.(listed.length);
  }, [listed.length, onListedChange]);
  const diagnostics =
    state.status === 'ready' ? unreadableStoreLines(state.stores) : [];
  const now = state.status === 'ready' ? state.readAt : 0;

  const open = async (suggestion: HarnessProjectSuggestion) => {
    if (opening) return;
    setOpening(suggestion.path);
    try {
      await onOpen({
        suggestion,
        source: suggestedSource(suggestion, registry),
      });
    } finally {
      setOpening(null);
    }
  };

  const openAll = async () => {
    if (opening || recent.length === 0) return;
    setOpening('*');
    try {
      await onOpenAll(
        recent.map(suggestion => ({
          suggestion,
          source: suggestedSource(suggestion, registry),
        }))
      );
    } finally {
      setOpening(null);
    }
  };

  const empty = listed.length === 0;
  if (state.status === 'unavailable' && !emptyHeading) return null;
  if (
    !emptyHeading &&
    empty &&
    diagnostics.length === 0 &&
    state.status !== 'failed'
  ) {
    // The chooser shows nothing until a store has something to offer.
    return null;
  }

  const Heading = headingLevel;
  const title = empty && emptyHeading ? emptyHeading : heading;
  const provenance = provenanceLine(listed);

  return (
    <section
      aria-labelledby={headingId}
      data-your-projects={
        state.status === 'ready' ? (empty ? 'empty' : 'rows') : state.status
      }
      className={`flex flex-col gap-3 ${divided ? 'mb-4 border-b pb-4' : ''}`}
      style={divided ? { borderColor: HUD.strokeFaint } : undefined}
    >
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        <Heading
          id={headingId}
          className="font-display text-base font-semibold"
          style={{ color: HUD.text }}
        >
          {title}
        </Heading>
        {state.status !== 'unavailable' && (
          <div className="flex items-center gap-1">
            {!empty && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-open-all-recent
                disabled={opening !== null || recent.length === 0}
                onClick={() => void openAll()}
                className="motion-reduce:transition-none"
              >
                Open all recent
              </Button>
            )}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Read your projects again"
              title="Read your projects again"
              data-refresh-suggestions
              disabled={state.status === 'loading' || refreshing}
              onClick={refresh}
              className="size-8 motion-reduce:transition-none"
            >
              <RefreshCw
                aria-hidden
                className={
                  refreshing ? 'animate-spin motion-reduce:animate-none' : ''
                }
              />
            </Button>
          </div>
        )}
      </div>

      {provenance && (
        <p
          className="text-chrome-meta"
          data-suggestion-provenance
          style={{ color: HUD.textDim }}
        >
          {provenance}
        </p>
      )}

      {state.status === 'loading' && (
        <p
          role="status"
          className="flex items-center gap-2 font-mono text-chrome-meta"
          style={{ color: HUD.textDim }}
        >
          <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          Reading Claude Code, Codex and Antigravity on this Mac…
        </p>
      )}

      {state.status === 'failed' && (
        <p
          role="alert"
          className="font-mono text-chrome-meta"
          style={{ color: HUD.amber }}
        >
          {state.error}
        </p>
      )}

      {!empty && (
        <>
          <ul className="flex flex-col gap-1" data-project-suggestions>
            {[...recent, ...(showOlder ? older : [])].map(suggestion => (
              <SuggestionRow
                key={suggestion.path}
                suggestion={suggestion}
                now={now}
                opening={opening === suggestion.path || opening === '*'}
                disabled={opening !== null}
                onOpen={() => void open(suggestion)}
              />
            ))}
          </ul>
          {older.length > 0 && (
            <button
              type="button"
              data-show-older
              aria-expanded={showOlder}
              onClick={() => setShowOlder(current => !current)}
              className="inline-flex h-8 w-fit items-center gap-1.5 rounded px-2 font-mono text-xs outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
              style={{ color: HUD.textDim }}
            >
              <ChevronDown
                aria-hidden
                className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${showOlder ? 'rotate-180' : ''}`}
              />
              {showOlder ? 'Hide older' : `Show older (${older.length})`}
            </button>
          )}
        </>
      )}

      {diagnostics.map(line => (
        <p
          key={line}
          data-suggestion-diagnostic
          className="font-mono text-chrome-meta"
          style={{ color: HUD.amber }}
        >
          {line}
        </p>
      ))}

      {children}
    </section>
  );
}
