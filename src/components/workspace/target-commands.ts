/**
 * Target commands: the one registry for every verb that acts on a thing on
 * screen, an Agent tab, a coworker view, a Project or a terminal.
 *
 * Operator, 2026-10-22: "Need cmd+k keyboard shortcut for mark unread. For
 * that and all such things in the future - should never diverge right-click
 * menu items and cmd+k availability." Mark unread lived in the tab's
 * right-click menu alone because each context menu built its own item list
 * and ⌘K built another, with nothing joining them.
 *
 * Each command is declared once here: its target kind, label, when it is
 * offered for a given target, what it runs, and the chord that runs it on the
 * active target. Every surface renders from `resolveTargetCommands`:
 *
 *   - a right-click (or ⇧F10) menu resolves it for the target under the
 *     pointer, through `CommandMenu`;
 *   - ⌘K resolves it for the subjects the workspace publishes (the selected
 *     Agent, its Project, its terminal), through `useCommandSubjects`;
 *   - a chord and a native menu item name the same command through `verb`,
 *     the command-verb manifest entry that owns the binding and the menu row.
 *
 * So a command offered in a menu is in ⌘K for the same target, with the same
 * label, the same disabled reason and the same handler, and the reverse.
 * `command-parity.test.tsx` renders both surfaces for the same targets and
 * fails on any difference. The only declared exception is `reach.menuOnly`,
 * which must carry a written reason.
 */
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  BellDot,
  ClipboardPaste,
  Cloud,
  Columns2,
  Copy,
  CopyPlus,
  ExternalLink,
  FolderSearch,
  FolderX,
  Link,
  ListRestart,
  Palette,
  Pause,
  PenLine,
  Play,
  SquarePlus,
  TextSelect,
  XCircle,
} from 'lucide-react';
import { getCommandVerb } from '@exawatt/core';
import {
  SESSION_LIFECYCLE_VERB_LABEL,
  SESSION_PROJECT_VERB_LABEL,
  sessionLifecyclePresentation,
} from '@exawatt/ui-model';
import { shortcutRegistry } from '@/lib/shortcuts/registry';
import {
  fixedFamilyBindings,
  getWorkspaceFixedFamily,
} from '@/lib/shortcuts/fixed-families';
import {
  agentNameOf,
  type AgentNames,
} from '@/lib/agent-names/agent-name-store';
import type { KeyBinding, ShortcutKeys } from '@/types/shortcuts';
import { sessionDisplayCopy } from './session-display-copy';
import { tabCanClone, type CloneSessionTarget } from './session-clone';
import { requestProjectEdit, requestTabRename } from './session-jump';
import { tabIsPinnable } from './split-layout';
import { TERMINAL_CHORD_KEYS } from './terminal-chords';
import { terminalCommandHandle } from './terminal-command-handles';
import {
  terminalTargetCopyVerb,
  terminalTargetLabel,
  type TerminalTarget,
} from './terminal-targets';
import {
  isSessionTab,
  projectRootPath,
  tabCanResumeAsAgent,
  tabIsLive,
  type Project,
  type RemoteAgentTab,
  type SessionTab,
} from './workspace-state/workspace-model';

// ── Targets ─────────────────────────────────────────────────────────────────

export type CommandTarget =
  | { kind: 'session'; project: Project; tab: SessionTab }
  | { kind: 'coworker'; project: Project; tab: RemoteAgentTab }
  | { kind: 'project'; project: Project }
  /** `link` is the target under the pointer; null from the keyboard and ⌘K. */
  | { kind: 'terminal'; sessionId: string; link: TerminalTarget | null };

type CommandTargetKind = CommandTarget['kind'];
/** The targets that live in the workspace's tab and Project model. */
type WorkspaceCommandTarget = Exclude<
  CommandTarget,
  { kind: 'terminal' }
>;
type TargetOf<K extends CommandTargetKind> = Extract<
  CommandTarget,
  { kind: K }
>;

/** The workspace operations commands run. An absent operation means the
 *  shell on screen cannot do it, and the commands that need it are not
 *  offered there (the Demo shell has no Finder, for one). */
