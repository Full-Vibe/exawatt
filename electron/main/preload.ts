import { contextBridge, ipcRenderer } from 'electron';

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
  pty: {
    create: (options: unknown) => ipcRenderer.invoke('pty:create', options),
    listAgentModels: (harness: string, cwd: string) =>
      ipcRenderer.invoke('pty:list-agent-models', harness, cwd),
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
    list: () => ipcRenderer.invoke('pty:list'),
    buffer: (id: string) => ipcRenderer.invoke('pty:buffer', id),
    bufferSnapshot: (id: string) =>
      ipcRenderer.invoke('pty:buffer-snapshot', id),
    bufferSince: (id: string, cursor: number) =>
      ipcRenderer.invoke('pty:buffer-since', id, cursor),
    retainedHistory: (durableSessionId: string) =>
      ipcRenderer.invoke('pty:retained-history', durableSessionId),
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
        harness: 'claude' | 'codex';
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
    onRecap: subscribe<{
      id: string;
      text: string;
      awayMs: number;
      generatedAt: number;
    }>('pty:recap'),
    onAttention: subscribe<{ id: string; attention: unknown }>('pty:attention'),
    onActivity: subscribe<{ id: string; working: boolean }>('pty:activity'),
    onEngaged: subscribe<{ id: string }>('pty:engaged'),
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
    watch: (projectDir: string) =>
      ipcRenderer.invoke('roadmap:watch', projectDir),
    unwatch: (projectDir: string) =>
      ipcRenderer.invoke('roadmap:unwatch', projectDir),
    onFileChanged: subscribe<{ projectDir: string }>('roadmap:file-changed'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setAttentionNotifications: (enabled: boolean) =>
      ipcRenderer.invoke('settings:set-attention-notifications', enabled),
    setDockBadge: (enabled: boolean) =>
      ipcRenderer.invoke('settings:set-dock-badge', enabled),
    setHostedConversationSummaries: (enabled: boolean) =>
      ipcRenderer.invoke('settings:set-hosted-conversation-summaries', enabled),
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
    onChanged: subscribe<{
      terminal?: {
        fontFamily?: string;
        fontSize?: number;
        lineHeight?: number;
        letterSpacing?: number;
        fontStrokeWidth?: number;
      };
      notifications?: { attention: boolean; dockBadge?: boolean };
      conversationSummaries?: { hosted: boolean };
      agentSources?: {
        projectLastUsed: Record<string, string>;
        sourceRecency: Record<string, number>;
        projectPermissionModes: Record<string, Record<string, string>>;
      };
    }>('settings:changed'),
  },
  app: {
    getBuildInfo: () => ipcRenderer.invoke('app:get-build-info'),
    accentColor: () => ipcRenderer.invoke('app:accent-color'),
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
    onComplete: subscribe<void>('auth:complete'),
    onError: subscribe<{
      name: string;
      message: string;
      status?: number;
      code?: string;
    }>('auth:error'),
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
});
