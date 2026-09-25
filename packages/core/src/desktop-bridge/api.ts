import type {
  AgentSourceScope,
  BridgeInvoke,
  BridgeSubscribe,
  DesktopBridgeResult,
  HoldsFunction,
} from './channels';
import type { AppearanceBootstrapSnapshot, RenderErrorReport } from './app';
import type { AgentHarness } from '../agent-sources';

/**
 * `window.electron`: the object preload exposes, and the only way the
 * renderer reaches Electron main. Preload's object `satisfies` this type, so
 * a member either side has and the other lacks fails `tsc`.
 *
 * A method is written as `BridgeInvoke<channel>` when it is exactly one
 * request channel. The few written out by hand are the ones where preload
 * supplies a default the renderer may omit; their results still come from
 * the channel table. Optional members are the ones preload genuinely
 * withholds: the update channel of a distribution without one, and the test
 * hooks of a non-test launch.
 */

export interface DesktopAgentSourcesApi {
  /** Delegation-capability facts as a source reports them. */
  onDelegation: BridgeSubscribe<'agent-sources:delegation'>;
  list: (
    scope?: AgentSourceScope,
    refresh?: boolean
  ) => Promise<DesktopBridgeResult<'agent-sources:list'>>;
  /** What this machine last observed, with no probe; null when nothing yet. */
  remembered: (
    scope?: AgentSourceScope
  ) => Promise<DesktopBridgeResult<'agent-sources:remembered'>>;
  act: BridgeInvoke<'agent-sources:act'>;
}

/**
 * ENG-010 C1 and ENG-033 H2. Saved connections to a Gateway, local or hosted.
 * One command channel and no more: ask for write access, read a coworker's
 * primary conversation, send to it, follow the reply.
 */
export interface DesktopConnectedSourcesApi {
  list: BridgeInvoke<'connected-sources:list'>;
  /** Passive: reads SSH config text, never contacts a server. */
  sshAliases: BridgeInvoke<'connected-sources:ssh-aliases'>;
  add: BridgeInvoke<'connected-sources:add'>;
  rename: BridgeInvoke<'connected-sources:rename'>;
  /**
   * The operator act that reaches a server; read-only end to end. One
   * argument and one answer, deliberately: progress travels on `onChanged`,
   * which broadcasts every phase the session enters.
   */
  connect: BridgeInvoke<'connected-sources:connect'>;
  /** Per-source observation freshness. Never a claim about remote work. */
  status: BridgeInvoke<'connected-sources:status'>;
  /** The projected coworkers, for the roster. */
  agents: BridgeInvoke<'connected-sources:agents'>;
  /** Exawatt-side Project/name decisions. Issues no Gateway call. */
  mapAgents: BridgeInvoke<'connected-sources:map-agents'>;
  /** Stops observing. The remote installation keeps working. */
  disconnect: BridgeInvoke<'connected-sources:disconnect'>;
  /** Removes Exawatt's record only. The remote installation is untouched. */
  detach: BridgeInvoke<'connected-sources:detach'>;
  /** Which source moved, its phase and freshness; never a topology payload.
   *  Also the connect flow's progress channel. */
  onChanged: BridgeSubscribe<'connected-sources:changed'>;
  /** What Exawatt may do with each source. Never a freshness signal. */
  commandAuthority: BridgeInvoke<'connected-sources:command-authority'>;
  /** Asks the source to raise Exawatt from observation to conversation. */
  requestCommandAuthority: BridgeInvoke<'connected-sources:request-command-authority'>;
  /** Asks, runs the source's own approval of Exawatt's own request over the
   *  SSH login, then asks again (ENG-033 H2.4 P3). */
  approveCommandAuthority: BridgeInvoke<'connected-sources:approve-command-authority'>;
  /** Hands write access back; observation continues. */
  relinquishCommandAuthority: BridgeInvoke<'connected-sources:relinquish-command-authority'>;
  /** One coworker's primary conversation, bounded. A read, not a command. */
  conversation: BridgeInvoke<'connected-sources:conversation'>;
  /** Sends to that coworker's primary conversation and nowhere else. */
  send: BridgeInvoke<'connected-sources:send'>;
  /** Bounded, ordered reply updates keyed by Agent and run. */
  onConversationUpdate: BridgeSubscribe<'connected-sources:conversation-updated'>;
}

