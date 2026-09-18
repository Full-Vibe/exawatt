import { describe, expect, it, vi } from 'vitest';
import {
  createSessionModelChanger,
  modelChangeResumeOptions,
} from './session-model-change';
import type { PtySessionInfo } from './session-manager';
import type { AgentModelCatalog } from './agent-models';

function fixture() {
  const session: PtySessionInfo = {
    id: 'runtime',
    durableSessionId: 'durable',
    harness: 'claude',
    title: 'Work',
    cwd: '/repo',
    projectDir: '/repo',
    projectName: 'Repo',
    cols: 80,
    rows: 24,
    startedAt: 1,
    exited: false,
    exitCode: null,
    lastDataAt: 1,
    harnessSessionId: 'provider-conversation',
  };
  const catalog = {
    models: [{ id: 'allowed', efforts: [{ id: 'high' }] }],
    effortLocked: false,
    selectionAction: null,
  } as AgentModelCatalog;
  const ports = {
    session: vi.fn(() => session),
    available: vi.fn(() => true),
    catalog: vi.fn(async () => catalog),
    restart: vi.fn(async () => ({ ...session, id: 'replacement' })),
  };
  return { session, catalog, ports, change: createSessionModelChanger(ports) };
}

describe('model change ownership', () => {
  it('resumes the same conversation without replaying the task or changing policy', async () => {
    const { session, ports, change } = fixture();
    await change(session.id, { model: 'allowed', effort: 'high' });
    expect(ports.restart).toHaveBeenCalledWith(session.id, {
      model: 'allowed',
      effort: 'high',
    });
    const options = modelChangeResumeOptions(
      session,
      {
        harness: 'claude',
        permissionMode: 'prompt',
        initialPrompt: 'do not replay',
      },
      { model: 'allowed' }
    );
    expect(options.resumeSessionId).toBe(session.harnessSessionId);
    expect(options.durableSessionId).toBe(session.durableSessionId);
    expect(options.permissionMode).toBe('prompt');
    expect(options.initialPrompt).toBeUndefined();
    expect(options.statedTask).toBe('do not replay');
  });
  it.each([
    'busy',
    'exited',
    'identity',
    'source',
    'model',
    'effort',
    'locked',
    'source-owned',
  ])('refuses %s before stopping the process', async kind => {
    const { session, catalog, ports, change } = fixture();
    const choice = { model: 'allowed', effort: 'high' };
    if (kind === 'busy') ports.available.mockReturnValue(false);
    if (kind === 'exited') session.exited = true;
    if (kind === 'identity') session.harnessSessionId = null;
    if (kind === 'source') session.harness = 'shell';
    if (kind === 'model') choice.model = 'missing';
    if (kind === 'effort') choice.effort = 'missing';
    if (kind === 'locked') catalog.effortLocked = true;
    if (kind === 'source-owned') catalog.selectionAction = 'choose-in-source';
    await expect(change(session.id, choice)).rejects.toThrow();
    expect(ports.restart).not.toHaveBeenCalled();
  });
  it('rechecks activity after the asynchronous catalog read', async () => {
    const { ports, change } = fixture();
    ports.available.mockReturnValueOnce(true).mockReturnValue(false);
    await expect(change('runtime', { model: 'allowed' })).rejects.toThrow();
    expect(ports.restart).not.toHaveBeenCalled();
  });
  it('refuses concurrent changes and releases its claim after failure', async () => {
    const { ports, change } = fixture();
    let release!: () => void;
    ports.catalog.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = () =>
            resolve({
              models: [],
              effortLocked: false,
            } as unknown as AgentModelCatalog);
        })
    );
    const first = change('runtime', { model: 'allowed' });
    await expect(change('runtime', { model: 'allowed' })).rejects.toThrow(
      'already'
    );
    release();
    await expect(first).rejects.toThrow();
    await expect(
      change('runtime', { model: 'allowed' })
    ).resolves.toMatchObject({ id: 'replacement' });
  });
});
