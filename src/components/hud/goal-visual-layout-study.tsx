'use client';

import { useEffect, useState } from 'react';
import { SessionOverviewCardContent } from '@/components/workspace/session-overview-card';
import { PROJECT_PALETTE } from '@/components/workspace/project-colors';
import {
  goalVisualFallbackBackground,
  goalVisualHash,
} from '@/components/workspace/goal-visual-backdrop';
import {
  WORKSPACE_HUD as HUD,
  withThemeAlpha,
} from '@/components/workspace/workspace-theme';
import { createOptionalClient } from '@/lib/supabase/client';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import { createGoalVisualPreferenceSource } from '@/lib/goal-visuals/preference-source';
import styles from './goal-visual-layout-study.module.css';

const GOALS = [
  {
    id: 'continuity',
    shortLabel: 'Continuity',
    label: 'Reduce context switching across active agent work',
    color: PROJECT_PALETTE[6],
  },
  {
    id: 'launch',
    shortLabel: 'Launch configuration',
    label: 'Prepare the Exawatt agent launch configuration',
    color: PROJECT_PALETTE[1],
  },
  {
    id: 'consumption',
    shortLabel: 'Consumption',
    label: 'Unify consumption visibility across AI platforms',
    color: PROJECT_PALETTE[3],
  },
] as const;

const LANGUAGES = [
  {
    id: 'graphic',
    label: 'Graphic form',
    note: 'screenprint · cut paper · ink',
  },
  {
    id: 'metaphor',
    label: 'Graphic metaphor',
    note: 'handoff · alignment · accumulation',
  },
  {
    id: 'still-life',
    label: 'Symbolic still life',
    note: 'cord · key · reservoir',
  },
  {
    id: 'noun-place',
    label: 'Noun place',
    note: 'crossing · switchyard · spillway',
  },
  {
    id: 'artifact',
    label: 'Emblematic artifact',
    note: 'relay · alignment key · vessel',
  },
  {
    id: 'collage',
    label: 'Editorial collage',
    note: 'photograph · paper · ink',
  },
  {
    id: 'diagram-landscape',
    label: 'Diagrammatic landscape',
    note: 'merge · threshold · basin',
  },
] as const;

const STUDY_PROJECT_PREFIX = 'hud-gallery:goal-visual-languages:v1:';

const STUDIES = LANGUAGES.flatMap(language =>
  GOALS.map((goal, variant) => ({
    id: `${language.id}:${variant}`,
    projectKey: `${STUDY_PROJECT_PREFIX}${language.id}:${variant}`,
    languageId: language.id,
    goal,
  }))
);

interface LoadedStudy {
  identityKey: string;
  dataUrl: string;
}

function isLoadedStudy(value: unknown): value is LoadedStudy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.identityKey === 'string' &&
    /^[a-f0-9]{64}$/.test(candidate.identityKey) &&
    typeof candidate.dataUrl === 'string' &&
    candidate.dataUrl.startsWith('data:image/jpeg;base64,')
  );
}

async function decodeStudy(study: LoadedStudy): Promise<LoadedStudy | null> {
  if (typeof Image === 'undefined') return study;
  const image = new Image();
  image.decoding = 'async';
  image.src = study.dataUrl;
  if (typeof image.decode !== 'function') return study;
  try {
    await image.decode();
    return study;
  } catch {
    return null;
  }
}

function FullCardStudyTile({
  study,
  loaded,
}: {
  study: (typeof STUDIES)[number];
  loaded?: LoadedStudy;
}) {
  const { goal } = study;
  const identity = loaded?.identityKey ?? `bench:${study.id}:${goal.id}`;
  const positionHash = goalVisualHash(identity);
  const objectPosition = `${46 + (positionHash % 9)}% ${46 + ((positionHash >>> 9) % 9)}%`;

  return (
    <div
      data-goal-visual-language={study.languageId}
      data-goal-visual-study={study.id}
      className={styles.tile}
      style={{
        borderColor: withThemeAlpha(goal.color, 0.34),
        background: HUD.bg.panelFill,
      }}
    >
      <div
        aria-hidden="true"
        className={styles.sceneFrame}
        style={{
          background: loaded
            ? HUD.bg.panel
            : goalVisualFallbackBackground(identity, goal.color),
        }}
      >
        {loaded && (
          // Decorative private raster returned by the same hosted boundary as Team.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            decoding="async"
            draggable={false}
            className={styles.sceneImage}
            src={loaded.dataUrl}
            style={{ objectPosition }}
          />
        )}
      </div>
      <div className={styles.tileContent}>
        <SessionOverviewCardContent
          title={goal.label}
          titleIsContext
          color={goal.color}
          harness="codex"
          glyphState="done"
          agentType="Coding"
          current="Turn complete"
          next="ENG-015"
          nextProgress="4/6"
        />
      </div>
    </div>
  );
}

