import { contextBridge, ipcRenderer } from 'electron';
import type {
  DesktopBridge,
  DesktopBridgeArgs,
  DesktopBridgePush,
  DesktopBridgePushChannel,
  DesktopBridgeRequestChannel,
  DesktopBridgeResult,
  DesktopBridgeSyncChannel,
  DesktopBridgeSyncRequests,
  DesktopProductUpdatesApi,
} from '@exawatt/core/desktop-bridge';

/**
 * `window.electron`, built from the desktop bridge contract
 * (`@exawatt/core/desktop-bridge`). Preload runs sandboxed and may require
 * nothing but `electron`, so the contract is types only here: every channel
 * name below is a literal the contract checks, and the exposed object
 * `satisfies` the contract's `DesktopBridge`.
 */

/** One request channel, with the contract's arguments and answer. */
const invoke = <C extends DesktopBridgeRequestChannel>(
  channel: C,
  ...args: DesktopBridgeArgs<C>
): Promise<DesktopBridgeResult<C>> => ipcRenderer.invoke(channel, ...args);

/** One synchronous read, answered before any document script runs. */
const sendSync = <C extends DesktopBridgeSyncChannel>(
  channel: C
): DesktopBridgeSyncRequests[C]['result'] => ipcRenderer.sendSync(channel);

/** one subscribe-shape for every main→renderer event channel: wraps the
 *  handler, registers it, returns a disposer that removes ONLY it (never
 *  removeAllListeners — that clobbers sibling subscribers) */
const subscribe =
  <C extends DesktopBridgePushChannel>(channel: C) =>
  (handler: (payload: DesktopBridgePush<C>) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: DesktopBridgePush<C>
    ) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };

// This value is captured synchronously on every top-level navigation so the
// first document script never has to guess from a possibly stale web mirror.
const bootstrapAppearance = sendSync('app:appearance-bootstrap');
const productUpdatesEnabled = process.argv.includes(
  '--exawatt-capability-updates'
);
const productUpdates: DesktopProductUpdatesApi | undefined =
  productUpdatesEnabled
    ? {
        getStatus: () => invoke('app:get-update-status'),
        check: () => invoke('app:check-for-updates'),
        restart: () => invoke('app:restart-update'),
        onStatus: subscribe('app:update-status'),
      }
    : undefined;

