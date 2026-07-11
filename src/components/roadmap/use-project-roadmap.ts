/**
 * Roadmap lens data hook (ENG-017 S2): reads the focused Project's roadmap
 * file over the dumb `roadmap:read` IPC, parses it renderer-side with
 * `@exawatt/core` (decision 0011), and builds the pure ui-model lens view.
 *
 * Refresh triggers: project switch, window focus (same trigger the settings
 * store uses), and explicit refresh. Live file-watching arrives in S5.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseRoadmap } from '@exawatt/core';
import {
  buildRoadmapLens,
  type RoadmapLensRead,
  type RoadmapLensSessionInput,
  type RoadmapLensView,
} from '@exawatt/ui-model';
import type { SessionLink } from '@exawatt/core';

export interface ProjectRoadmap {
  view: RoadmapLensView;
  refresh: () => void;
}

export function useProjectRoadmap(
  projectDir: string | null,
  sessions: RoadmapLensSessionInput[] = [],
  links: SessionLink[] = []
): ProjectRoadmap {
  const [read, setRead] = useState<RoadmapLensRead>({ status: 'loading' });
  // survives re-renders; bumped to invalidate in-flight reads on refresh
  const generation = useRef(0);

  const load = useCallback(() => {
    const api = window.electron?.roadmap;
    if (!projectDir || !api) {
      setRead({ status: 'loading' });
      return;
    }
    const gen = ++generation.current;
    void api
      .read(projectDir)
      .then(result => {
        if (gen !== generation.current) return;
        if (result.status === 'ok') {
          const doc = parseRoadmap(result.text, {
            projectDir,
            file: result.file,
          });
          setRead({ status: 'ok', doc, mtimeMs: result.mtimeMs });
        } else if (result.status === 'none') {
          setRead({ status: 'none', checked: result.checked });
        } else {
          setRead({ status: 'error', error: result.error });
        }
      })
      .catch(reason => {
        if (gen !== generation.current) return;
        setRead({
          status: 'error',
          error: reason instanceof Error ? reason.message : String(reason),
        });
      });
  }, [projectDir]);

  useEffect(() => {
    // show the shimmer only across project switches, not focus refreshes
    setRead({ status: 'loading' });
    load();
  }, [load]);

  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  return {
    view: buildRoadmapLens({ read, sessions, links }),
    refresh: load,
  };
}
