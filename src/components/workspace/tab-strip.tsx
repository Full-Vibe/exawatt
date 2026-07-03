// No 'use client' directive: only imported by the client workspace surface.

/**
 * Grouped tab strip (ENG-002 W0.2): initiatives are visual clusters —
 * a numbered, project-colored group chip (⌘1..9 target) followed by its
 * tabs, all sharing the project color. Transitional UI on the way to the
 * W0.5 world map (sessions as entities on the ENG-004 spatial surface).
 */
import { HUD } from '@/components/hud';
import { projectColor } from './project-colors';
import { REVIVE_FAILED } from './use-workspace-state';
import type { Initiative } from './use-workspace-state';

export function TabStrip({
  initiatives,
  activeDir,
  onSelectInitiative,
  onSelectTab,
  onCloseTab,
}: {
  initiatives: Initiative[];
  activeDir: string | null;
  onSelectInitiative: (index: number) => void;
  onSelectTab: (dir: string, tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
      {initiatives.map((g, gi) => {
        const color = projectColor(g.name);
        const groupActive = g.dir === activeDir;
        return (
          <div
            key={g.dir}
            data-initiative={g.name}
            data-active-initiative={groupActive || undefined}
            className="flex items-center gap-1 rounded border px-1 py-0.5"
            style={{
              borderColor: groupActive ? `${color}66` : 'rgba(138,160,190,0.12)',
              background: groupActive ? `${color}0d` : 'transparent',
            }}
          >
            <button
              onClick={() => onSelectInitiative(gi)}
              title={g.dir}
              className="flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
              style={{ color: groupActive ? color : HUD.textDim }}
            >
              <span
                className="inline-block h-2 w-2 rotate-45"
                style={{ background: color, boxShadow: `0 0 5px ${color}` }}
              />
              {gi + 1} {g.name}
            </button>
            {g.tabs.map((t) => {
              const on = groupActive && t.id === g.activeTabId;
              const dead = t.exitCode !== null;
              return (
                <div
                  key={t.id}
                  data-active={on || undefined}
                  className="flex items-center overflow-hidden rounded border"
                  style={{
                    borderColor: on ? `${color}99` : 'rgba(138,160,190,0.18)',
                    background: on ? `${color}14` : 'transparent',
                    opacity: dead ? 0.55 : 1,
                  }}
                >
                  <button
                    onClick={() => onSelectTab(g.dir, t.id)}
                    className="flex items-center gap-1.5 px-2 py-0.5 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                    style={{ color: on ? HUD.text : HUD.textDim }}
                    title={`${t.cwd}${
                      dead
                        ? t.exitCode === REVIVE_FAILED
                          ? ' · revive failed'
                          : ` · exited ${t.exitCode}`
                        : ''
                    }`}
                  >
                    {t.harness !== 'shell' && (
                      <span style={{ color }}>⚡</span>
                    )}
                    {t.title}
                    {dead && <span style={{ color: HUD.red }}>✕</span>}
                  </button>
                  <button
                    onClick={() => onCloseTab(t.id)}
                    aria-label={`Close ${t.title}`}
                    className="px-1 py-0.5 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                    style={{ color: HUD.textDim }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