export interface TargetCommandOps {
  closeTab(tabId: string): void;
  markUnread?(tabId: string): void;
  resumeTab?(tabId: string): void;
  cloneTab?(tabId: string, target: CloneSessionTarget): void;
  togglePinTab?(tabId: string): void;
  moveTab?(tabId: string, delta: 1 | -1): void;
  revealPath?(path: string): void;
  openCloud?(): void;
  newAgent?(dir: string): void;
  pauseProject?(dir: string): void;
  resumeProject?(dir: string): void;
  moveProject?(dir: string, delta: 1 | -1): void;
  closeProject?(dir: string): void;
}

/** The workspace facts offers read. */
interface TargetCommandFacts {
  projects: readonly Project[];
  pinnedTabId: string | null;
  summaries: Readonly<Record<string, string>>;
  engaged: Readonly<Record<string, boolean>>;
  agentNames: AgentNames;
  cloneTargets: readonly CloneSessionTarget[];
}

export interface TargetCommandScope {
  ops: TargetCommandOps;
  facts: TargetCommandFacts;
}

/** Find a target again from its identity, in the current workspace. */
export function findCommandTarget(
  projects: readonly Project[],
  ref: { kind: 'project'; dir: string } | { kind: 'tab'; tabId: string }
): WorkspaceCommandTarget | null {
  if (ref.kind === 'project') {
    const project = projects.find(candidate => candidate.dir === ref.dir);
    return project ? { kind: 'project', project } : null;
  }
  for (const project of projects) {
    const tab = project.tabs.find(candidate => candidate.id === ref.tabId);
    if (!tab) continue;
    return isSessionTab(tab)
      ? { kind: 'session', project, tab }
      : { kind: 'coworker', project, tab };
  }
  return null;
}

/** What a target is called on the surfaces that name it: the ⌘K group
 *  heading and the menu's accessible name. */
export function describeCommandTarget(
  target: CommandTarget,
  facts: Pick<TargetCommandFacts, 'summaries' | 'agentNames'> | null
): { kind: string; name: string } {
  switch (target.kind) {
    case 'session': {
      const { tab } = target;
      const name = sessionDisplayCopy({
        harness: tab.harness,
        title: tab.title,
        titleKind: tab.titleKind,
        lifecycle: tab.lifecycle,
        summary: facts?.summaries[tab.durableSessionId],
        name: facts
          ? agentNameOf(facts.agentNames, tab.durableSessionId)
          : null,
      }).primary;
      return { kind: tab.harness === 'shell' ? 'Shell' : 'Agent', name };
    }
    case 'coworker':
      return { kind: 'Coworker', name: target.tab.title };
    case 'project':
      return { kind: 'Project', name: target.project.name };
    case 'terminal':
      return { kind: 'Terminal', name: 'Terminal' };
  }
}

// ── Declarations ────────────────────────────────────────────────────────────

/** Where the row prints its chord from. */
type ShortcutSource =
  /** a rebindable manifest verb: the effective binding, overrides included */
  | { verb: string }
  /** one direction of a fixed D20 family (displayed, never rebindable) */
  | { fixed: 'fixed-move-tab' | 'fixed-move-project'; index: 0 | 1 }
  /** a chord the surface itself owns (the terminal's) */
  | { keys: KeyBinding };

/** Menu sections, in the order a menu draws them. */
type CommandSection =
  | 'target'
  | 'act'
  | 'arrange'
  | 'open'
  | 'run'
  | 'edit'
  | 'end';

interface Offer {
  /** Present when the command applies to this target but cannot run now. */
  disabledReason?: string;
}

interface ChildCommand {
  id: string;
  label: string;
  detail?: string;
  accessibleLabel?: string;
  run(): void;
}

interface CommandSpec<K extends CommandTargetKind> {
  /** stable id: menu row id, ⌘K row id, recents key */
  id: string;
  target: K;
  label: (target: TargetOf<K>, scope: TargetCommandScope) => string;
  keywords: readonly string[];
  icon: LucideIcon;
  section: CommandSection;
  shortcut?: (target: TargetOf<K>) => ShortcutSource | null;
  danger?: true;
  /** Rows that hand focus to something else (an editor, a dialog). */
  focusAfterSelect?: 'none';
  /** null: not offered for this target in this shell. */
  offer: (target: TargetOf<K>, scope: TargetCommandScope) => Offer | null;
  run?: (target: TargetOf<K>, scope: TargetCommandScope) => void;
  /** A drill-in (Clone to…): the menu nests these, ⌘K lists them flat. */
  children?: (
    target: TargetOf<K>,
    scope: TargetCommandScope
  ) => readonly ChildCommand[];
  /** ENG-026 announced row: visible in the menu, inert, never in ⌘K (a
   *  palette entry that cannot execute is a worse lie than a muted row). */
  announced?: string;
  note?: string;
  /** Product hooks on the menu row (evals address rows by these). */
  attributes?: Record<`data-${string}`, string>;
  /** The ONE way out of parity: a written reason this command cannot be
   *  reached from ⌘K. The parity test pins the set of commands that use it. */
  reach?: { menuOnly: string };
}

