import type {
  AgentHarness,
  AgentPermissionMode,
  AgentSourceAction,
  AgentSourceActionResult,
  AgentSourceAdapterId,
  AgentSourceFact,
  AgentSourceRegistrySnapshot,
  PtyHarness,
} from '../agent-sources';
import type {
  ConsumptionUpdatedEvent,
  LiveConsumptionSnapshot,
  LiveConsumptionSnapshotRequest,
} from '../consumption/live-snapshot';
import type { AgentLaunchConfigurationInput } from '../launch-configurations';
import type { OperatorStatsPublicationPlan } from '../operator-stats/publication';
import type { OperatorStatsSyncEvent } from '../operator-stats/sync-state';
import type { KeyboardShortcutOverridesV1 } from '../shortcuts/keyboard-overrides';
import type { ConnectedSourceView } from '../sources/connected-source';
import type {
  AppearanceBootstrapSnapshot,
  CheckpointRequest,
  CommandEnginePhase,
  DiagnosticsReport,
  ElectronAuthError,
  ElectronAuthLinkConfig,
  ElectronAuthSessionTokens,
  ElectronAuthStartConfig,
  ExawattBuildInfo,
  OperatorStatsPlanRequest,
  OsAppearanceSnapshot,
  ProductUpdateStatus,
  ProjectResolveResult,
  ProjectScanResult,
  RenderErrorReport,
  SavedDiagnosticsReport,
  ShutdownStatus,
  UpdateReadyNotice,
  WorkspaceRecoveryState,
  WorkspaceStorageRecovery,
} from './app';
import type {
  AddConnectedSourceInput,
  AgentMappingInput,
  AuthorityRequestResult,
  ConnectSourceResult,
  ConnectedSourceAddResult,
  ConnectedSourceChange,
  ConnectedSourceStatusView,
  ConversationRequest,
  ConversationResult,
  ConversationUpdate,
  MapAgentsResult,
  RemoteAgentView,
  SendToAgentOptions,
  SendToAgentResult,
  SourceCommandAuthorityView,
  SshAliasCandidates,
} from './connected-sources';
import type {
  AgentModelCatalog,
  ClipboardPasteResult,
  ClipboardReadResult,
  ClosedSessionEntry,
  GoalVisual,
  GoalVisualRef,
  HarnessResumeCandidate,
  PtyAttention,
  PtyCreateOptions,
  PtyCreateResult,
  PtyDataEvent,
  PtyExitEvent,
  PtyIdentityEvent,
  PtyReentryRecap,
  PtySessionInfo,
  ReconciledResumeIdentity,
  RecentConversation,
  ResumeIdentityHint,
  RetainedHistoryMeta,
  RetainedTranscript,
  SessionCloneContext,
  SessionDelegation,
  SessionModelChange,
  SessionPauseBatchResult,
  WorktreeResult,
} from './pty';
import type {
  RoadmapProjectChange,
  RoadmapReadResult,
  RoadmapSessionEvidence,
  RoadmapUndoResult,
  RoadmapWriteRequest,
  RoadmapWriteResult,
} from './roadmap';
import type {
  AppearancePreferencesV1,
  ExawattSettings,
  OperatorProfileStateUpdate,
} from './settings';

/**
 * The desktop bridge's channel table: every channel's name and what crosses
 * it. Electron main registers a handler per request channel, preload invokes
 * them and relays the pushes, and the renderer's `window.electron` is built
 * from the same table (`api.ts`). A channel name exists here once.
 *
 * `args` is what preload hands `ipcRenderer.invoke` after its own defaults;
 * `result` is what main's handler resolves to. Both are checked below to be
 * free of functions: IPC carries structured-clonable values only, so a
 * callback declared here would be dropped on the way over while every test
 * double honoured it.
 */

interface Call<Args extends readonly unknown[], Result> {
  args: Args;
  result: Result;
}

/** Which registry to read: every source, or those that can launch. */
export type AgentSourceScope = 'all' | 'launch';

