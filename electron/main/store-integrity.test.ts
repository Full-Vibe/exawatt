import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceStore } from './workspace-store';
import {
  loadSettings,
  setAttentionNotifications,
  writeSettings,
} from './settings-store';
import { FileConnectedAgentProjectionPlanStore } from './connected-agent-projection-plan';

const state = vi.hoisted(() => ({ dir: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.dir } }));
beforeEach(() => {
  state.dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'exawatt-store-integrity-')
  );
});
afterEach(() => {
  fs.rmSync(state.dir, { recursive: true, force: true });
});

it('workspace cannot save first-launch defaults over an unreadable layout, including after restart', async () => {
  const file = path.join(state.dir, 'workspace.json');
  fs.writeFileSync(file, '{broken');
  const store = new WorkspaceStore(file);
  await expect(store.load()).rejects.toThrow(/needs recovery/);
  await expect(store.save({ projects: [] })).rejects.toThrow(/needs recovery/);
  await expect(new WorkspaceStore(file).save({ projects: [] })).rejects.toThrow(
    /needs recovery/
  );
});

it('settings recovery remains local and cannot overwrite existing choices', () => {
  fs.writeFileSync(path.join(state.dir, 'settings.json'), '{broken');
  expect(loadSettings().contextLabels?.hosted).toBe(false);
  expect(loadSettings().operatorProfile?.autoPublish).toBe(false);
  expect(() => setAttentionNotifications(true)).toThrow(/needs recovery/);
});

it('projection cannot replace unreadable identities with an empty plan', () => {
  const store = new FileConnectedAgentProjectionPlanStore(state.dir);
  store.write({ projectionVersion: 1, mappings: [], boundIdentities: {} });
  const file = fs.readdirSync(state.dir).find(name => name.endsWith('.json'));
  if (!file) throw new Error('fixture plan not persisted');
  fs.writeFileSync(path.join(state.dir, file), '{broken');
  expect(() => store.read()).toThrow(/needs recovery/);
  expect(() =>
    new FileConnectedAgentProjectionPlanStore(state.dir).write({
      projectionVersion: 1,
      mappings: [],
      boundIdentities: {},
    })
  ).toThrow(/needs recovery/);
});

it('workspace retry serializes repair before later checkpoints', async () => {
  const file = path.join(state.dir, 'workspace.json');
  fs.writeFileSync(file, '{broken');
  const store = new WorkspaceStore(file);
  await expect(store.load()).rejects.toThrow(/needs recovery/);
  fs.writeFileSync(file, JSON.stringify({ projects: [{ id: 'recovered' }] }));
  await store.recover('retry');
  await expect(store.load()).resolves.toEqual({
    projects: [{ id: 'recovered' }],
  });
  await store.save({ projects: [{ id: 'recovered', renamed: true }] });
  expect(
    fs.readdirSync(state.dir).some(name => name.includes('.corrupt-'))
  ).toBe(true);
});

it.each([
  { contextLabels: { hosted: 'false' } },
  { conversationSummaries: { hosted: 0 } },
  { goalVisuals: { enabled: null } },
  { reentryRecap: { enabled: 'false' } },
  { claudePlanWindows: { enabled: [] } },
  { notifications: { attention: 'true', dockBadge: false } },
  {
    agentSources: {
      projectPermissionModes: { '/project': { claude: 'broken' } },
    },
  },
])(
  'malformed stored preferences cannot enable outbound features or be overwritten: %j',
  preferences => {
    fs.writeFileSync(
      path.join(state.dir, 'settings.json'),
      JSON.stringify(preferences)
    );
    const recovered = loadSettings();
    expect(recovered.contextLabels?.hosted).toBe(false);
    expect(recovered.conversationSummaries?.hosted).toBe(false);
    expect(recovered.goalVisuals?.enabled).toBe(false);
    expect(recovered.reentryRecap?.enabled).toBe(false);
    expect(recovered.claudePlanWindows?.enabled).toBe(false);
    expect(() => setAttentionNotifications(true)).toThrow(/needs recovery/);
  }
);

it('unreadable settings still permit the recovery window without enabling outbound work', () => {
  fs.mkdirSync(path.join(state.dir, 'settings.json'));
  expect(loadSettings().contextLabels?.hosted).toBe(false);
  expect(loadSettings().appearance).toBeDefined();
  expect(() => setAttentionNotifications(true)).toThrow();
  expect(fs.statSync(path.join(state.dir, 'settings.json')).isDirectory()).toBe(
    true
  );
});

it.each([
  { mappings: 'damaged' },
  { mappings: [{ configuredSourceId: 'source' }] },
  { mappings: [], boundIdentities: [] },
  {
    mappings: [],
    boundIdentities: { source: { version: '1', nativeAgentIds: [123] } },
  },
])(
  'malformed projection schema remains recoverable instead of becoming an empty plan: %j',
  damage => {
    const file = path.join(state.dir, 'connected-agent-projection.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ schemaVersion: 1, projectionVersion: 1, ...damage })
    );
    const plan = new FileConnectedAgentProjectionPlanStore(state.dir);
    expect(() =>
      plan.write({ projectionVersion: 1, mappings: [], boundIdentities: {} })
    ).toThrow(/needs recovery/);
  }
);

it('accepts legacy projection without identity bindings and unknown preference fields', () => {
  fs.writeFileSync(
    path.join(state.dir, 'connected-agent-projection.json'),
    JSON.stringify({ mappings: [], futureField: true })
  );
  expect(
    new FileConnectedAgentProjectionPlanStore(state.dir).read().boundIdentities
  ).toEqual({});
  fs.writeFileSync(
    path.join(state.dir, 'settings.json'),
    JSON.stringify({
      futureField: true,
      contextLabels: { hosted: false, futureField: true },
    })
  );
  expect(loadSettings().contextLabels?.hosted).toBe(false);
  expect(() => setAttentionNotifications(true)).not.toThrow();
});

it('a direct settings save cannot bypass stored-schema validation', () => {
  fs.writeFileSync(
    path.join(state.dir, 'settings.json'),
    JSON.stringify({ contextLabels: { hosted: 'false' } })
  );
  expect(() => writeSettings({ notifications: { attention: true } })).toThrow(
    /needs recovery/
  );
  expect(loadSettings().contextLabels?.hosted).toBe(false);
});

it.each([
  { projects: { '/repo': { pins: 'damaged' } } },
  {
    projects: {
      '/repo': { usage: { shell: { launchCount: 'bad', lastLaunchedAt: 12 } } },
    },
  },
  { projectUsage: { '/repo': { shell: 'damaged' } } },
  { projectPins: { '/repo': [123] } },
])(
  'nested stored Launch Configuration choices cannot be dropped by an unrelated preference save: %j',
  launchConfigurations => {
    fs.writeFileSync(
      path.join(state.dir, 'settings.json'),
      JSON.stringify({ launchConfigurations })
    );
    expect(() => setAttentionNotifications(true)).toThrow(/needs recovery/);
  }
);

it('retains pre-versioned numeric launch usage and pins through a preference save', () => {
  fs.writeFileSync(
    path.join(state.dir, 'settings.json'),
    JSON.stringify({
      launchConfigurations: {
        projectUsage: { '/repo': { shell: 42 } },
        projectPins: { '/repo': ['shell'] },
      },
    })
  );
  const settings = setAttentionNotifications(true);
  expect(settings.launchConfigurations?.projects['/repo']).toEqual({
    usage: { shell: { launchCount: 1, lastLaunchedAt: 42 } },
    pins: ['shell'],
  });
});