type AnyCommandSpec = {
  [K in CommandTargetKind]: CommandSpec<K>;
}[CommandTargetKind];

const define = <K extends CommandTargetKind>(spec: CommandSpec<K>) =>
  spec as unknown as AnyCommandSpec;

const verb = (id: string) => () => ({ verb: id });

/** Terminal commands read no workspace state; every other kind does. */
const TERMINAL_SCOPE: TargetCommandScope = {
  ops: { closeTab: () => undefined },
  facts: {
    projects: [],
    pinnedTabId: null,
    summaries: {},
    engaged: {},
    agentNames: new Map(),
    cloneTargets: [],
  },
};

function tabMove(project: Project, tabId: string, delta: 1 | -1): Offer | null {
  if (project.tabs.length < 2) return null;
  const index = project.tabs.findIndex(tab => tab.id === tabId);
  if (delta < 0 && index === 0) {
    return { disabledReason: 'Already the first Session in the Project' };
  }
  if (delta > 0 && index === project.tabs.length - 1) {
    return { disabledReason: 'Already the last Session in the Project' };
  }
  return {};
}

function projectMove(
  projects: readonly Project[],
  dir: string,
  delta: 1 | -1
): Offer | null {
  if (projects.length < 2) return null;
  const index = projects.findIndex(project => project.dir === dir);
  if (delta < 0 && index === 0) {
    return { disabledReason: 'Already the first open Project' };
  }
  if (delta > 0 && index === projects.length - 1) {
    return { disabledReason: 'Already the last open Project' };
  }
  return {};
}

const isDraft = (tab: SessionTab) => tab.lifecycle === 'draft';
const MOVE_KEYWORDS = ['move', 'reorder', 'arrange', 'nudge', 'order'];

type TabTarget = TargetOf<'session' | 'coworker'>;

/** Tab moves, for both kinds of tab: one declaration per direction and kind. */
function tabMoveCommands(kind: TabTarget['kind']) {
  return ([-1, 1] as const).map(delta =>
    define<TabTarget['kind']>({
      id: `${kind}.move-${delta < 0 ? 'left' : 'right'}`,
      target: kind,
      label: () => (delta < 0 ? 'Move left' : 'Move right'),
      keywords: [...MOVE_KEYWORDS, 'tab', delta < 0 ? 'left' : 'right'],
      icon: delta < 0 ? ArrowLeftToLine : ArrowRightToLine,
      section: 'arrange',
      shortcut: () => ({ fixed: 'fixed-move-tab', index: delta < 0 ? 0 : 1 }),
      offer: (target: TabTarget, { ops }) =>
        ops.moveTab && !(target.kind === 'session' && isDraft(target.tab))
          ? tabMove(target.project, target.tab.id, delta)
          : null,
      run: (target: TabTarget, { ops }) => ops.moveTab?.(target.tab.id, delta),
    })
  );
}

const pinCommand = (kind: TabTarget['kind']) =>
  define<TabTarget['kind']>({
    id: `${kind}.pin`,
    target: kind,
    label: (target: TabTarget, { facts }) =>
      target.tab.id === facts.pinnedTabId ? 'Unpin from split' : 'Pin in split',
    keywords: ['split', 'pane', 'pin', 'unpin', 'side by side', 'watch'],
    icon: Columns2,
    section: 'arrange',
    shortcut: verb('workspace-split'),
    offer: (target: TabTarget, { ops }) =>
      ops.togglePinTab && tabIsPinnable(target.tab) ? {} : null,
    run: (target: TabTarget, { ops }) => ops.togglePinTab?.(target.tab.id),
  });