/** Renderer → main requests (`ipcRenderer.invoke` → `handleTrusted`). */
interface RequestTable {
  'agent-sources:list': Call<
    [scope: AgentSourceScope, refresh: boolean],
    AgentSourceRegistrySnapshot
  >;
  'agent-sources:remembered': Call<
    [scope: AgentSourceScope],
    AgentSourceRegistrySnapshot | null
  >;
  'agent-sources:act': Call<
    [adapterId: AgentSourceAdapterId, action: AgentSourceAction],
    AgentSourceActionResult
  >;

  /** Main's queued analytics facts, drained atomically. Re-validated in the
   *  renderer before any reaches the emission path. */
  'analytics:drain-main-events': Call<[], unknown[]>;

  'app:command-engine': Call<[], CommandEnginePhase>;
  'app:get-build-info': Call<[], ExawattBuildInfo>;
  /** `signedIn` is renderer-supplied because the session lives there. */
  'app:get-diagnostics-report': Call<[signedIn: boolean], DiagnosticsReport>;
  'app:save-diagnostics-report': Call<
    [signedIn: boolean],
    SavedDiagnosticsReport
  >;
  'app:report-render-error': Call<[report: RenderErrorReport], void>;
  'app:accent-color': Call<[], string | null>;
  'app:appearance': Call<[], OsAppearanceSnapshot>;
  'app:get-update-status': Call<[], ProductUpdateStatus>;
  'app:check-for-updates': Call<[], ProductUpdateStatus>;
  'app:restart-update': Call<[], void>;
  'app:set-workspace-checkpoint-owner': Call<
    [ownsWorkspaceState: boolean],
    void
  >;
  'app:complete-checkpoint': Call<[requestId: string, ok: boolean], void>;

  'auth:start-google': Call<[config: ElectronAuthStartConfig], void>;
  'auth:link-github': Call<[config: ElectronAuthLinkConfig], void>;
  'auth:install-test-session': Call<
    [
      config: Pick<ElectronAuthStartConfig, 'supabaseUrl' | 'supabaseAnonKey'>,
      tokens: ElectronAuthSessionTokens,
    ],
    void
  >;

  'connected-sources:list': Call<[], ConnectedSourceView[]>;
  'connected-sources:ssh-aliases': Call<[], SshAliasCandidates>;
  'connected-sources:add': Call<
    [input: AddConnectedSourceInput],
    ConnectedSourceAddResult
  >;
  'connected-sources:rename': Call<
    [id: string, displayName: string],
    { ok: boolean }
  >;
  'connected-sources:connect': Call<[id: string], ConnectSourceResult>;
  'connected-sources:status': Call<[], ConnectedSourceStatusView[]>;
  'connected-sources:agents': Call<[], RemoteAgentView[]>;
  'connected-sources:map-agents': Call<
    [id: string, mappings: AgentMappingInput[]],
    MapAgentsResult
  >;
  'connected-sources:disconnect': Call<[id: string], { ok: boolean }>;
  'connected-sources:detach': Call<[id: string], { ok: boolean }>;
  'connected-sources:command-authority': Call<[], SourceCommandAuthorityView[]>;
  'connected-sources:request-command-authority': Call<
    [id: string],
    AuthorityRequestResult
  >;
  'connected-sources:approve-command-authority': Call<
    [id: string],
    AuthorityRequestResult
  >;
  'connected-sources:relinquish-command-authority': Call<
    [id: string],
    AuthorityRequestResult
  >;
  'connected-sources:conversation': Call<
    [agentId: string, request?: ConversationRequest],
    ConversationResult
  >;
  /** No session-key parameter, by design: the address follows from the
   *  Agent, so no caller can aim a message at another context. */
  'connected-sources:send': Call<
    [agentId: string, text: string, options?: SendToAgentOptions],
    SendToAgentResult
  >;

  'consumption:snapshot': Call<
    [request?: LiveConsumptionSnapshotRequest],
    LiveConsumptionSnapshot
  >;
  'consumption:rescan': Call<[], void>;
  'consumption:cancel-scan': Call<[], void>;

  'dialog:openDirectory': Call<[title?: string], string | null>;
  'dialog:pathExists': Call<[path: string], boolean>;

  'feedback:set-authenticated': Call<[authenticated: boolean], void>;
  /** A bounded JPEG data URL. */
  'feedback:capture-screenshot': Call<[], string>;