interface DesktopOperatorStatsApi {
  /** Plans the publications a sync sends (BUG-164). */
  plan: BridgeInvoke<'operator-stats:plan'>;
  /** Folds one sync step into the durable record; a failure is also written
   *  to the diagnostics log. */
  record: BridgeInvoke<'operator-stats:record'>;
}

/**
 * BUG-016: the command engine's own state. Every other member of the bridge
 * is a service that only answers once bootstrap succeeded; this one reports
 * whether it did.
 */
interface DesktopCommandEngineApi {
  phase: BridgeInvoke<'app:command-engine'>;
  onChanged: BridgeSubscribe<'app:command-engine-changed'>;
}

/**
 * ENG-008 E5: the live local-consumption seam. Snapshot shape and honesty
 * rules live in `consumption/live-snapshot.ts`; updates are notification
 * only, and the renderer pulls a snapshot when it cares.
 */
interface DesktopConsumptionApi {
  /** Never blocks on scanning: the first call starts the background scan and
   *  returns whatever is already known. */
  snapshot: BridgeInvoke<'consumption:snapshot'>;
  /** An incremental pass now. Debounced; a no-op while one runs. */
  rescan: BridgeInvoke<'consumption:rescan'>;
  /** Cancels the pass in flight. Completed work is kept. */
  cancelScan: BridgeInvoke<'consumption:cancel-scan'>;
  onUpdated: BridgeSubscribe<'consumption:updated'>;
}