const bridge = {
  isElectron: true,
  platform: process.platform,
  agentSources: {
    onDelegation: subscribe('agent-sources:delegation'),
    list: (scope = 'all', refresh = false) =>
      invoke('agent-sources:list', scope, refresh),
    remembered: (scope = 'all') => invoke('agent-sources:remembered', scope),
    act: (adapterId, action) => invoke('agent-sources:act', adapterId, action),
  },
  // ENG-010 C1. Configured sources are saved connections to a Gateway, local
  // or hosted. The renderer sees names and health; SSH material and the OS
  // keychain never cross this boundary.
  //
  // ENG-033 H2 adds one command channel and no more: ask a source for write
  // access, read a coworker's primary conversation, send to it, follow the
  // reply. Nothing here reaches an admin method, and `send` takes an Agent
  // id rather than a session key, so no renderer call can address any context
  // other than that coworker's primary conversation.
  connectedSources: {
    list: () => invoke('connected-sources:list'),
    /** Passive: reads SSH config text, never contacts a server. */
    sshAliases: () => invoke('connected-sources:ssh-aliases'),
    add: input => invoke('connected-sources:add', input),
    rename: (id, displayName) =>
      invoke('connected-sources:rename', id, displayName),
    /**
     * The operator act that reaches a server. Read-only end to end.
     *
     * One argument and one answer, deliberately. An `invoke` carries
     * structured-clonable arguments only, so a progress callback handed to
     * this call would be dropped on the way over and the caller would watch a
     * frozen checklist for the whole round trip. Progress travels on
     * `onChanged` below, which already broadcasts every phase the session
     * enters, per source.
     */
    connect: id => invoke('connected-sources:connect', id),
    /** Per-source observation freshness. Never a claim about remote work. */
    status: () => invoke('connected-sources:status'),
    /** The projected coworkers, for the roster. */
    agents: () => invoke('connected-sources:agents'),
    /** Exawatt-side Project/name decisions. Issues no Gateway call. */
    mapAgents: (id, mappings) =>
      invoke('connected-sources:map-agents', id, mappings),
    /** Stops observing. The remote installation keeps working. */
    disconnect: id => invoke('connected-sources:disconnect', id),
    /** Removes Exawatt's record only. The remote installation is untouched. */
    detach: id => invoke('connected-sources:detach', id),
    /**
     * Which source moved, which phase it is in, and how fresh it is — never a
     * topology payload. Also the connect flow's progress channel: the phases
     * a session passes through on its way to a snapshot are the steps the
     * operator is watching.
     */
    onChanged: subscribe('connected-sources:changed'),
    /** What Exawatt may do with each source. Never a freshness signal. */
    commandAuthority: () => invoke('connected-sources:command-authority'),
    /** Asks the source to raise Exawatt from observation to conversation. */
    requestCommandAuthority: id =>
      invoke('connected-sources:request-command-authority', id),
    approveCommandAuthority: id =>
      invoke('connected-sources:approve-command-authority', id),
    /** Hands write access back; observation continues. */
    relinquishCommandAuthority: id =>
      invoke('connected-sources:relinquish-command-authority', id),
    /** One coworker's primary conversation, bounded. A read, not a command. */
    conversation: (agentId, request?) =>
      invoke('connected-sources:conversation', agentId, request),
    /**
     * Sends to that coworker's primary conversation. There is no session-key
     * parameter by design: the address follows from the Agent, so no caller
     * can aim a message at a cron run, a helper context, or a delegated child.
     */
    send: (agentId, text, options?) =>
      invoke('connected-sources:send', agentId, text, options),
    /** Bounded, ordered reply updates keyed by Agent and run. */
    onConversationUpdate: subscribe('connected-sources:conversation-updated'),
  },
  operatorStats: {
    plan: request => invoke('operator-stats:plan', request),
    record: event => invoke('operator-stats:record', event),
  },
  // BUG-016: the command engine's own state. Every other member of this bridge
  // is a service that only exists once bootstrap succeeded; this one reports
  // whether it did, so a surface can tell a dead local engine from a machine
  // that has no desktop bridge at all.
  commandEngine: {
    phase: () => invoke('app:command-engine'),
    onChanged: subscribe('app:command-engine-changed'),
  },
  // ENG-008 E5: the live local-consumption seam. Contract types live in
  // @exawatt/core `consumption/live-snapshot.ts`; updates are notification-only
  // (revision + scan state) and the renderer pulls snapshots when it cares.
  consumption: {
    snapshot: request => invoke('consumption:snapshot', request),
    rescan: () => invoke('consumption:rescan'),
    cancelScan: () => invoke('consumption:cancel-scan'),
    onUpdated: subscribe('consumption:updated'),
  },
  pty: {
    create: options => invoke('pty:create', options),
    pauseSessions: (ids, confirmed?) =>
      invoke('pty:pause-sessions', ids, confirmed),
    changeModel: (id, choice) => invoke('pty:change-model', id, choice),
    listAgentModels: (harness, cwd, refresh?) =>
      invoke('pty:list-agent-models', harness, cwd, refresh === true),
    write: (id, data, operatorEngaged = false) =>
      invoke('pty:write', id, data, operatorEngaged),
    engage: id => invoke('pty:engage', id),
    resize: (id, cols, rows) => invoke('pty:resize', id, cols, rows),
    kill: id => invoke('pty:kill', id),
    closeSession: (durableSessionId, discard = false) =>
      invoke('pty:close-session', durableSessionId, discard),
    archiveSession: entry => invoke('pty:archive-session', entry),
    closedSessions: () => invoke('pty:closed-sessions'),
    onClosedSessionsChanged: subscribe('pty:closed-sessions-changed'),
    reopenSession: durableSessionId =>
      invoke('pty:reopen-session', durableSessionId),
    rename: (id, title) => invoke('pty:rename', id, title),
    focus: id => invoke('pty:focus', id),
    setContextAuth: accessToken => invoke('pty:set-context-auth', accessToken),
    correctContext: (durableSessionId, label) =>
      invoke('pty:correct-context', durableSessionId, label),
    restoreContext: (durableSessionId, subtitle) =>
      invoke('pty:restore-context', durableSessionId, subtitle),
    restoreGoalVisual: (durableSessionId, visual) =>
      invoke('pty:restore-goal-visual', durableSessionId, visual),
    list: () => invoke('pty:list'),
    buffer: id => invoke('pty:buffer', id),
    bufferSnapshot: id => invoke('pty:buffer-snapshot', id),
    bufferSince: (id, cursor) => invoke('pty:buffer-since', id, cursor),
    retainedHistoryMeta: durableSessionId =>
      invoke('pty:retained-history-meta', durableSessionId),
    cloneContext: durableSessionId =>
      invoke('pty:clone-context', durableSessionId),
    retainedTranscript: (durableSessionId, maxLines?) =>
      invoke('pty:retained-transcript', durableSessionId, maxLines),
    pasteClipboard: id => invoke('pty:paste-clipboard', id),
    clipboardRead: () => invoke('pty:clipboard-read'),
    copyText: text => invoke('pty:copy-text', text),
    openExternal: url => invoke('pty:open-external', url),
    openPath: (filePath, cwd, options) =>
      invoke('pty:open-path', filePath, cwd, options),
    createWorktree: (repoDir, branch) =>
      invoke('pty:worktree', repoDir, branch),
    listResumeCandidates: (harness, cwd) =>
      invoke('pty:list-resume-candidates', harness, cwd),
    reconcileResumeIdentities: hints =>
      invoke('pty:reconcile-resume-identities', hints),
    listRecentConversations: cwd =>
      invoke('pty:list-recent-conversations', cwd),
    enrichRecentConversations: (cwd, accessToken) =>
      invoke('pty:enrich-recent-conversations', cwd, accessToken),
    onData: subscribe('pty:data'),
    onExit: subscribe('pty:exit'),
    onIdentity: subscribe('pty:identity'),
    onContext: subscribe('pty:context'),
    onGoalVisual: subscribe('pty:goal-visual'),
    onRecap: subscribe('pty:recap'),
    onAttention: subscribe('pty:attention'),
    onActivity: subscribe('pty:activity'),
    onEngaged: subscribe('pty:engaged'),
    onDelegation: subscribe('pty:delegation'),
    onNotificationClick: subscribe('pty:notification-click'),
  },
  workspace: {
    load: () => invoke('workspace:load'),
    save: state => invoke('workspace:save', state),
    recovery: () => invoke('workspace:recovery'),
    storageRecovery: () => invoke('workspace:storage-recovery'),
    retryRecovery: () => invoke('workspace:retry-recovery'),
    revealRecovery: () => invoke('workspace:reveal-recovery'),
    onChanged: subscribe('workspace:changed'),
  },
  roadmap: {
    read: projectDir => invoke('roadmap:read', projectDir),
    sessionEvidence: cwd => invoke('roadmap:session-evidence', cwd),
    activity: projectDir => invoke('roadmap:activity', projectDir),
    writeState: request => invoke('roadmap:write-state', request),
    undoState: token => invoke('roadmap:undo-state', token),
    watch: projectDir => invoke('roadmap:watch', projectDir),
    unwatch: projectDir => invoke('roadmap:unwatch', projectDir),
    onFileChanged: subscribe('roadmap:file-changed'),
  },
  settings: {
    get: () => invoke('settings:get'),
    setAppearance: appearance => invoke('settings:set-appearance', appearance),
    setAttentionNotifications: enabled =>
      invoke('settings:set-attention-notifications', enabled),
    setDockBadge: enabled => invoke('settings:set-dock-badge', enabled),
    setHostedContextLabels: enabled =>
      invoke('settings:set-hosted-context-labels', enabled),
    setHostedConversationSummaries: enabled =>
      invoke('settings:set-hosted-conversation-summaries', enabled),
    setGoalVisualsEnabled: enabled =>
      invoke('settings:set-goal-visuals', enabled),
    setKeyboardShortcuts: overrides =>
      invoke('settings:set-keyboard-shortcuts', overrides),
    setReentryRecap: enabled => invoke('settings:set-reentry-recap', enabled),
    setClaudePlanWindows: enabled =>
      invoke('settings:set-claude-plan-windows', enabled),
    setOperatorAutoPublish: enabled =>
      invoke('settings:set-operator-auto-publish', enabled),
    recordOperatorProfileState: state =>
      invoke('settings:record-operator-profile-state', state),
    recordAgentSourceUse: (projectDir, source, usedAt) =>
      invoke('settings:record-agent-source-use', projectDir, source, usedAt),
    setAgentPermissionMode: (projectDir, source, permissionMode) =>
      invoke(
        'settings:set-agent-permission-mode',
        projectDir,
        source,
        permissionMode
      ),
    recordLaunchConfigurationSuccess: (projectDir, target) =>
      invoke(
        'settings:record-launch-configuration-success',
        projectDir,
        target
      ),
    saveNamedLaunchConfiguration: (configuration, name) =>
      invoke('settings:save-named-launch-configuration', configuration, name),
    renameLaunchConfiguration: (id, name) =>
      invoke('settings:rename-launch-configuration', id, name),
    deleteLaunchConfiguration: id =>
      invoke('settings:delete-launch-configuration', id),
    setLaunchConfigurationPinned: (projectDir, id, pinned) =>
      invoke(
        'settings:set-launch-configuration-pinned',
        projectDir,
        id,
        pinned
      ),
    onChanged: subscribe('settings:changed'),
  },
  app: {
    bootstrapAppearance,
    getBuildInfo: () => invoke('app:get-build-info'),
    getDiagnosticsReport: signedIn =>
      invoke('app:get-diagnostics-report', signedIn),
    saveDiagnosticsReport: signedIn =>
      invoke('app:save-diagnostics-report', signedIn),
    reportRenderError: report =>
      invoke('app:report-render-error', report)
        .then(() => undefined)
        .catch(() => undefined),
    accentColor: () => invoke('app:accent-color'),
    appearance: () => invoke('app:appearance'),
    onAppearanceChanged: subscribe('app:appearance-changed'),
    ...(productUpdates ? { updates: productUpdates } : {}),
    setWorkspaceCheckpointOwner: ownsWorkspaceState =>
      invoke('app:set-workspace-checkpoint-owner', ownsWorkspaceState),
    completeCheckpoint: (requestId, ok) =>
      invoke('app:complete-checkpoint', requestId, ok),
    onCheckpointRequest: subscribe('app:checkpoint-request'),
    onShutdownStatus: subscribe('app:shutdown-status'),
    onUpdateReady: subscribe('app:update-ready'),
  },
  auth: {
    startGoogle: config => invoke('auth:start-google', config),
    // `linkIdentity` needs a live session; the renderer is where one exists.
    linkGithub: config => invoke('auth:link-github', config),
    onComplete: subscribe('auth:complete'),
    onError: subscribe('auth:error'),
    // An identity-link verdict, closed-vocabulary and already vetted by main.
    // Successes ride this channel too — "already linked" is not an error.
    onLinkOutcome: subscribe('auth:link-outcome'),
    ...(process.env.EXAWATT_TEST === '1'
      ? {
          installTestSession: (
            config: DesktopBridgeArgs<'auth:install-test-session'>[0],
            tokens: DesktopBridgeArgs<'auth:install-test-session'>[1]
          ) => invoke('auth:install-test-session', config, tokens),
        }
      : {}),
  },
  dialog: {
    openDirectory: title => invoke('dialog:openDirectory', title),
    pathExists: path => invoke('dialog:pathExists', path),
  },
  projects: {
    resolve: path => invoke('projects:resolve', path),
    scanDirectory: path => invoke('projects:scan-directory', path),
  },
  menu: {
    onCommand: subscribe('menu:command'),
    syncAccelerators: map => invoke('menu:sync-accelerators', map),
    syncAvailability: map => invoke('menu:sync-availability', map),
  },
  feedback: {
    setAuthenticated: authenticated =>
      invoke('feedback:set-authenticated', authenticated),
    captureScreenshot: () => invoke('feedback:capture-screenshot'),
    ...(process.env.EXAWATT_TEST === '1' ? { testMode: true } : {}),
  },
  shortcuts: {
    systemHotkeys: () => invoke('shortcuts:system-hotkeys'),
  },
  // ENG-030 OS1.5b: the renderer end of the main-process analytics bridge.
  // Drain returns main's queued typed events; the renderer feeds them through
  // the allowlisted captureAnalyticsEvent path (which no-ops when analytics
  // are off, so an opted-out renderer drains and drops).
  analytics: {
    drainMainProcessEvents: () => invoke('analytics:drain-main-events'),
    onMainProcessEvents: subscribe('analytics:main-process-events'),
  },
} satisfies DesktopBridge;

contextBridge.exposeInMainWorld('electron', bridge);
