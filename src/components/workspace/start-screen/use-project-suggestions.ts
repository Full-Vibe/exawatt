'use client';

/**
 * The renderer's one reader of the harness project suggestions (ENG-046).
 *
 * Read when a surface that lists them mounts and on an explicit refresh,
 * never watched (decision 0013). Main answers from its last read unless asked
 * to refresh, so the Start screen and the ⌘N chooser opening in turn share
 * one pass over the stores.
 *
 * `unavailable` (no desktop bridge, or a build without the channel) and
 * `failed` (the read itself threw) are kept apart from a read that found
 * nothing: an empty list is only ever an answer.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLatestRequest } from '@/hooks/use-latest-request';
import type {
  HarnessProjectSuggestion,
  HarnessStoreRead,
} from '@exawatt/core/desktop-bridge';

type ProjectSuggestionsState =
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'failed'; error: string }
  | {
      status: 'ready';
      suggestions: HarnessProjectSuggestion[];
      stores: HarnessStoreRead[];
      readAt: number;
    };

export function useProjectSuggestions(enabled = true): {
  state: ProjectSuggestionsState;
  /** True while a refresh runs over rows already on screen. */
  refreshing: boolean;
  refresh: () => void;
} {
  const [state, setState] = useState<ProjectSuggestionsState>(() =>
    typeof window !== 'undefined' && window.electron?.projects?.suggestions
      ? { status: 'loading' }
      : { status: 'unavailable' }
  );
  const [refreshing, setRefreshing] = useState(false);
  const reads = useLatestRequest();

  const read = useCallback(
    (refresh: boolean) => {
      const suggestions = window.electron?.projects?.suggestions;
      if (!suggestions) {
        setState({ status: 'unavailable' });
        return;
      }
      const ticket = reads.begin();
      if (refresh) setRefreshing(true);
      else
        setState(current =>
          current.status === 'ready' ? current : { status: 'loading' }
        );
      suggestions({ refresh })
        .then(result => {
          if (!ticket.current) return;
          setState(
            result.ok
              ? {
                  status: 'ready',
                  suggestions: result.suggestions,
                  stores: result.stores,
                  readAt: result.readAt,
                }
              : { status: 'failed', error: result.error }
          );
        })
        .catch(() => {
          if (!ticket.current) return;
          setState({
            status: 'failed',
            error: 'Your projects could not be read.',
          });
        })
        .finally(() => {
          if (ticket.current) setRefreshing(false);
        });
    },
    [reads]
  );

  useEffect(() => {
    if (!enabled) return;
    read(false);
    return () => reads.invalidate();
  }, [enabled, read, reads]);

  const refresh = useCallback(() => read(true), [read]);
  return { state, refreshing, refresh };
}