  'menu:sync-accelerators': Call<[map: Record<string, string>], void>;
  'menu:sync-availability': Call<[map: Record<string, boolean>], void>;

  'operator-stats:plan': Call<
    [request: OperatorStatsPlanRequest],
    OperatorStatsPublicationPlan
  >;
  'operator-stats:record': Call<
    [event: OperatorStatsSyncEvent],
    ExawattSettings
  >;

  'projects:resolve': Call<[path: string], ProjectResolveResult>;
  'projects:scan-directory': Call<[path: string], ProjectScanResult>;

  'pty:create': Call<[options: PtyCreateOptions], PtyCreateResult>;
  'pty:pause-sessions': Call<
    [durableSessionIds: string[], confirmed?: boolean],
    SessionPauseBatchResult
  >;
  'pty:change-model': Call<
    [id: string, choice: SessionModelChange],
    PtyCreateResult
  >;
  'pty:list-agent-models': Call<
    [harness: AgentHarness, cwd: string, refresh: boolean],
    AgentModelCatalog
  >;
  'pty:write': Call<[id: string, data: string, operatorEngaged: boolean], void>;
  'pty:engage': Call<[id: string], void>;
  'pty:resize': Call<[id: string, cols: number, rows: number], void>;
  'pty:kill': Call<[id: string], void>;
  'pty:close-session': Call<
    [durableSessionId: string, discard: boolean],
    boolean
  >;
  'pty:archive-session': Call<
    [entry: Omit<ClosedSessionEntry, 'closedAt'>],
    ClosedSessionEntry
  >;
  'pty:closed-sessions': Call<[], ClosedSessionEntry[]>;
  'pty:reopen-session': Call<
    [durableSessionId: string],
    ClosedSessionEntry | null
  >;
  'pty:rename': Call<[id: string, title: string], void>;
  'pty:focus': Call<[id: string | null], void>;
  'pty:set-context-auth': Call<[accessToken: string | null], void>;
  'pty:correct-context': Call<
    [durableSessionId: string, label: string],
    string | null
  >;
  'pty:restore-context': Call<
    [durableSessionId: string, subtitle: string],
    string | null
  >;
  'pty:restore-goal-visual': Call<
    [durableSessionId: string, visual: GoalVisualRef],
    GoalVisual | null
  >;
  'pty:list': Call<[], PtySessionInfo[]>;
  'pty:buffer': Call<[id: string], string>;
  'pty:buffer-snapshot': Call<[id: string], { text: string; cursor: number }>;
  'pty:buffer-since': Call<
    [id: string, cursor: number],
    { text: string; cursor: number; truncated: boolean }
  >;
  'pty:retained-history-meta': Call<
    [durableSessionId: string],
    RetainedHistoryMeta
  >;
  'pty:clone-context': Call<[durableSessionId: string], SessionCloneContext>;
  'pty:retained-transcript': Call<
    [durableSessionId: string, maxLines?: number],
    RetainedTranscript
  >;
  'pty:paste-clipboard': Call<[id: string], ClipboardPasteResult>;
  'pty:clipboard-read': Call<[], ClipboardReadResult>;
  'pty:copy-text': Call<[text: string], void>;
  'pty:open-external': Call<[url: string], void>;
  'pty:open-path': Call<
    [filePath: string, cwd: string, options?: { contain?: boolean }],
    void
  >;
  'pty:worktree': Call<[repoDir: string, branch: string], WorktreeResult>;
  'pty:list-resume-candidates': Call<
    [harness: PtyHarness, cwd: string],
    HarnessResumeCandidate[]
  >;
  'pty:reconcile-resume-identities': Call<
    [hints: ResumeIdentityHint[]],
    ReconciledResumeIdentity[]
  >;
  'pty:list-recent-conversations': Call<[cwd: string], RecentConversation[]>;
  'pty:enrich-recent-conversations': Call<
    [cwd: string, accessToken: string],
    RecentConversation[]
  >;

