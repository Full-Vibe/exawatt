import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAppearanceBootstrapSnapshot } from './appearance';

/** one subscribe-shape for every main→renderer event channel: wraps the
 *  handler, registers it, returns a disposer that removes ONLY it (never
 *  removeAllListeners — that clobbers sibling subscribers) */
const subscribe =
  <T>(channel: string) =>
  (handler: (payload: T) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: T) =>
      handler(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };

// This value is captured synchronously on every top-level navigation so the
// first document script never has to guess from a possibly stale web mirror.
const bootstrapAppearance = ipcRenderer.sendSync(
  'app:appearance-bootstrap'
) as ElectronAppearanceBootstrapSnapshot;

contextBridge.exposeInMainWorld('electron', {
  isElectron: true,
  platform: process.platform,
  agent: {
    invoke: (method: string, ...args: unknown[]) =>
      ipcRenderer.invoke(`agent:${method}`, ...args),
    on: (channel: string, handler: (...args: unknown[]) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        ...args: unknown[]
      ) => handler(...args);
      ipcRenderer.on(channel, listener);
    },
    off: (channel: string, handler: (...args: unknown[]) => void) => {
      ipcRenderer.removeAllListeners(channel);
    },
  },
  agentSources: {
    list: (scope: 'all' | 'launch' = 'all', refresh = false) =>
      ipcRenderer.invoke('agent-sources:list', scope, refresh),
    act: (
      adapterId: 'claude' | 'codex' | 'opencode' | 'grok' | 'openclaw' | 'demo',
      action: 'authenticate' | 'choose-model' | 'install-guide'
    ) => ipcRenderer.invoke('agent-sources:act', adapterId, action),
  },
  operatorStats: {
    scan: (since: string, timezone: string) =>
      ipcRenderer.invoke('operator-stats:scan', since, timezone),
  },
  // ENG-008 E5: the live local-consumption seam. Contract types live in
  // @exawatt/core `consumption/live-snapshot.ts`; updates are notification-only
  // (revision + scan state) and the renderer pulls snapshots when it cares.
  consumption: {
    snapshot: (request?: { sinceMs?: number }) =>
      ipcRenderer.invoke('consumption:snapshot', request),
    rescan: () => ipcRenderer.invoke('consumption:rescan'),
    cancelScan: () => ipcRenderer.invoke('consumption:cancel-scan'),
    onUpdated: subscribe<unknown>('consumption:updated'),
  },
  pty: {
    create: (options: unknown) => ipcRenderer.invoke('pty:create', options),
    listAgentModels: (harness: string, cwd: string, refresh?: boolean) =>
      ipcRenderer.invoke(
        'pty:list-agent-models',
        harness,
        cwd,
        refresh === true
      ),
    write: (id: string, data: string, operatorEngaged = false) =>
      ipcRenderer.invoke('pty:write', id, data, operatorEngaged),
    engage: (id: string) => ipcRenderer.invoke('pty:engage', id),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('pty:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke('pty:kill', id),
    closeSession: (durableSessionId: string, discard = false) =>
      ipcRenderer.invoke('pty:close-session', durableSessionId, discard),
    archiveSession: (entry: unknown) =>
      ipcRenderer.invoke('pty:archive-session', entry),
    closedSessions: () => ipcRenderer.invoke('pty:closed-sessions'),
    onClosedSessionsChanged: subscribe<number>('pty:closed-sessions-changed'),
    reopenSession: (durableSessionId: string) =>
      ipcRenderer.invoke('pty:reopen-session', durableSessionId),
    rename: (id: string, title: string) =>
      ipcRenderer.invoke('pty:rename', id, title),
    focus: (id: string | null) => ipcRenderer.invoke('pty:focus', id),
    setContextAuth: (accessToken: string | null) =>
      ipcRenderer.invoke('pty:set-context-auth', accessToken),
    correctContext: (durableSessionId: string, label: string) =>
      ipcRenderer.invoke('pty:correct-context', durableSessionId, label),
    restoreContext: (durableSessionId: string, subtitle: string) =>
      ipcRenderer.invoke('pty:restore-context', durableSessionId, subtitle),
    restoreGoalVisual: (durableSessionId: string, visual: unknown) =>
      ipcRenderer.invoke('pty:restore-goal-visual', durableSessionId, visual),
    list: () => ipcRenderer.invoke('pty:list'),
    buffer: (id: string) => ipcRenderer.invoke('pty:buffer', id),
    bufferSnapshot: (id: string) =>
      ipcRenderer.invoke('pty:buffer-snapshot', id),
    bufferSince: (id: string, cursor: number) =>
      ipcRenderer.invoke('pty:buffer-since', id, cursor),
    retainedHistoryMeta: (durableSessionId: string) =>
      ipcRenderer.invoke('pty:retained-history-meta', durableSessionId),
    retainedTranscript: (durableSessionId: string, maxLines?: number) =>
      ipcRenderer.invoke('pty:retained-transcript', durableSessionId, maxLines),
    pasteClipboard: (id: string) =>
      ipcRenderer.invoke('pty:paste-clipboard', id),
    clipboardRead: () => ipcRenderer.invoke('pty:clipboard-read'),
    copyText: (text: string) => ipcRenderer.invoke('pty:copy-text', text),
    openExternal: (url: string) => ipcRenderer.invoke('pty:open-external', url),
    openPath: (
      filePath: string,
      cwd: string,
      options?: { contain?: boolean }
    ) => ipcRenderer.invoke('pty:open-path', filePath, cwd, options),
    createWorktree: (repoDir: string, branch: string) =>
      ipcRenderer.invoke('pty:worktree', repoDir, branch),
    listResumeCandidates: (harness: string, cwd: string) =>
      ipcRenderer.invoke('pty:list-resume-candidates', harness, cwd),
    reconcileResumeIdentities: (
      hints: Array<{
        durableSessionId: string;
        harness: 'claude' | 'codex' | 'opencode' | 'grok';
        cwd: string;
        initialTask: string | null;
        harnessSessionId: string | null;
      }>
    ) => ipcRenderer.invoke('pty:reconcile-resume-identities', hints),
    listRecentConversations: (cwd: string) =>
      ipcRenderer.invoke('pty:list-recent-conversations', cwd),
    enrichRecentConversations: (cwd: string, accessToken: string) =>
      ipcRenderer.invoke('pty:enrich-recent-conversations', cwd, accessToken),
    onData: subscribe<{
      id: string;
      durableSessionId: string;
      data: string;
      cursor: number;
    }>('pty:data'),
    onExit: subscribe<{
      id: string;
      durableSessionId: string;
      exitCode: number;
    }>('pty:exit'),
    onIdentity: subscribe<{
      id: string;
      durableSessionId: string;
      harnessSessionId: string;
    }>('pty:identity'),
    onContext: subscribe<{ durableSessionId: string; summary: string }>(
      'pty:context'
    ),
    onGoalVisual: subscribe<{ durableSessionId: string; visual: unknown }>(
      'pty:goal-visual'
    ),
    onRecap: subscribe<{
      id: string;
      text: string;
      awayMs: number;
      generatedAt: number;
    }>('pty:recap'),
    onAttention: subscribe<{ id: string; attention: unknown }>('pty:attention'),
    onActivity: subscribe<{ id: string; working: boolean }>('pty:activity'),
    onEngaged: subscribe<{ id: string }>('pty:engaged'),
    onDelegation: subscribe<{ id: string; delegation: unknown }>(
      'pty:delegation'
    ),
    onNotificationClick: subscribe<{ id: string }>('pty:notification-click'),
  },
  workspace: {
    load: () => ipcRenderer.invoke('workspace:load'),
    save: (state: unknown) => ipcRenderer.invoke('workspace:save', state),
    recovery: () => ipcRenderer.invoke('workspace:recovery'),
    onChanged: subscribe<unknown>('workspace:changed'),
  },
  roadmap: {
    read: (projectDir: string) =>
      ipcRenderer.invoke('roadmap:read', projectDir),
    sessionEvidence: (cwd: string) =>
      ipcRenderer.invoke('roadmap:session-evidence', cwd),
    activity: (projectDir: string) =>
      ipcRenderer.invoke('roadmap:activity', projectDir),
    writeState: (request: unknown) =>
      ipcRenderer.invoke('roadmap:write-state', request),
    undoState: (token: string) =>
      ipcRenderer.invoke('roadmap:undo-state', token),
    watch: (projectDir: string) =>
      ipcRenderer.invoke('roadmap:watch', projectDir),
    unwatch: (projectDir: string) =>
      ipcRenderer.invoke('roadmap:unwatch', projectDir),
    onFileChanged: subscribe<{ projectDir: string }>('roadmap:file-changed'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setAppearance: (appearance: unknown) =>
      ipcRenderer.invoke('settings:set-appearance', appearance),
    setAttentionNotifications: (enabled: boolean) =>
      ipcRenderer.invoke('settings:set-attention-notifications', enabled),
    setDockBadge: (enabled: boolean) =>
      ipcRenderer.invoke('settings:set-dock-badge', enabled),
    setHostedContextLabels: (enabled: boolean) =>
      ipcRenderer.invoke('settings:set-hosted-context-labels', enabled),
    setHostedConversationSummaries: (enabled: boolean) =>
      ipcRenderer.invoke('settings:set-hosted-conversation-summaries', enabled),
    setGoalVisualsEnabled: (enabled: boolean) =>
      ipcRenderer.invoke('settings:set-goal-visuals', enabled),
    setReentryRecap: (enabled: boolean) =>
      ipcRenderer.invoke('settings:set-reentry-recap', enabled),
    setClaudePlanWindows: (enabled: boolean) =>
      ipcRenderer.invoke('settings:set-claude-plan-windows', enabled),
    setOperatorAutoPublish: (enabled: boolean) =>
      ipcRenderer.invoke('settings:set-operator-auto-publish', enabled),
    recordOperatorProfileState: (state: {
      startedAt?: string;
      lastSyncedAt?: string;
      profileEnabled?: boolean;
    }) => ipcRenderer.invoke('settings:record-operator-profile-state', state),
    recordAgentSourceUse: (
      projectDir: string,
      source: string,
      usedAt: number
    ) =>
      ipcRenderer.invoke(
        'settings:record-agent-source-use',
        projectDir,
        source,
        usedAt
      ),
    setAgentPermissionMode: (
      projectDir: string,
      source: string,
      permissionMode: string
    ) =>
      ipcRenderer.invoke(
        'settings:set-agent-permission-mode',
        projectDir,
        source,
        permissionMode
      ),
    recordLaunchConfigurationSuccess: (projectDir: string, target: unknown) =>
      ipcRenderer.invoke(
        'settings:record-launch-configuration-success',
        projectDir,
        target
      ),
    saveNamedLaunchConfiguration: (configuration: unknown, name: string) =>
      ipcRenderer.invoke(
        'settings:save-named-launch-configuration',
        configuration,
        name
      ),
    renameLaunchConfiguration: (id: string, name: string) =>
      ipcRenderer.invoke('settings:rename-launch-configuration', id, name),
    deleteLaunchConfiguration: (id: string) =>
      ipcRenderer.invoke('settings:delete-launch-configuration', id),
    setLaunchConfigurationPinned: (
      projectDir: string,
      id: string,
      pinned: boolean
    ) =>
      ipcRenderer.invoke(
        'settings:set-launch-configuration-pinned',
        projectDir,
        id,
        pinned
      ),
    onChanged: subscribe<{
      terminal?: {
        fontFamily?: string;
        fontSize?: number;
        lineHeight?: number;
        letterSpacing?: number;
        fontStrokeWidth?: number;
      };
      notifications?: { attention: boolean; dockBadge?: boolean };
      contextLabels?: { hosted: boolean };
      conversationSummaries?: { hosted: boolean };
      goalVisuals?: { enabled: boolean };
      reentryRecap?: { enabled: boolean };
      operatorProfile?: {
        autoPublish: boolean;
        startedAt?: string;
        lastSyncedAt?: string;
        profileEnabled?: boolean;
      };
      agentSources?: {
        projectLastUsed: Record<string, string>;
        sourceRecency: Record<string, number>;
        projectPermissionModes: Record<string, Record<string, string>>;
      };
      launchConfigurations?: import('@exawatt/core').LaunchConfigurationPoolV1;
      appearance?: {
        schemaVersion: 1;
        selection:
          | { mode: 'manual'; themeId: string }
          | { mode: 'auto'; lightThemeId: string; darkThemeId: string };
        autoPair?: { lightThemeId: string; darkThemeId: string };
        accentSource: 'theme' | 'system';
        interfaceFont: 'theme' | 'system' | 'geist';
        interfaceScale: 90 | 100 | 110 | 120;
        contrast: 'system' | 'enhanced';
        transparency: 'system' | 'reduced';
      };
    }>('settings:changed'),
  },
  app: {
    bootstrapAppearance,
    getBuildInfo: () => ipcRenderer.invoke('app:get-build-info'),
    getDiagnosticsReport: (signedIn: boolean) =>
      ipcRenderer.invoke('app:get-diagnostics-report', signedIn),
    saveDiagnosticsReport: (signedIn: boolean) =>
      ipcRenderer.invoke('app:save-diagnostics-report', signedIn),
    accentColor: () => ipcRenderer.invoke('app:accent-color'),
    appearance: () => ipcRenderer.invoke('app:appearance'),
    onAppearanceChanged: subscribe<{
      dark: boolean;
      highContrast: boolean;
      invertedColors: boolean;
      systemAccent: string | null;
      safeTheme: boolean;
    }>('app:appearance-changed'),
    getUpdateStatus: () => ipcRenderer.invoke('app:get-update-status'),
    checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
    restartUpdate: () => ipcRenderer.invoke('app:restart-update'),
    setWorkspaceCheckpointOwner: (ownsWorkspaceState: boolean) =>
      ipcRenderer.invoke(
        'app:set-workspace-checkpoint-owner',
        ownsWorkspaceState
      ),
    completeCheckpoint: (requestId: string, ok: boolean) =>
      ipcRenderer.invoke('app:complete-checkpoint', requestId, ok),
    onCheckpointRequest: subscribe<{
      requestId: string;
      reason: 'quit' | 'update';
      stage: 'pre-stop' | 'stopped';
    }>('app:checkpoint-request'),
    onShutdownStatus: subscribe<{
      phase:
        | 'idle'
        | 'confirming'
        | 'checkpointing'
        | 'stopping'
        | 'finalizing';
      agents: number;
      shells: number;
    }>('app:shutdown-status'),
    onUpdateReady: subscribe<{
      currentSha: string;
      installedSha: string;
    }>('app:update-ready'),
    onUpdateStatus: subscribe<{
      phase:
        | 'idle'
        | 'checking'
        | 'available'
        | 'downloading'
        | 'downloaded'
        | 'error';
      currentVersion: string;
      availableVersion: string | null;
      percent: number | null;
      liveSessions: number;
      error: string | null;
    }>('app:update-status'),
  },
  auth: {
    startGoogle: (config: {
      supabaseUrl: string;
      supabaseAnonKey: string;
      redirectTo: string;
    }) => ipcRenderer.invoke('auth:start-google', config),
    linkGithub: (config: {
      supabaseUrl: string;
      supabaseAnonKey: string;
      redirectTo: string;
      // `linkIdentity` needs a live session; the renderer is where one exists.
      session?: { accessToken: string; refreshToken: string };
    }) => ipcRenderer.invoke('auth:link-github', config),
    onComplete: subscribe<void>('auth:complete'),
    onError: subscribe<{
      name: string;
      message: string;
      status?: number;
      code?: string;
    }>('auth:error'),
    // An identity-link verdict, closed-vocabulary and already vetted by main.
    // Successes ride this channel too — "already linked" is not an error.
    onLinkOutcome: subscribe<string>('auth:link-outcome'),
    ...(process.env.EXAWATT_TEST === '1'
      ? {
          installTestSession: (
            config: { supabaseUrl: string; supabaseAnonKey: string },
            tokens: { accessToken: string; refreshToken: string }
          ) => ipcRenderer.invoke('auth:install-test-session', config, tokens),
        }
      : {}),
  },
  dialog: {
    openDirectory: (title?: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:openDirectory', title),
    pathExists: (path: string): Promise<boolean> =>
      ipcRenderer.invoke('dialog:pathExists', path),
  },
  projects: {
    resolve: (path: string) => ipcRenderer.invoke('projects:resolve', path),
    scanDirectory: (path: string) =>
      ipcRenderer.invoke('projects:scan-directory', path),
  },
  menu: {
    onCommand: subscribe<string>('menu:command'),
    syncAccelerators: (map: Record<string, string>) =>
      ipcRenderer.invoke('menu:sync-accelerators', map),
    syncAvailability: (map: Record<string, boolean>) =>
      ipcRenderer.invoke('menu:sync-availability', map),
  },
  feedback: {
    setAuthenticated: (authenticated: boolean) =>
      ipcRenderer.invoke('feedback:set-authenticated', authenticated),
    captureScreenshot: () => ipcRenderer.invoke('feedback:capture-screenshot'),
    ...(process.env.EXAWATT_TEST === '1' ? { testMode: true } : {}),
  },
  shortcuts: {
    systemHotkeys: () => ipcRenderer.invoke('shortcuts:system-hotkeys'),
  },
  // ENG-030 OS1.5b: the renderer end of the main-process analytics bridge.
  // Drain returns main's queued typed events; the renderer feeds them through
  // the allowlisted captureAnalyticsEvent path (which no-ops when analytics
  // are off, so an opted-out renderer drains and drops).
  analytics: {
    drainMainProcessEvents: () =>
      ipcRenderer.invoke('analytics:drain-main-events'),
    onMainProcessEvents: subscribe<null>('analytics:main-process-events'),
  },
});