interface DesktopPtyApi {
  create: BridgeInvoke<'pty:create'>;
  pauseSessions: BridgeInvoke<'pty:pause-sessions'>;
  changeModel: BridgeInvoke<'pty:change-model'>;
  listAgentModels: (
    harness: AgentHarness,
    cwd: string,
    /** Skip the cache and wait for a fresh probe. */
    refresh?: boolean
  ) => Promise<DesktopBridgeResult<'pty:list-agent-models'>>;
  /** Writes terminal data. `operatorEngaged` is true only when a real key
   *  event preceded it, so main opens the Agent turn before the write. */
  write: (
    id: string,
    data: string,
    operatorEngaged?: boolean
  ) => Promise<DesktopBridgeResult<'pty:write'>>;
  /** An explicit operator keystroke; terminal protocol replies never call it. */
  engage: BridgeInvoke<'pty:engage'>;
  resize: BridgeInvoke<'pty:resize'>;
  kill: BridgeInvoke<'pty:kill'>;
  /** One-stroke close (D24): stop, await death, forget the runtime record.
   *  `discard` also sheds retained history (never-started Sessions). */
  closeSession: (
    durableSessionId: string,
    discard?: boolean
  ) => Promise<DesktopBridgeResult<'pty:close-session'>>;
  /** Soft-closes a STOPPED Session into the Recently-closed ledger (D23);
   *  history survives until the ledger reaps it. */
  archiveSession: BridgeInvoke<'pty:archive-session'>;
  closedSessions: BridgeInvoke<'pty:closed-sessions'>;
  onClosedSessionsChanged: BridgeSubscribe<'pty:closed-sessions-changed'>;
  /** Removes and returns a ledger entry so the tab can resurrect whole. */
  reopenSession: BridgeInvoke<'pty:reopen-session'>;
  rename: BridgeInvoke<'pty:rename'>;
  /** The operator is looking at this Session (null: none focused). */
  focus: BridgeInvoke<'pty:focus'>;
  /** Syncs the signed-in token to main, which never exposes it back and uses
   *  it only for hosted context-label requests. */
  setContextAuth: BridgeInvoke<'pty:set-context-auth'>;
  /** An explicit human correction, applied before feedback upload. */
  correctContext: BridgeInvoke<'pty:correct-context'>;
  /** Revalidates a persisted goal through main before hydration. */
  restoreContext: BridgeInvoke<'pty:restore-context'>;
  /** Re-seeds a persisted visual reference into main, which resolves it to
   *  pixels from the content store. */
  restoreGoalVisual: BridgeInvoke<'pty:restore-goal-visual'>;
  list: BridgeInvoke<'pty:list'>;
  buffer: BridgeInvoke<'pty:buffer'>;
  bufferSnapshot: BridgeInvoke<'pty:buffer-snapshot'>;
  bufferSince: BridgeInvoke<'pty:buffer-since'>;
  /** O(1) description of a paused Session; never reads the transcript. */
  retainedHistoryMeta: BridgeInvoke<'pty:retained-history-meta'>;
  /** The source's own conversation, bounded, for Clone. */
  cloneContext: BridgeInvoke<'pty:clone-context'>;
  retainedTranscript: BridgeInvoke<'pty:retained-transcript'>;
  pasteClipboard: BridgeInvoke<'pty:paste-clipboard'>;
  /** Composer paste (D24): reads the clipboard without touching any PTY;
   *  images land as temp-file paths. */
  clipboardRead: BridgeInvoke<'pty:clipboard-read'>;
  copyText: BridgeInvoke<'pty:copy-text'>;
  openExternal: BridgeInvoke<'pty:open-external'>;
  /** `contain: true` for UNTRUSTED repo-derived paths (roadmap docs): main
   *  rejects anything that escapes cwd. */
  openPath: BridgeInvoke<'pty:open-path'>;
  createWorktree: BridgeInvoke<'pty:worktree'>;
  listResumeCandidates: BridgeInvoke<'pty:list-resume-candidates'>;
  reconcileResumeIdentities: BridgeInvoke<'pty:reconcile-resume-identities'>;
  /** Source-neutral local catalog. Enrichment is a separate authenticated,
   *  non-blocking pass so this list never waits on a model. */
  listRecentConversations: BridgeInvoke<'pty:list-recent-conversations'>;
  enrichRecentConversations: BridgeInvoke<'pty:enrich-recent-conversations'>;
  onData: BridgeSubscribe<'pty:data'>;
  onExit: BridgeSubscribe<'pty:exit'>;
  onIdentity: BridgeSubscribe<'pty:identity'>;
  onContext: BridgeSubscribe<'pty:context'>;
  onGoalVisual: BridgeSubscribe<'pty:goal-visual'>;
  onRecap: BridgeSubscribe<'pty:recap'>;
  onAttention: BridgeSubscribe<'pty:attention'>;
  onActivity: BridgeSubscribe<'pty:activity'>;
  /** Fires once per Session, on the first work it is given (D22). */
  onEngaged: BridgeSubscribe<'pty:engaged'>;
  /** Harness-reported delegation changes (ENG-023). */
  onDelegation: BridgeSubscribe<'pty:delegation'>;
  onNotificationClick: BridgeSubscribe<'pty:notification-click'>;
}

interface DesktopWorkspaceApi {
  load: BridgeInvoke<'workspace:load'>;
  save: BridgeInvoke<'workspace:save'>;
  recovery: BridgeInvoke<'workspace:recovery'>;
  storageRecovery: BridgeInvoke<'workspace:storage-recovery'>;
  retryRecovery: BridgeInvoke<'workspace:retry-recovery'>;
  revealRecovery: BridgeInvoke<'workspace:reveal-recovery'>;
  onChanged: BridgeSubscribe<'workspace:changed'>;
}

/** The roadmap lens (ENG-017): raw reads, one narrow write boundary. */
interface DesktopRoadmapApi {
  read: BridgeInvoke<'roadmap:read'>;
  sessionEvidence: BridgeInvoke<'roadmap:session-evidence'>;
  activity: BridgeInvoke<'roadmap:activity'>;
  writeState: BridgeInvoke<'roadmap:write-state'>;
  undoState: BridgeInvoke<'roadmap:undo-state'>;
  watch: BridgeInvoke<'roadmap:watch'>;
  unwatch: BridgeInvoke<'roadmap:unwatch'>;
  onFileChanged: BridgeSubscribe<'roadmap:file-changed'>;
}