  'roadmap:read': Call<[projectDir: string], RoadmapReadResult>;
  'roadmap:session-evidence': Call<[cwd: string], RoadmapSessionEvidence>;
  'roadmap:activity': Call<[projectDir: string], RoadmapProjectChange[]>;
  'roadmap:write-state': Call<
    [request: RoadmapWriteRequest],
    RoadmapWriteResult
  >;
  'roadmap:undo-state': Call<[token: string], RoadmapUndoResult>;
  'roadmap:watch': Call<[projectDir: string], void>;
  'roadmap:unwatch': Call<[projectDir: string], void>;

  'settings:get': Call<[], ExawattSettings>;
  'settings:set-appearance': Call<
    [appearance: AppearancePreferencesV1],
    ExawattSettings
  >;
  'settings:set-attention-notifications': Call<
    [enabled: boolean],
    ExawattSettings
  >;
  'settings:set-dock-badge': Call<[enabled: boolean], ExawattSettings>;
  'settings:set-hosted-context-labels': Call<
    [enabled: boolean],
    ExawattSettings
  >;
  'settings:set-hosted-conversation-summaries': Call<
    [enabled: boolean],
    ExawattSettings
  >;
  'settings:set-goal-visuals': Call<[enabled: boolean], ExawattSettings>;
  'settings:set-keyboard-shortcuts': Call<
    [overrides: KeyboardShortcutOverridesV1],
    ExawattSettings
  >;
  'settings:set-reentry-recap': Call<[enabled: boolean], ExawattSettings>;
  'settings:set-claude-plan-windows': Call<[enabled: boolean], ExawattSettings>;
  'settings:set-operator-auto-publish': Call<
    [enabled: boolean],
    ExawattSettings
  >;
  'settings:record-operator-profile-state': Call<
    [state: OperatorProfileStateUpdate],
    ExawattSettings
  >;
  'settings:record-agent-source-use': Call<
    [projectDir: string, source: string, usedAt: number],
    ExawattSettings
  >;
  'settings:set-agent-permission-mode': Call<
    [projectDir: string, source: string, permissionMode: AgentPermissionMode],
    ExawattSettings
  >;
  'settings:record-launch-configuration-success': Call<
    [
      projectDir: string,
      target: AgentLaunchConfigurationInput | { kind: 'shell' },
    ],
    ExawattSettings
  >;
  'settings:save-named-launch-configuration': Call<
    [configuration: AgentLaunchConfigurationInput, name: string],
    ExawattSettings
  >;
  'settings:rename-launch-configuration': Call<
    [id: string, name: string],
    ExawattSettings
  >;
  'settings:delete-launch-configuration': Call<[id: string], ExawattSettings>;
  'settings:set-launch-configuration-pinned': Call<
    [projectDir: string, id: string, pinned: boolean],
    ExawattSettings
  >;

  /** The machine's parsed symbolic-hotkeys plist as JSON (D19 amendment):
   *  `{}` is verified untouched preferences, null could not read. */
  'shortcuts:system-hotkeys': Call<[], unknown>;

  /** Workspace layout persistence; the renderer owns the shape. */
  'workspace:load': Call<[], unknown>;
  'workspace:save': Call<[state: unknown], void>;
  'workspace:recovery': Call<[], WorkspaceRecoveryState>;
  'workspace:storage-recovery': Call<[], WorkspaceStorageRecovery>;
  'workspace:retry-recovery': Call<[], void>;
  'workspace:reveal-recovery': Call<[], void>;
}

/**
 * Synchronous renderer → main reads (`ipcRenderer.sendSync`). One exists,
 * because preload runs before the document's first-paint script and
 * Electron's durable appearance has to win before any pixel is chosen.
 * Undefined when main refuses the sender mid-navigation.
 */
interface SyncRequestTable {
  'app:appearance-bootstrap': Call<[], AppearanceBootstrapSnapshot | undefined>;
}