const TARGET_COMMANDS: readonly AnyCommandSpec[] = [
  // ── An Agent or shell tab ────────────────────────────────────────────────
  define<'session'>({
    id: 'session.resume',
    target: 'session',
    label: target =>
      sessionLifecyclePresentation(target.tab).verb === 'new-shell'
        ? SESSION_LIFECYCLE_VERB_LABEL['new-shell']
        : SESSION_LIFECYCLE_VERB_LABEL.resume,
    keywords: ['resume', 'restart', 'relaunch', 'recover', 'paused', 'wake'],
    icon: Play,
    section: 'act',
    // The chord resumes Agents only; a shell's restart has none.
    shortcut: target =>
      tabCanResumeAsAgent(target.tab)
        ? { verb: 'workspace-resume-agent' }
        : null,
    offer: (target, { ops }) => {
      if (!ops.resumeTab || tabIsLive(target.tab) || isDraft(target.tab)) {
        return null;
      }
      const { verb: lifecycleVerb } = sessionLifecyclePresentation(target.tab);
      return lifecycleVerb === 'resume' || lifecycleVerb === 'new-shell'
        ? {}
        : null;
    },
    run: (target, { ops }) => ops.resumeTab?.(target.tab.id),
  }),
  define<'session'>({
    id: 'session.mark-unread',
    target: 'session',
    label: () => 'Mark unread',
    keywords: ['mark', 'unread', 'later', 'remind', 'attention', 'queue'],
    icon: BellDot,
    section: 'act',
    offer: (target, { ops }) =>
      ops.markUnread && !isDraft(target.tab) ? {} : null,
    run: (target, { ops }) => ops.markUnread?.(target.tab.id),
  }),
  define<'session'>({
    id: 'session.rename',
    target: 'session',
    label: () => 'Rename…',
    keywords: ['rename', 'name', 'title', 'tab'],
    icon: PenLine,
    section: 'act',
    shortcut: verb('workspace-rename'),
    focusAfterSelect: 'none',
    offer: target => (isDraft(target.tab) ? null : {}),
    run: target => requestTabRename(target.tab.id),
  }),
  define<'session'>({
    id: 'session.clone',
    target: 'session',
    label: () => 'Clone to…',
    keywords: ['clone', 'handoff', 'new session', 'copy', 'fork'],
    icon: CopyPlus,
    section: 'act',
    offer: (target, { ops, facts }) =>
      ops.cloneTab &&
      facts.cloneTargets.length > 0 &&
      tabCanClone(target.tab, {
        engaged: !!(
          target.tab.sessionId && facts.engaged[target.tab.sessionId]
        ),
        contextSummary: facts.summaries[target.tab.durableSessionId],
      })
        ? {}
        : null,
    // The SAME setups ⌘T offers, under the same names: model on the anchor,
    // engine-reported effort on the quiet note. Two setups on one model share
    // a label by design, so a row's identity is the Launch Configuration id.
    children: (target, { ops, facts }) =>
      facts.cloneTargets.map(clone => ({
        id: clone.id,
        label: clone.label,
        detail: clone.detail,
        accessibleLabel: `Clone to ${clone.accessibleLabel}`,
        run: () => ops.cloneTab?.(target.tab.id, clone),
      })),
  }),
  pinCommand('session'),
  ...tabMoveCommands('session'),
  define<'session'>({
    id: 'session.reveal',
    target: 'session',
    label: () => 'Reveal in Finder',
    keywords: ['reveal', 'finder', 'folder', 'directory', 'path', 'worktree'],
    icon: FolderSearch,
    section: 'open',
    offer: (target, { ops }) =>
      ops.revealPath && !isDraft(target.tab) ? {} : null,
    run: (target, { ops }) => ops.revealPath?.(target.tab.cwd),
  }),
  // ENG-026 N3 / ENG-033: the per-Agent Push to cloud control, announced
  // where it will really live, with the Cloud preview surface's contextual
  // entry point beside it.
  define<'session'>({
    id: 'session.push-to-cloud',
    target: 'session',
    label: () => 'Push to cloud',
    keywords: [],
    icon: Cloud,
    section: 'open',
    announced:
      'run this Agent on an Exawatt-hosted machine or a Gemini managed environment (Cloud)',
    offer: target =>
      target.tab.harness !== 'shell' && !isDraft(target.tab) ? {} : null,
  }),
  define<'session'>({
    id: 'session.cloud',
    target: 'session',
    label: () => 'Cloud',
    keywords: ['cloud', 'hosted', 'remote', 'push'],
    icon: Cloud,
    section: 'open',
    note: 'Coming soon',
    offer: (target, { ops }) =>
      ops.openCloud && target.tab.harness !== 'shell' && !isDraft(target.tab)
        ? {}
        : null,
    run: (_target, { ops }) => ops.openCloud?.(),
  }),
  define<'session'>({
    id: 'session.close',
    target: 'session',
    label: target => (isDraft(target.tab) ? 'Discard' : 'Close'),
    keywords: ['close', 'end', 'kill', 'discard', 'tab', 'session'],
    icon: XCircle,
    section: 'end',
    shortcut: verb('workspace-close-tab'),
    danger: true,
    focusAfterSelect: 'none',
    offer: () => ({}),
    run: (target, { ops }) => ops.closeTab(target.tab.id),
  }),

  // ── A connected coworker's view ──────────────────────────────────────────
  pinCommand('coworker'),
  ...tabMoveCommands('coworker'),
  define<'coworker'>({
    id: 'coworker.close',
    target: 'coworker',
    // Not "Close": what closes is Exawatt's view. The coworker keeps working
    // on its own source, so the verb says which of the two it ends.
    label: () => 'Close view',
    keywords: ['close', 'view', 'coworker', 'hide'],
    icon: XCircle,
    section: 'end',
    shortcut: verb('workspace-close-tab'),
    focusAfterSelect: 'none',
    offer: () => ({}),
    run: (target, { ops }) => ops.closeTab(target.tab.id),
  }),

  // ── A Project ────────────────────────────────────────────────────────────
  define<'project'>({
    id: 'project.new-agent',
    target: 'project',
    label: () => 'New agent',
    keywords: ['new', 'agent', 'start', 'launch', 'tab'],
    icon: SquarePlus,
    section: 'act',
    shortcut: verb('workspace-new-agent'),
    focusAfterSelect: 'none',
    offer: (target, { ops }) =>
      ops.newAgent && projectRootPath(target.project) ? {} : null,
    run: (target, { ops }) => {
      const rootPath = projectRootPath(target.project);
      if (rootPath) ops.newAgent?.(rootPath);
    },
  }),
  define<'project'>({
    id: 'project.rename',
    target: 'project',
    label: () => 'Rename / color…',
    keywords: ['rename', 'color', 'colour', 'recolor', 'swatch', 'hue'],
    icon: Palette,
    section: 'act',
    focusAfterSelect: 'none',
    offer: () => ({}),
    run: target => requestProjectEdit(target.project.dir),
  }),
  ...([-1, 1] as const).map(delta =>
    define<'project'>({
      id: `project.move-${delta < 0 ? 'left' : 'right'}`,
      target: 'project',
      label: () => (delta < 0 ? 'Move left' : 'Move right'),
      keywords: [...MOVE_KEYWORDS, 'project', delta < 0 ? 'left' : 'right'],
      icon: delta < 0 ? ArrowLeftToLine : ArrowRightToLine,
      section: 'arrange',
      shortcut: () => ({
        fixed: 'fixed-move-project',
        index: delta < 0 ? 0 : 1,
      }),
      offer: (target, { ops, facts }) =>
        ops.moveProject
          ? projectMove(facts.projects, target.project.dir, delta)
          : null,
      run: (target, { ops }) => ops.moveProject?.(target.project.dir, delta),
    })
  ),
  define<'project'>({
    id: 'project.reveal',
    target: 'project',
    label: () => 'Reveal in Finder',
    keywords: ['reveal', 'finder', 'folder', 'directory', 'path', 'root'],
    icon: FolderSearch,
    section: 'open',
    offer: (target, { ops }) =>
      ops.revealPath && projectRootPath(target.project) ? {} : null,
    run: (target, { ops }) => {
      const rootPath = projectRootPath(target.project);
      if (rootPath) ops.revealPath?.(rootPath);
    },
  }),
  define<'project'>({
    id: 'project.pause',
    target: 'project',
    label: () => SESSION_PROJECT_VERB_LABEL.pause,
    keywords: ['pause', 'stop', 'agents', 'project', 'suspend'],
    icon: Pause,
    section: 'run',
    focusAfterSelect: 'none',
    offer: (target, { ops }) => {
      if (!ops.pauseProject) return null;
      const running = target.project.tabs.some(
        tab =>
          isSessionTab(tab) && tab.harness !== 'shell' && tab.sessionId !== null
      );
      return running
        ? {}
        : { disabledReason: 'No running local Agents in this Project' };
    },
    run: (target, { ops }) => ops.pauseProject?.(target.project.dir),
  }),
  define<'project'>({
    id: 'project.resume',
    target: 'project',
    label: () => SESSION_PROJECT_VERB_LABEL.resume,
    keywords: ['resume', 'restart', 'relaunch', 'recover', 'paused', 'agents'],
    icon: ListRestart,
    section: 'run',
    offer: (target, { ops }) =>
      ops.resumeProject && target.project.tabs.some(tabCanResumeAsAgent)
        ? {}
        : null,
    run: (target, { ops }) => ops.resumeProject?.(target.project.dir),
  }),
  define<'project'>({
    id: 'project.close',
    target: 'project',
    label: () => 'Close project',
    keywords: ['close', 'project', 'put away', 'dismiss', 'all sessions'],
    icon: FolderX,
    section: 'end',
    danger: true,
    focusAfterSelect: 'none',
    offer: (_target, { ops }) => (ops.closeProject ? {} : null),
    run: (target, { ops }) => ops.closeProject?.(target.project.dir),
  }),

  // ── A terminal ───────────────────────────────────────────────────────────
  // The target under the pointer first, when there is one, then the edit
  // verbs. Each row runs after the menu has handed focus back, so Paste lands
  // in a focused terminal.
  define<'terminal'>({
    id: 'terminal.open-link',
    target: 'terminal',
    label: target =>
      target.link ? `Open ${terminalTargetLabel(target.link)}` : '',
    keywords: ['open', 'link', 'url', 'path'],
    icon: ExternalLink,
    section: 'target',
    attributes: { 'data-terminal-open-target': '' },
    offer: target => (target.link ? {} : null),
    run: target => {
      if (target.link) {
        terminalCommandHandle(target.sessionId)?.openLink(target.link);
      }
    },
    reach: {
      menuOnly:
        'Its target is the link under the pointer; ⌘K and the keyboard menu have no pointer, so they have no link to name.',
    },
  }),
  define<'terminal'>({
    id: 'terminal.copy-link',
    target: 'terminal',
    label: target => (target.link ? terminalTargetCopyVerb(target.link) : ''),
    keywords: ['copy', 'link', 'url', 'path'],
    icon: Link,
    section: 'target',
    attributes: { 'data-terminal-copy-target': '' },
    offer: target => (target.link ? {} : null),
    run: target => {
      if (target.link) {
        terminalCommandHandle(target.sessionId)?.copyLink(target.link);
      }
    },
    reach: {
      menuOnly:
        'Its target is the link under the pointer; ⌘K and the keyboard menu have no pointer, so they have no link to name.',
    },
  }),
  define<'terminal'>({
    id: 'terminal.copy',
    target: 'terminal',
    label: () => 'Copy',
    keywords: ['copy', 'selection', 'clipboard', 'terminal'],
    icon: Copy,
    section: 'edit',
    shortcut: () => ({ keys: TERMINAL_CHORD_KEYS.copy }),
    offer: () => ({}),
    run: target => terminalCommandHandle(target.sessionId)?.copySelection(),
  }),
  define<'terminal'>({
    id: 'terminal.paste',
    target: 'terminal',
    label: () => 'Paste',
    keywords: ['paste', 'clipboard', 'terminal'],
    icon: ClipboardPaste,
    section: 'edit',
    shortcut: () => ({ keys: TERMINAL_CHORD_KEYS.paste }),
    offer: () => ({}),
    run: target => terminalCommandHandle(target.sessionId)?.paste(),
  }),
  define<'terminal'>({
    id: 'terminal.select-all',
    target: 'terminal',
    label: () => 'Select All',
    keywords: ['select', 'all', 'terminal', 'scrollback'],
    icon: TextSelect,
    section: 'edit',
    shortcut: () => ({ keys: TERMINAL_CHORD_KEYS['select-all'] }),
    offer: () => ({}),
    run: target => terminalCommandHandle(target.sessionId)?.selectAll(),
  }),
];