export function GoalVisualLanguageStudy() {
  const [loadedStudies, setLoadedStudies] = useState<
    Record<string, LoadedStudy>
  >({});
  const [loadState, setLoadState] = useState<
    'loading' | 'ready' | 'signed-out' | 'unavailable'
  >('loading');
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // Settings -> Privacy -> "Agent tile backgrounds" is disclosed as the
        // control that PREVENTS the goal-visual hosted call (decision `0031`,
        // and `OUTBOUND_CONTROLS.goalVisuals` renders that sentence). This
        // study is a second caller of the same endpoint, so it honors the same
        // switch; until 2026-08-18 it did not, which made the disclosure false
        // for anyone who opened the gallery. Read from the preference SOURCE
        // rather than the React context: this is an enforcement point, and it
        // must not depend on a provider being mounted above it.
        const enabled = await createGoalVisualPreferenceSource()
          .load()
          .catch(() => true);
        if (!enabled) {
          // Switched off: look up no session, construct no request.
          if (!cancelled) setLoadState('unavailable');
          return;
        }
        const distribution = resolvedDistribution();
        const endpoint = distribution.enrichment.goalVisuals;
        // Capability absence is the community path. Keep every deterministic
        // study mounted and perform neither session lookup nor network I/O.
        if (!endpoint) {
          if (!cancelled) setLoadState('unavailable');
          return;
        }
        const supabase = createOptionalClient(distribution);
        if (!supabase) {
          if (!cancelled) setLoadState('unavailable');
          return;
        }
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) {
          if (!cancelled) setLoadState('signed-out');
          return;
        }
        const entries = await Promise.all(
          STUDIES.map(async study => {
            try {
              const response = await fetch(endpoint.url, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${session.access_token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  schemaVersion: 1,
                  projectKey: study.projectKey,
                  label: study.goal.label,
                }),
              });
              if (!response.ok) return [study.id, null] as const;
              const value: unknown = await response.json();
              return [
                study.id,
                isLoadedStudy(value) ? await decodeStudy(value) : null,
              ] as const;
            } catch {
              return [study.id, null] as const;
            }
          })
        );
        if (cancelled) return;
        const next: Record<string, LoadedStudy> = {};
        for (const [id, study] of entries) {
          if (study) next[id] = study;
        }
        setLoadedStudies(next);
        setLoadState(Object.keys(next).length > 0 ? 'ready' : 'unavailable');
      } catch {
        if (!cancelled) setLoadState('unavailable');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const statusCopy =
    loadState === 'loading'
      ? 'Loading studies'
      : loadState === 'ready'
        ? `${Object.keys(loadedStudies).length} studies ready`
        : loadState === 'signed-out'
          ? 'Sign in for generated studies'
          : 'Deterministic fallbacks';

  return (
    <div className={styles.study}>
      <div className={styles.summary}>
        <h2 className="text-lg font-semibold">Full-card comparison</h2>
        <p className="text-chrome-meta text-muted-foreground">
          Seven visual languages · three goal identities · {statusCopy}
        </p>
      </div>

      {LANGUAGES.map(language => (
        <section
          key={language.id}
          aria-labelledby={`language-${language.id}`}
          className={styles.section}
        >
          <div className={styles.languageHeader}>
            <h2
              id={`language-${language.id}`}
              className="text-lg font-semibold"
            >
              {language.label}
            </h2>
            <span className="font-mono text-chrome-meta text-muted-foreground">
              {language.note}
            </span>
          </div>
          <div className={styles.languageGrid}>
            {STUDIES.filter(study => study.languageId === language.id).map(
              study => (
                <article key={study.id} className={styles.specimen}>
                  <div className={styles.specimenLabel}>
                    <h3 className="text-sm font-semibold">
                      {study.goal.shortLabel}
                    </h3>
                    <span className="font-mono text-chrome-meta text-muted-foreground">
                      full card
                    </span>
                  </div>
                  <FullCardStudyTile
                    study={study}
                    loaded={loadedStudies[study.id]}
                  />
                </article>
              )
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
