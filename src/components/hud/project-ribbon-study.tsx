'use client';

import { useMemo, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TabStrip } from '@/components/workspace/tab-strip';
import { WORKSPACE_HUD as HUD } from '@/components/workspace/workspace-theme';
import {
  fleetAttention,
  mergeFleetAttention,
} from '@/components/workspace/session-status';
import type {
  Project,
  SessionTab,
} from '@/components/workspace/use-workspace-state';
import type { SessionDelegation } from '@exawatt/core/desktop-bridge';
import { assignAgentNames, renameAgentName } from '@exawatt/core';

const COLORS = [
  '#19E6FF',
  '#FF3B8B',
  '#79F2A6',
  '#9B7BFF',
  '#FFB02E',
  '#66A3FF',
];

let studyTab = 0;
/** The study's context labels, by durable Session id. */
const STUDY_TASKS = new Map<string, string>();

function tab(
  task: string,
  cwd: string,
  state: 'working' | 'done' | 'fresh' = 'done'
): SessionTab {
  studyTab += 1;
  const id = `ribbon-study-${studyTab}`;
  const harness =
    studyTab % 5 === 0
      ? 'antigravity'
      : studyTab % 3 === 0
        ? 'claude'
        : 'codex';
  STUDY_TASKS.set(`durable-${id}`, task);
  return {
    kind: 'session',
    id,
    durableSessionId: `durable-${id}`,
    harness,
    title: harness,
    titleKind: 'default',
    cwd,
    sessionId: `session-${id}`,
    harnessSessionId: `provider-${id}`,
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    roadmapItemId: null,
    initialTask: state === 'fresh' ? null : task,
  };
}

/** This study's corpus is local Sessions only. */
type StudyProject = Omit<Project, 'tabs'> & { tabs: SessionTab[] };

function makeProject(
  dir: string,
  titles: string[],
  colorIndex: number
): StudyProject {
  const tabs = titles.map((title, index) =>
    tab(title, dir, index === titles.length - 1 ? 'working' : 'done')
  );
  return {
    dir,
    name: dir.split('/').at(-1) ?? dir,
    color: COLORS[colorIndex % COLORS.length],
    activeTabId: tabs[0]?.id ?? null,
    tabs,
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
    5
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
          project.tabs.map(item => [
            item.durableSessionId,
            STUDY_TASKS.get(item.durableSessionId) ?? '',
          ])
        )
      ),
    [projects]
  );
  // Names come from the same allocation main runs (ENG-029 C4), so the
  // study shows what a real strip deals: claude-1, codex-2, gemini-1.
  const [agentNameRecords, setAgentNameRecords] = useState(
    () =>
      assignAgentNames(
        [],
        INITIAL_PROJECTS.flatMap(project =>
          project.tabs.map(item => ({
            durableSessionId: item.durableSessionId,
            projectKey: project.dir,
            harness: item.harness,
          }))
        ),
        0
      ).records
  );
  const agentNames = useMemo(
    () =>
      new Map(
        agentNameRecords.map(record => [record.durableSessionId, record])
      ),
    [agentNameRecords]
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
          blockedOn: null,
          children: [
            {
              id: 'study-child-a',
              agentType: 'Explore',
              description: null,
              startedAt: 1,
            },
            {
              id: 'study-child-b',
              agentType: 'general-purpose',
              description: null,
              startedAt: 2,
            },
          ],
        },
      }
    : {};

  return (
    <TooltipProvider>
      <div className="flex w-full max-w-7xl flex-col gap-3">
        <p className="max-w-[78ch] text-xs leading-relaxed text-muted-foreground">
          Production component in representative 8-Project / 15-Initiative
          state. Select a Project to expand it; every other Project shows glyph
          chips, and folds to a counted container when the row runs out of room.
          The two empty Projects are in the stable dormant tail. Resize the
          window to exercise the two-row overflow contract.
        </p>
        <div
          className="rounded-lg border p-2"
          style={{ borderColor: HUD.strokeFaint, background: HUD.bg.panel }}
        >
          <TabStrip
            projects={projects}
            activeDir={activeDir}
            pinnedTabId={null}
            summaries={summaries}
            agentNames={agentNames}
            attention={mergeFleetAttention(
              fleetAttention(
                'ribbon-study',
                attentionSession
                  ? { [attentionSession]: { kind: 'bell', since: 1 } }
                  : {}
              )
            )}
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
            commands={{
              closeTab: tabId =>
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
                ),
            }}
            onRenameTab={async (tabId, name) => {
              const durableSessionId = projects
                .flatMap(project => project.tabs)
                .find(item => item.id === tabId)?.durableSessionId;
              if (!durableSessionId) return null;
              const result = renameAgentName(
                agentNameRecords,
                durableSessionId,
                name,
                Date.now()
              );
              if (!result.ok) return result.reason;
              setAgentNameRecords(current =>
                current.map(record =>
                  record.durableSessionId === durableSessionId
                    ? result.record
                    : record
                )
              );
              return null;
            }}
            onRenameProject={() => undefined}
            onSetProjectColor={() => undefined}
          />
        </div>
        <div className="flex gap-2 font-mono text-[11px]">
          <button
            type="button"
            data-ribbon-study-empty-tail
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