/** Every declared command id: the ⌘K row ids the manifest joins against. */
export const TARGET_COMMAND_IDS: ReadonlySet<string> = new Set(
  TARGET_COMMANDS.map(command => command.id)
);

/** The ids ⌘K can render: every command except an announced row and a
 *  menu-only one. The command-verb manifest's palette rows join this. */
export const PALETTE_TARGET_COMMAND_IDS: ReadonlySet<string> = new Set(
  TARGET_COMMANDS.filter(command => !command.announced && !command.reach).map(
    command => command.id
  )
);

/** Commands ⌘K can never reach, each with its written reason. */
export const MENU_ONLY_TARGET_COMMANDS: ReadonlyMap<string, string> = new Map(
  TARGET_COMMANDS.flatMap(command =>
    command.reach ? [[command.id, command.reach.menuOnly] as const] : []
  )
);

// ── Resolution: the one projection every surface renders ─────────────────

export interface ResolvedTargetCommand {
  /** command id, or `<command id>:<child id>` for a drill-in row */
  id: string;
  label: string;
  accessibleLabel?: string;
  detail?: string;
  note?: string;
  icon: LucideIcon;
  keywords: readonly string[];
  shortcut: ShortcutKeys | null;
  section: CommandSection;
  danger: boolean;
  disabledReason: string | null;
  /** an announced row's coming-soon description; such a row never runs */
  announced: string | null;
  focusAfterSelect?: 'none';
  attributes?: Record<`data-${string}`, string>;
  run: (() => void) | null;
  children: readonly ResolvedTargetCommand[];
  menuOnly: boolean;
}

