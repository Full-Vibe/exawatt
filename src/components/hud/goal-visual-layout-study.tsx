'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SessionOverviewCardContent } from '@/components/workspace/session-overview-card';
import {
  goalVisualFallbackBackground,
  goalVisualHash,
} from '@/components/workspace/goal-visual-backdrop';
import {
  WORKSPACE_HUD as HUD,
  withThemeAlpha,
} from '@/components/workspace/workspace-theme';
import { createClient } from '@/lib/supabase/client';
import styles from './goal-visual-layout-study.module.css';

const SCENES = [
  {
    id: 'continuity',
    shortLabel: 'Continuity',
    label: 'Reduce context switching across active agent work',
    projectKey: 'hud-gallery:goal-visual-layouts:continuity',
    color: '#66A3FF',
  },
  {
    id: 'launch',
    shortLabel: 'Launch configuration',
    label: 'Prepare the Exawatt agent launch configuration',
    projectKey: 'hud-gallery:goal-visual-layouts:launch',
    color: '#FF3B8B',
  },
  {
    id: 'consumption',
    shortLabel: 'Consumption',
    label: 'Unify consumption visibility across AI platforms',
    projectKey: 'hud-gallery:goal-visual-layouts:consumption',
    color: '#79F2A6',
  },
] as const;

const GEOMETRIES = [
  {
    id: 'fullField',
    label: 'Full field',
    note: 'Current baseline',
  },
  {
    id: 'cornerField',
    label: 'Corner field',
    note: 'Top-right candidate',
  },
  {
    id: 'headerBanner',
    label: 'Header banner',
    note: 'Wide identity crest',
  },
  {
    id: 'rightRibbon',
    label: 'Right ribbon',
    note: 'Persistent edge',
  },
  {
    id: 'horizonBand',
    label: 'Horizon band',
    note: 'Quiet middle strip',
  },
] as const;

type SceneId = (typeof SCENES)[number]['id'];
type GeometryId = (typeof GEOMETRIES)[number]['id'];

interface LoadedScene {
  identityKey: string;
  dataUrl: string;
}

function isLoadedScene(value: unknown): value is LoadedScene {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.identityKey === 'string' &&
    /^[a-f0-9]{64}$/.test(candidate.identityKey) &&
    typeof candidate.dataUrl === 'string' &&
    candidate.dataUrl.startsWith('data:image/jpeg;base64,')
  );
}

function GoalVisualGeometryTile({
  geometry,
  scene,
  loaded,
}: {
  geometry: GeometryId;
  scene: (typeof SCENES)[number];
  loaded?: LoadedScene;
}) {
  const identity = loaded?.identityKey ?? `bench:${scene.id}`;
  const positionHash = goalVisualHash(identity);
  const objectPosition = `${46 + (positionHash % 9)}% ${46 + ((positionHash >>> 9) % 9)}%`;

  return (
    <div
      data-goal-visual-geometry={geometry}
      className={styles.tile}
      style={{
        borderColor: withThemeAlpha(scene.color, 0.34),
        background: HUD.bg.panelFill,
      }}
    >
      <div
        aria-hidden="true"
        className={`${styles.sceneFrame} ${styles[geometry]}`}
        style={{
          background: loaded
            ? HUD.bg.panel
            : goalVisualFallbackBackground(identity, scene.color),
        }}
      >
        {loaded && (
          // Decorative private raster returned by the same hosted boundary as Team.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            draggable={false}
            className={styles.sceneImage}
            src={loaded.dataUrl}
            style={{ objectPosition }}
          />
        )}
      </div>
      <div className={styles.tileContent}>
        <SessionOverviewCardContent
          title={scene.label}
          titleIsContext
          color={scene.color}
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

export function GoalVisualLayoutStudy() {
  const [activeScene, setActiveScene] = useState<SceneId>('continuity');
  const [loadedScenes, setLoadedScenes] = useState<
    Partial<Record<SceneId, LoadedScene>>
  >({});
  const [loadState, setLoadState] = useState<
    'loading' | 'ready' | 'signed-out' | 'unavailable'
  >('loading');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) {
          if (!cancelled) setLoadState('signed-out');
          return;
        }
        const entries = await Promise.all(
          SCENES.map(async scene => {
            const response = await fetch('/api/goal-visuals', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                schemaVersion: 1,
                projectKey: scene.projectKey,
                label: scene.label,
              }),
            });
            if (!response.ok) return [scene.id, null] as const;
            const value: unknown = await response.json();
            return [scene.id, isLoadedScene(value) ? value : null] as const;
          })
        );
        if (cancelled) return;
        const next: Partial<Record<SceneId, LoadedScene>> = {};
        for (const [id, scene] of entries) {
          if (scene) next[id] = scene;
        }
        setLoadedScenes(next);
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

  const scene = useMemo(
    () => SCENES.find(candidate => candidate.id === activeScene) ?? SCENES[0],
    [activeScene]
  );
  const statusCopy =
    loadState === 'loading'
      ? 'Loading scenes'
      : loadState === 'ready'
        ? `${Object.keys(loadedScenes).length} scenes ready`
        : loadState === 'signed-out'
          ? 'Sign in for generated scenes'
          : 'Deterministic fallbacks';

  return (
    <div className={styles.study}>
      <section aria-labelledby="geometry-heading" className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="geometry-heading" className="text-lg font-semibold">
              Same scene, five geometries
            </h2>
            <p className="text-chrome-meta text-muted-foreground">
              Production tile geometry · {statusCopy}
            </p>
          </div>
          <div aria-label="Scene" className={styles.scenePicker} role="group">
            {SCENES.map(candidate => (
              <Button
                key={candidate.id}
                type="button"
                size="sm"
                variant={candidate.id === activeScene ? 'default' : 'outline'}
                aria-pressed={candidate.id === activeScene}
                onClick={() => setActiveScene(candidate.id)}
              >
                {candidate.shortLabel}
              </Button>
            ))}
          </div>
        </div>

        <div className={styles.geometryGrid}>
          {GEOMETRIES.map(geometry => (
            <article key={geometry.id} className={styles.specimen}>
              <div className={styles.specimenLabel}>
                <h3 className="text-sm font-semibold">{geometry.label}</h3>
                <span className="font-mono text-chrome-meta text-muted-foreground">
                  {geometry.note}
                </span>
              </div>
              <GoalVisualGeometryTile
                geometry={geometry.id}
                scene={scene}
                loaded={loadedScenes[scene.id]}
              />
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="identity-heading" className={styles.section}>
        <div>
          <h2 id="identity-heading" className="text-lg font-semibold">
            Corner field across goals
          </h2>
          <p className="text-chrome-meta text-muted-foreground">
            One geometry · three stable goal identities
          </p>
        </div>
        <div className={styles.identityRow}>
          {SCENES.map(candidate => (
            <article key={candidate.id} className={styles.specimen}>
              <div className={styles.specimenLabel}>
                <h3 className="text-sm font-semibold">
                  {candidate.shortLabel}
                </h3>
                <span className="font-mono text-chrome-meta text-muted-foreground">
                  top right
                </span>
              </div>
              <GoalVisualGeometryTile
                geometry="cornerField"
                scene={candidate}
                loaded={loadedScenes[candidate.id]}
              />
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