/** Main → renderer pushes (`webContents.send` → a preload subscription). */
interface PushTable {
  'agent-sources:delegation': {
    adapterId: AgentSourceAdapterId;
    fact: AgentSourceFact | null;
  };
  /** A payload-free nudge that main queued analytics; drain on receipt. */
  'analytics:main-process-events': null;
  'app:appearance-changed': OsAppearanceSnapshot;
  'app:checkpoint-request': CheckpointRequest;
  'app:command-engine-changed': CommandEnginePhase;
  'app:shutdown-status': ShutdownStatus;
  'app:update-ready': UpdateReadyNotice;
  'app:update-status': ProductUpdateStatus;
  'auth:complete': void;
  'auth:error': ElectronAuthError;
  /** One token from `AUTH_LINK_OUTCOMES`, successes included, vetted by main. */
  'auth:link-outcome': string;
  'connected-sources:changed': ConnectedSourceChange;
  'connected-sources:conversation-updated': ConversationUpdate;
  'consumption:updated': ConsumptionUpdatedEvent;
  /** An application-menu command name (ENG-016 D8). */
  'menu:command': string;
  'pty:activity': { id: string; working: boolean };
  'pty:attention': { id: string; attention: PtyAttention | null };
  /** Main-owned ledger cardinality after archive, reopen, or reap. */
  'pty:closed-sessions-changed': number;
  'pty:context': { durableSessionId: string; summary: string };
  'pty:data': PtyDataEvent;
  /** Null means the Session has nothing live to report. */
  'pty:delegation': { id: string; delegation: SessionDelegation | null };
  'pty:engaged': { id: string };
  'pty:exit': PtyExitEvent;
  'pty:goal-visual': { durableSessionId: string; visual: GoalVisual };
  'pty:identity': PtyIdentityEvent;
  'pty:notification-click': { id: string };
  'pty:recap': PtyReentryRecap;
  'roadmap:file-changed': { projectDir: string };
  'settings:changed': ExawattSettings;
  /** The saved layout, relayed to every other window. */
  'workspace:changed': unknown;
}

/* ---- The structured-clone check ------------------------------------------ */

/** True when a value of this type could hold a function anywhere inside. */
type HoldsFunction<T> = T extends (...args: never[]) => unknown
  ? true
  : T extends readonly (infer Element)[]
    ? HoldsFunction<Element>
    : T extends object
      ? { [K in keyof T]-?: HoldsFunction<T[K]> }[keyof T] extends false
        ? false
        : true
      : false;

type CallsCrossTheBridge<Table> = {
  [C in keyof Table]: Table[C] extends Call<infer Args, infer Result>
    ? HoldsFunction<Args> extends false
      ? HoldsFunction<Result> extends false
        ? Table[C]
        : never
      : never
    : never;
};

type PushesCrossTheBridge<Table> = {
  [C in keyof Table]: HoldsFunction<Table[C]> extends false ? Table[C] : never;
};

/** Refuses, at compile time, a channel whose values could not be cloned. */
type CheckedCalls<Table extends CallsCrossTheBridge<Table>> = Table;
type CheckedPushes<Table extends PushesCrossTheBridge<Table>> = Table;

type DesktopBridgeRequests = CheckedCalls<RequestTable>;
export type DesktopBridgeSyncRequests = CheckedCalls<SyncRequestTable>;
type DesktopBridgePushes = CheckedPushes<PushTable>;

export type DesktopBridgeRequestChannel = keyof DesktopBridgeRequests;
export type DesktopBridgeSyncChannel = keyof DesktopBridgeSyncRequests;
export type DesktopBridgePushChannel = keyof DesktopBridgePushes;

export type DesktopBridgeArgs<C extends DesktopBridgeRequestChannel> =
  DesktopBridgeRequests[C]['args'];
export type DesktopBridgeResult<C extends DesktopBridgeRequestChannel> =
  DesktopBridgeRequests[C]['result'];
export type DesktopBridgePush<C extends DesktopBridgePushChannel> =
  DesktopBridgePushes[C];

/** A `window.electron` method that is exactly one request channel. */
export type BridgeInvoke<C extends DesktopBridgeRequestChannel> = (
  ...args: DesktopBridgeArgs<C>
) => Promise<DesktopBridgeResult<C>>;

/** A `window.electron` subscription to one push channel. The handler runs
 *  in the renderer; the returned disposer removes only that handler. */
export type BridgeSubscribe<C extends DesktopBridgePushChannel> = (
  handler: (payload: DesktopBridgePush<C>) => void
) => () => void;

export type { HoldsFunction };