function resolveShortcut(source: ShortcutSource | null): ShortcutKeys | null {
  if (!source) return null;
  if ('keys' in source) return source.keys;
  if ('fixed' in source) {
    return (
      fixedFamilyBindings(getWorkspaceFixedFamily(source.fixed))[
        source.index
      ] ?? null
    );
  }
  // The registry carries the operator's override once the provider has
  // loaded; until then the manifest default stands in, so the hint is
  // present from the first paint (the dialog primary-action rule).
  return (
    shortcutRegistry.getEffectiveKeys(source.verb) ??
    getCommandVerb(source.verb).keys ??
    null
  );
}

/**
 * The commands offered for one target, in declaration order. Both the
 * context menu and ⌘K render exactly this list.
 */
export function resolveTargetCommands(
  target: CommandTarget,
  scope: TargetCommandScope | null
): ResolvedTargetCommand[] {
  const effective =
    target.kind === 'terminal' ? (scope ?? TERMINAL_SCOPE) : scope;
  if (!effective) return [];
  const rows: ResolvedTargetCommand[] = [];
  for (const command of TARGET_COMMANDS) {
    if (command.target !== target.kind) continue;
    const spec = command as unknown as CommandSpec<typeof target.kind>;
    const offer = spec.offer(target as never, effective);
    if (!offer) continue;
    const label = spec.label(target as never, effective);
    const children = (spec.children?.(target as never, effective) ?? []).map(
      (child): ResolvedTargetCommand => ({
        id: `${command.id}:${child.id}`,
        label: child.label,
        accessibleLabel: child.accessibleLabel,
        detail: child.detail,
        icon: spec.icon,
        keywords: [...spec.keywords, child.label],
        shortcut: null,
        section: spec.section,
        danger: false,
        disabledReason: null,
        announced: null,
        run: child.run,
        children: [],
        menuOnly: !!spec.reach,
      })
    );
    rows.push({
      id: command.id,
      label,
      note: spec.note,
      icon: spec.icon,
      keywords: spec.keywords,
      shortcut: resolveShortcut(spec.shortcut?.(target as never) ?? null),
      section: spec.section,
      danger: spec.danger === true,
      disabledReason: offer.disabledReason ?? null,
      announced: spec.announced ?? null,
      focusAfterSelect: spec.focusAfterSelect,
      attributes: spec.attributes,
      run:
        spec.announced || !spec.run
          ? null
          : () => spec.run?.(target as never, effective),
      children,
      menuOnly: !!spec.reach,
    });
  }
  return rows;
}

/**
 * The ⌘K projection of the same list: the rows a reader can run, flat. An
 * announced row is not a command and a menu-only one has no ⌘K target; a
 * drill-in lists its choices, each named with the verb it completes.
 */
export function paletteTargetCommands(
  rows: readonly ResolvedTargetCommand[]
): ResolvedTargetCommand[] {
  return rows.flatMap(row => {
    if (row.announced || row.menuOnly) return [];
    if (row.children.length === 0) return [row];
    const verbPrefix = row.label.replace(/…$/, '');
    return row.children.map(child => ({
      ...child,
      label: `${verbPrefix} ${child.label}`,
    }));
  });
}