export interface DesktopSettingsApi {
  get: BridgeInvoke<'settings:get'>;
  setAppearance: BridgeInvoke<'settings:set-appearance'>;
  setAttentionNotifications: BridgeInvoke<'settings:set-attention-notifications'>;
  setDockBadge: BridgeInvoke<'settings:set-dock-badge'>;
  setHostedContextLabels: BridgeInvoke<'settings:set-hosted-context-labels'>;
  setHostedConversationSummaries: BridgeInvoke<'settings:set-hosted-conversation-summaries'>;
  setGoalVisualsEnabled: BridgeInvoke<'settings:set-goal-visuals'>;
  setKeyboardShortcuts: BridgeInvoke<'settings:set-keyboard-shortcuts'>;
  setReentryRecap: BridgeInvoke<'settings:set-reentry-recap'>;
  setClaudePlanWindows: BridgeInvoke<'settings:set-claude-plan-windows'>;
  setSafetyControl: BridgeInvoke<'settings:set-safety-control'>;
  setOperatorAutoPublish: BridgeInvoke<'settings:set-operator-auto-publish'>;
  recordOperatorProfileState: BridgeInvoke<'settings:record-operator-profile-state'>;
  recordAgentSourceUse: BridgeInvoke<'settings:record-agent-source-use'>;
  setAgentPermissionMode: BridgeInvoke<'settings:set-agent-permission-mode'>;
  recordLaunchConfigurationSuccess: BridgeInvoke<'settings:record-launch-configuration-success'>;
  saveNamedLaunchConfiguration: BridgeInvoke<'settings:save-named-launch-configuration'>;
  renameLaunchConfiguration: BridgeInvoke<'settings:rename-launch-configuration'>;
  deleteLaunchConfiguration: BridgeInvoke<'settings:delete-launch-configuration'>;
  setLaunchConfigurationPinned: BridgeInvoke<'settings:set-launch-configuration-pinned'>;
  onChanged: BridgeSubscribe<'settings:changed'>;
}

/** Absent when this distribution has no product-update capability. */
export interface DesktopProductUpdatesApi {
  getStatus: BridgeInvoke<'app:get-update-status'>;
  check: BridgeInvoke<'app:check-for-updates'>;
  restart: BridgeInvoke<'app:restart-update'>;
  onStatus: BridgeSubscribe<'app:update-status'>;
}

interface DesktopAppApi {
  /** Electron-authoritative first-paint state, captured by preload before
   *  any document script runs; undefined when main refused the read. */
  bootstrapAppearance: AppearanceBootstrapSnapshot | undefined;
  getBuildInfo: BridgeInvoke<'app:get-build-info'>;
  /** ENG-025 F5: the anonymized diagnostics bundle a bug report can carry. */
  getDiagnosticsReport: BridgeInvoke<'app:get-diagnostics-report'>;
  /** Writes the same report to Downloads and reveals it in Finder: the path
   *  that works with no account and no network. */
  saveDiagnosticsReport: BridgeInvoke<'app:save-diagnostics-report'>;
  /** A route's error boundary caught a render exception. Written to
   *  `logs/main.jsonl`, redacted and clipped. Never rejects. */
  reportRenderError: (report: RenderErrorReport) => Promise<void>;
  /** The operator's OS highlight color, '#RRGGBB' (D32); null when
   *  unavailable. */
  accentColor: BridgeInvoke<'app:accent-color'>;
  appearance: BridgeInvoke<'app:appearance'>;
  onAppearanceChanged: BridgeSubscribe<'app:appearance-changed'>;
  updates?: DesktopProductUpdatesApi;
  setWorkspaceCheckpointOwner: BridgeInvoke<'app:set-workspace-checkpoint-owner'>;
  completeCheckpoint: BridgeInvoke<'app:complete-checkpoint'>;
  onCheckpointRequest: BridgeSubscribe<'app:checkpoint-request'>;
  onShutdownStatus: BridgeSubscribe<'app:shutdown-status'>;
  onUpdateReady: BridgeSubscribe<'app:update-ready'>;
}

export interface DesktopAuthApi {
  startGoogle: BridgeInvoke<'auth:start-google'>;
  linkGithub: BridgeInvoke<'auth:link-github'>;
  onComplete: BridgeSubscribe<'auth:complete'>;
  onError: BridgeSubscribe<'auth:error'>;
  /** The verdict of an identity-link attempt that came back without a code,
   *  successes included; the panel that started the link owns its copy. */
  onLinkOutcome: BridgeSubscribe<'auth:link-outcome'>;
  /** Present only in a test launch. */
  installTestSession?: BridgeInvoke<'auth:install-test-session'>;
}

