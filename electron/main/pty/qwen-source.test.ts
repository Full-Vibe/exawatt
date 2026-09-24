import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { qwenModelCatalog } from './agent-models';
import { QwenConversationAdapter } from './conversation-catalog';
import {
  parseQwenTranscriptHead,
  parseQwenVersion,
  qwenProjectDirname,
  qwenRuntimeRoot,
  readQwenAdminDefaults,
  readQwenConfiguredModels,
  readQwenSignIn,
} from './qwen-source';

/**
 * Qwen Code's local records (ENG-003 S5.2). Transcript lines are the ones
 * Qwen Code 0.24.4 wrote during the S5.2 probe, with only the directory
 * replaced; none are invented.
 */

const SESSION = '11111111-2222-4333-8444-555555555556';
const transcript = [
  `{"uuid":"d20fdf3f-e9e8-4682-a02d-f113a57086fa","parentUuid":null,"sessionId":"${SESSION}","timestamp":"2026-09-24T04:08:35.520Z","type":"user","provenance":"real_user","cwd":"/work/app","version":"0.24.4","message":{"role":"user","parts":[{"text":"PLAIN say hi"}]}}`,
  `{"uuid":"720dde47-b653-4855-aacb-26ea4a3c8b20","parentUuid":"d20fdf3f-e9e8-4682-a02d-f113a57086fa","sessionId":"${SESSION}","timestamp":"2026-09-24T04:08:35.549Z","type":"system","provenance":"system","cwd":"/work/app","version":"0.24.4","subtype":"attribution_snapshot"}`,
  `{"uuid":"b568cf86-3fc2-487c-95ee-bfa2d5513b5a","parentUuid":"421b9827-0a1b-48ed-99a6-053884656c68","sessionId":"${SESSION}","timestamp":"2026-09-24T04:08:35.878Z","type":"assistant","provenance":"assistant_output","cwd":"/work/app","version":"0.24.4","model":"mock-model","message":{"role":"model","parts":[{"text":"Hello from the mock model."}]},"usageMetadata":{"promptTokenCount":111,"candidatesTokenCount":22,"thoughtsTokenCount":0,"totalTokenCount":133,"cachedContentTokenCount":5}}`,
].join('\n');

describe('parseQwenVersion', () => {
  it('reads the version and gates on the verified contract', () => {
    expect(parseQwenVersion('0.24.4\n')).toEqual({
      version: '0.24.4',
      compatible: true,
    });
    expect(parseQwenVersion('1.0.0')?.compatible).toBe(true);
    expect(parseQwenVersion('0.23.9')?.compatible).toBe(false);
    expect(parseQwenVersion('not a version')).toBeNull();
  });
});

describe('Qwen Code settings', () => {
  it('reports a configured credential by its type, and none when absent', () => {
    expect(
      readQwenSignIn({ security: { auth: { selectedType: 'openai' } } })
    ).toEqual({ authType: 'openai' });
    // The operator's settings on 2026-09-23: acknowledged, never signed in.
    expect(readQwenSignIn({ ui: { autoModeAcknowledged: true } })).toBeNull();
    expect(readQwenSignIn(null)).toBeNull();
  });

  it('offers only the models the settings name, and skips unknown shapes', () => {
    expect(
      readQwenConfiguredModels({
        model: { name: 'qwen3-coder-plus' },
        modelProviders: {
          openai: [
            { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus' },
            { id: 'qwen3-coder-plus' },
            { name: 'no id' },
          ],
          custom: { models: [{ id: 'local-coder' }] },
          broken: 'not a list',
        },
      })
    ).toEqual({
      defaultModel: 'qwen3-coder-plus',
      models: [
        {
          id: 'qwen3-coder-plus',
          label: 'Qwen3 Coder Plus',
          provider: 'openai',
        },
        { id: 'local-coder', label: 'local-coder', provider: 'custom' },
      ],
    });
  });

  it('pins no model when none is configured', () => {
    const catalog = qwenModelCatalog({ ui: {} });
    expect(catalog.effectiveModel).toBeNull();
    expect(catalog.effectiveModelSource).toBe('account-default');
    expect(catalog.catalogMode).toBe('source-owned');
    expect(catalog.models).toEqual([]);
  });

  it('pins the configured default as configuration', () => {
    const catalog = qwenModelCatalog({ model: { name: 'qwen3-coder-plus' } });
    expect(catalog.effectiveModel).toBe('qwen3-coder-plus');
    expect(catalog.effectiveModelSource).toBe('config');
    expect(catalog.catalogMode).toBe('configured-values');
  });

  it('treats a missing administrator document as the normal case', () => {
    expect(
      readQwenAdminDefaults(path.join(os.tmpdir(), 'exawatt-no-such-file.json'))
    ).toBeNull();
  });
});

describe('Qwen Code paths', () => {
  it('names a project directory the way Qwen Code does', () => {
    expect(qwenProjectDirname('/private/tmp/claude-501/-Users-jake/ws')).toBe(
      '-private-tmp-claude-501--Users-jake-ws'
    );
  });

  it('resolves the runtime root in Qwen Code order', () => {
    const home = path.join(os.tmpdir(), 'exawatt-qwen-home-missing');
    expect(qwenRuntimeRoot({ QWEN_RUNTIME_DIR: '/r', QWEN_HOME: home })).toBe(
      '/r'
    );
    expect(qwenRuntimeRoot({ QWEN_HOME: home })).toBe(home);
  });
});

describe('parseQwenTranscriptHead', () => {
  it('reads identity, directory, start and the first real prompt', () => {
    expect(parseQwenTranscriptHead(transcript, 'fallback', 42)).toEqual({
      id: SESSION,
      cwd: '/work/app',
      startedAt: Date.parse('2026-09-24T04:08:35.520Z'),
      updatedAt: 42,
      title: 'PLAIN say hi',
    });
  });

  it('survives a head cut mid-record', () => {
    const cut = transcript.slice(0, transcript.length - 40);
    expect(parseQwenTranscriptHead(cut, 'fallback', 1)?.title).toBe(
      'PLAIN say hi'
    );
  });

  it('drops a file with no launch directory', () => {
    expect(parseQwenTranscriptHead('{"type":"user"}', 'x', 1)).toBeNull();
  });
});

describe('QwenConversationAdapter', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0))
      fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists the Project transcripts as resumable provider sessions', async () => {
    const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-qwen-'));
    const project = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-qwen-project-'))
    );
    roots.push(runtime, project);
    const chats = path.join(
      runtime,
      'projects',
      qwenProjectDirname(project),
      'chats'
    );
    fs.mkdirSync(chats, { recursive: true });
    fs.writeFileSync(
      path.join(chats, `${SESSION}.jsonl`),
      transcript.split('/work/app').join(project)
    );
    const rows = await new QwenConversationAdapter(runtime).list(project);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: SESSION,
      harness: 'qwen',
      cwd: project,
      title: 'PLAIN say hi',
      titleSource: 'native',
      providerSessionId: SESSION,
      continuation: { kind: 'provider' },
    });
  });
});
