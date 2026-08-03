import { describe, expect, it } from 'vitest';
import { applyBuildMetadata } from './build-metadata';

const DRAFT = {
  kind: 'bug' as const,
  message: 'The overlay is transparent',
  surface: 'quick-capture',
  context: { schemaVersion: 1, url: 'app://workspace' },
};

const BUILD = {
  sha: '489ba78',
  branch: 'master',
  delivery: 'signed',
  version: '1.4.2',
};

describe('applyBuildMetadata', () => {
  it('stamps app version and build sha onto the payload, metadata into context', () => {
    const enriched = applyBuildMetadata(DRAFT, BUILD);
    expect(enriched.appVersion).toBe('1.4.2');
    expect(enriched.buildSha).toBe('489ba78');
    expect(enriched.context).toEqual({
      schemaVersion: 1,
      url: 'app://workspace',
      buildBranch: 'master',
      buildDelivery: 'signed',
    });
  });

  it('enriches every feedback kind the same way — the vote payload included', () => {
    const vote = applyBuildMetadata(
      {
        kind: 'context_label',
        sentiment: 1,
        surface: 'workspace-tab-strip',
        context: { schemaVersion: 1, shownLabel: 'Fixing the overlay' },
      },
      BUILD
    );
    expect(vote.appVersion).toBe('1.4.2');
    expect(vote.buildSha).toBe('489ba78');
    expect(vote.sentiment).toBe(1);
  });

  it('never overrides caller-provided values', () => {
    const enriched = applyBuildMetadata(
      {
        ...DRAFT,
        appVersion: '9.9.9',
        buildSha: 'explicit',
        context: { buildBranch: 'release' },
      },
      BUILD
    );
    expect(enriched.appVersion).toBe('9.9.9');
    expect(enriched.buildSha).toBe('explicit');
    expect(enriched.context?.buildBranch).toBe('release');
    expect(enriched.context?.buildDelivery).toBe('signed');
  });

  it('degrades to the unenriched draft without build info (web, old main process)', () => {
    expect(applyBuildMetadata(DRAFT, null)).toEqual(DRAFT);
    const partial = applyBuildMetadata(DRAFT, { sha: 'abc' });
    expect(partial.buildSha).toBe('abc');
    expect(partial.appVersion).toBeNull();
    expect(partial.context).toEqual(DRAFT.context);
  });
});