interface DesktopDialogApi {
  /** Native folder picker; the chosen path, or null when cancelled. */
  openDirectory: BridgeInvoke<'dialog:openDirectory'>;
  /** Does this path exist on this machine? (S5 "locate" flow) */
  pathExists: BridgeInvoke<'dialog:pathExists'>;
}

interface DesktopProjectsApi {
  resolve: BridgeInvoke<'projects:resolve'>;
  scanDirectory: BridgeInvoke<'projects:scan-directory'>;
}

interface DesktopMenuApi {
  /** Application-menu commands (ENG-016 D8): menu items send their command
   *  name here on click. */
  onCommand: BridgeSubscribe<'menu:command'>;
  /** Registry bindings shown as the menus' display accelerators (D10); ''
   *  clears a column. */
  syncAccelerators: BridgeInvoke<'menu:sync-accelerators'>;
  /** Native menu enablement for the renderer's current targets. */
  syncAvailability: BridgeInvoke<'menu:sync-availability'>;
}

interface DesktopFeedbackApi {
  /** Keeps the native Help menu honest without exposing auth data. */
  setAuthenticated: BridgeInvoke<'feedback:set-authenticated'>;
  /** Explicit user action only; a bounded JPEG data URL. */
  captureScreenshot: BridgeInvoke<'feedback:capture-screenshot'>;
  /** Dev-evaluator capability marker; present only in a test launch. */
  testMode?: true;
}

interface DesktopShortcutsApi {
  systemHotkeys: BridgeInvoke<'shortcuts:system-hotkeys'>;
}

/**
 * ENG-030 OS1.5b: the renderer end of the main-process analytics bridge.
 * Drain returns main's queued events; the renderer feeds them through the
 * allowlisted path, which no-ops when analytics are off.
 */
interface DesktopAnalyticsApi {
  drainMainProcessEvents: BridgeInvoke<'analytics:drain-main-events'>;
  onMainProcessEvents: BridgeSubscribe<'analytics:main-process-events'>;
}

interface DesktopBridgeShape {
  isElectron: true;
  platform: string;
  agentSources: DesktopAgentSourcesApi;
  connectedSources: DesktopConnectedSourcesApi;
  operatorStats: DesktopOperatorStatsApi;
  commandEngine: DesktopCommandEngineApi;
  consumption: DesktopConsumptionApi;
  pty: DesktopPtyApi;
  workspace: DesktopWorkspaceApi;
  roadmap: DesktopRoadmapApi;
  settings: DesktopSettingsApi;
  app: DesktopAppApi;
  auth: DesktopAuthApi;
  dialog: DesktopDialogApi;
  projects: DesktopProjectsApi;
  menu: DesktopMenuApi;
  feedback: DesktopFeedbackApi;
  shortcuts: DesktopShortcutsApi;
  analytics: DesktopAnalyticsApi;
}

/* ---- Nothing callback-shaped crosses -------------------------------------- */

/**
 * A member crosses the bridge when a subscription's payload, or an invoke's
 * arguments and resolved value, hold no function. `on*` members are the one
 * place a function appears, and it stays in the renderer: preload wraps it
 * in its own listener.
 */
type MemberCrosses<Key, Member> = Member extends (
  ...args: infer Args
) => infer Result
  ? Key extends `on${string}`
    ? Args extends [(payload: infer Payload) => void]
      ? HoldsFunction<Payload> extends false
        ? Member
        : never
      : never
    : HoldsFunction<Args> extends false
      ? HoldsFunction<Awaited<Result>> extends false
        ? Member
        : never
      : never
  : Member extends object
    ? { [K in keyof Member]: MemberCrosses<K, Member[K]> }
    : Member;

type BridgeCrosses<Shape> = { [K in keyof Shape]: MemberCrosses<K, Shape[K]> };
type CheckedBridge<Shape extends BridgeCrosses<Shape>> = Shape;

/** The whole of `window.electron`, as preload exposes it. */
export type DesktopBridge = CheckedBridge<DesktopBridgeShape>;
