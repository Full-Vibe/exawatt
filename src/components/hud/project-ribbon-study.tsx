'use client';

import { useMemo, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TabStrip } from '@/components/workspace/tab-strip';
import type {
  Project,
  WorkspaceTab,
} from '@/components/workspace/use-workspace-state';
import type { SessionDelegation } from '@/types/electron';

const COLORS = [
  '#19E6FF',
  '#FF3B8B',
  '#79F2A6',
  '#9B7BFF',
  '#FFB02E',
  '#66A3FF',
];

let studyTab = 0;
function tab(
  title: string,
  cwd: string,
  state: 'working' | 'done' | 'fresh' = 'done'
): WorkspaceTab {
  studyTab += 1;
  const id = `ribbon-study-${studyTab}`;
  return {
    id,
    durableSessionId: `durable-${id}`,
    harness: studyTab % 3 === 0 ? 'claude' : 'codex',
    title,
    titleKind: 'operator',
    cwd,
    sessionId: `session-${id}`,
    harnessSessionId: `provider-${id}`,
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    roadmapItemId: null,
    initialTask: state === 'fresh' ? null : title,
  };
}

function makeProject(
  dir: string,
  titles: string[],
  colorIndex: number,
  ribbonExpanded = false
): Project {
  const tabs = titles.map((title, index) =>
    tab(title, dir, index === titles.length - 1 ? 'working' : 'done')
  );
  return {
    dir,
    name: dir.split('/').at(-1) ?? dir,
    color: COLORS[colorIndex % COLORS.length],
    activeTabId: tabs[0]?.id ?? null,
    tabs,
    ribbonExpanded,
  };
}

const INITIAL_PROJECTS = [
  makeProject('/workspace/gpagent', ['Fix the UTC date boundary'], 0),
  makeProject(
    '/workspace/exawatt',
    [
      'Close Projects with animation',
      'Fix Sessions rendering',
      'Define the initiative model',
      'Review keyboard navigation',
      'Design subagent topology',
    ],
    1
  ),
  makeProject('/workspace/switcheroo', [], 2),
  makeProject('/workspace/workmusic', [], 3),
  makeProject(
    '/workspace/cortex-ehr',
    ['Complete MMHC conversation', 'Plan RAF feature', 'Review Patty notes'],
    5,
    true
  ),
  makeProject(
    '/workspace/photo-generator',
    ['Evaluate localization expansion'],
    4
  ),
  makeProject('/workspace/customer-research', ['Synthesize partner calls'], 2),
  makeProject('/workspace/infrastructure', ['Harden the release feed'], 3),
];

export function ProjectRibbonStudy() {
  const [projects, setProjects] = useState(INITIAL_PROJECTS);
  const [activeDir, setActiveDir] = useState('/workspace/exawatt');
  const [dormant, setDormant] = useState<Set<string>>(
    () => new Set(['/workspace/switcheroo', '/workspace/workmusic'])
  );
  const summaries = useMemo(
    () =>
      Object.fromEntries(
        projects.flatMap(project =>
          project.tabs.map(item => [item.durableSessionId, item.title])
        )
      ),
    [projects]
  );
  const workingSession = projects
    .find(project => project.dir === '/workspace/exawatt')
    ?.tabs.at(-1)?.sessionId;
  const delegatedSession = projects.find(
    project => project.dir === '/workspace/cortex-ehr'
  )?.tabs[1]?.sessionId;
  const attentionSession = projects.find(
    project => project.dir === '/workspace/customer-research'
  )?.tabs[0]?.sessionId;
  const delegation: Record<string, SessionDelegation> = delegatedSession
    ? {
        [delegatedSession]: {
          ownTurn: 'available',
          children: [
            { id: 'study-child-a', agentType: 'Explore', startedAt: 1 },
            { id: 'study-child-b', agentType: 'general-purpose', startedAt: 2 },
          ],
        },
      }
    : {};

  return (
    <TooltipProvider>
      <div className="flex w-full max-w-7xl flex-col gap-3">
        <p className="max-w-[78ch] text-xs leading-relaxed text-muted-foreground">
          Production component in representative 8-Project / 15-Initiative
          state. Select a Project to expand it; the diamond keeps another open.
          The two empty Projects are in the stable dormant tail. Resize the
          window to exercise the two-row overflow contract.
        </p>
        <div className="rounded-lg border border-white/10 bg-[#080d16] p-2">
          <TabStrip
            projects={projects}
            activeDir={activeDir}
            pinnedTabId={null}
            summaries={summaries}
            attention={
              attentionSession
                ? { [attentionSession]: { kind: 'bell', since: 1 } }
                : {}
            }
            activity={workingSession ? { [workingSession]: true } : {}}
            engaged={Object.fromEntries(
              projects.flatMap(project =>
                project.tabs.map(item => [item.sessionId ?? '', true])
              )
            )}
            delegation={delegation}
            dormantProjectDirs={dormant}
            onSelectProject={index => {
              const project = projects[index];
              if (!project) return;
              setActiveDir(project.dir);
              setDormant(current => {
                if (!current.has(project.dir)) return current;
                const next = new Set(current);
                next.delete(project.dir);
                return next;
              });
            }}
            onSelectTab={(dir, tabId) => {
              setActiveDir(dir);
              setProjects(current =>
                current.map(project =>
                  project.dir === dir
                    ? { ...project, activeTabId: tabId }
                    : project
                )
              );
            }}
            onCloseTab={tabId =>
              setProjects(current =>
                current.map(project => {
                  const tabs = project.tabs.filter(item => item.id !== tabId);
                  return tabs.length === project.tabs.length
                    ? project
                    : {
                        ...project,
                        tabs,
                        activeTabId: tabs[0]?.id ?? null,
                      };
                })
              )
            }
            onRenameTab={() => undefined}
            onRenameProject={() => undefined}
            onSetProjectColor={() => undefined}
            onToggleProjectExpanded={dir =>
              setProjects(current =>
                current.map(project =>
                  project.dir === dir
                    ? {
                        ...project,
                        ribbonExpanded: project.ribbonExpanded !== true,
                      }
                    : project
                )
              )
            }
          />
        </div>
        <div className="flex gap-2 font-mono text-[11px]">
          <button
            type="button"
            className="rounded border border-white/10 px-2 py-1 hover:bg-white/5"
            onClick={() =>
              setDormant(current =>
                current.size > 0
                  ? new Set()
                  : new Set(['/workspace/switcheroo', '/workspace/workmusic'])
              )
            }
          >
            Toggle empty tail
          </button>
          <span className="self-center text-muted-foreground">
            Active and attention-bearing work is overflow-prioritized without
            changing manual order.
          </span>
        </div>
      </div>
    </TooltipProvider>
  );
}
