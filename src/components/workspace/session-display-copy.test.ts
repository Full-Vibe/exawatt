import { describe, expect, it } from 'vitest';
import {
  sessionCurrentStateCopy,
  sessionDisplayCopy,
} from './session-display-copy';

describe('sessionDisplayCopy', () => {
  it('uses the durable context label as default Agent identity', () => {
    expect(
      sessionDisplayCopy({
        harness: 'codex',
        title: 'Codex',
        titleKind: 'default',
        lifecycle: 'running',
        summary: 'Improve session text readability and content',
      })
    ).toEqual({
      primary: 'Improve session text readability and content',
      context: null,
      primaryKind: 'context',
    });
  });

  it('uses New agent when a default Agent has no usable context label', () => {
    expect(
      sessionDisplayCopy({
        harness: 'claude',
        title: 'Claude Code',
        titleKind: 'default',
        lifecycle: 'running',
        summary: null,
      })
    ).toEqual({
      primary: 'New agent',
      context: null,
      primaryKind: 'fallback',
    });
  });

  it('is total for corrupt blank titles and summaries', () => {
    expect(
      sessionDisplayCopy({
        harness: 'codex',
        title: '   ',
        titleKind: 'operator',
        lifecycle: 'stopped-clean',
        summary: '\n',
      }).primary
    ).toBe('New agent');
  });

  it('keeps an operator rename primary and the context label secondary', () => {
    expect(
      sessionDisplayCopy({
        harness: 'claude',
        title: 'Patty extraction',
        titleKind: 'operator',
        lifecycle: 'running',
        summary: 'Extract Practice Fusion flowsheets for Patty',
      })
    ).toEqual({
      primary: 'Patty extraction',
      context: 'Extract Practice Fusion flowsheets for Patty',
      primaryKind: 'operator',
    });
  });

  it('keeps shells identifiable without inventing Agent copy', () => {
    expect(
      sessionDisplayCopy({
        harness: 'shell',
        title: '',
        titleKind: 'default',
        lifecycle: 'running',
      }).primary
    ).toBe('Shell');
  });
});

describe('sessionCurrentStateCopy', () => {
  it('describes known turn truth without interpreting terminal output', () => {
    expect(
      sessionCurrentStateCopy({
        harness: 'codex',
        live: true,
        lifecycle: 'running',
        glyphState: 'working',
      })
    ).toBe('Agent is working');
    expect(
      sessionCurrentStateCopy({
        harness: 'codex',
        live: true,
        lifecycle: 'running',
        glyphState: 'done',
      })
    ).toBe('Turn complete');
    expect(
      sessionCurrentStateCopy({
        harness: 'codex',
        live: true,
        lifecycle: 'running',
        glyphState: 'fresh',
      })
    ).toBe('Ready for instructions');
  });

  it('lets operator gates and lifecycle failures outrank turn state', () => {
    expect(
      sessionCurrentStateCopy({
        harness: 'codex',
        live: true,
        lifecycle: 'running',
        glyphState: 'working',
        attention: { kind: 'roadmap-blocked', since: 1 },
      })
    ).toBe('Roadmap work is blocked');
    expect(
      sessionCurrentStateCopy({
        harness: 'codex',
        live: false,
        lifecycle: 'failed',
        glyphState: 'done',
      })
    ).toBe('Agent process failed');
  });
});
