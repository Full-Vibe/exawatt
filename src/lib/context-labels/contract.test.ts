import { describe, expect, it } from 'vitest';
import { CONTEXT_LABEL_GOLD_CASES } from './gold-cases';
import {
  CONTEXT_LABEL_SCHEMA_VERSION,
  cleanContextLabel,
  contextLabelAnthropicRequest,
  isAttachmentOnlyInstruction,
  parseContextLabelRequest,
  parseContextLabelResponse,
  provisionalContextLabel,
} from './contract';

describe('Session context-label contract', () => {
  it('commits the operator-approved dogfood regressions to the gold corpus', () => {
    expect(CONTEXT_LABEL_GOLD_CASES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'dogfood-stale-reopen-tabs',
          expectedLabel: 'Improve agent context summaries',
        }),
        expect.objectContaining({
          id: 'dogfood-image-only-launch',
          expectedLabel: 'New agent',
        }),
        expect.objectContaining({
          id: 'dogfood-project-ribbon-to-agent-sources',
          expectedLabel: 'Trustworthy agent sources and launch UX',
          expectedRelationship: 'new_context',
        }),
      ])
    );
  });

  it('uses New agent for image-only launches and never exposes temp paths', () => {
    const paths = [
      '/var/folders/xy/T/exawatt-clipboard/id.png',
      "'/private/var/folders/xy/T/exawatt-clipboard/id.png'",
      '<image name="Screenshot" path="/var/folders/xy/id.png"></image>',
      '[Image #1]',
    ];
    for (const value of paths) {
      expect(isAttachmentOnlyInstruction(value)).toBe(true);
      expect(provisionalContextLabel(value)).toBe('New agent');
      expect(cleanContextLabel(value)).toBeNull();
    }
  });

  it('keeps useful immediate launch copy and bounds it on words', () => {
    expect(provisionalContextLabel('Improve text legibility.')).toBe(
      'Improve text legibility'
    );
    const result = provisionalContextLabel(
      'Investigate why the authenticated product feedback workflow is failing in the packaged desktop application'
    );
    expect(result.length).toBeLessThanOrEqual(72);
    expect(result.endsWith('…')).toBe(true);
  });

  it('validates a bounded evidence request', () => {
    const parsed = parseContextLabelRequest(
      JSON.stringify({
        schemaVersion: CONTEXT_LABEL_SCHEMA_VERSION,
        sessionKey: 'session-1',
        currentLabel: 'Fix auth redirect loop',
        recentInstructions: [
          { text: 'Improve agent context summaries', submittedAt: 123 },
        ],
      })
    );
    expect(parsed.recentInstructions[0].text).toBe(
      'Improve agent context summaries'
    );
    expect(() =>
      parseContextLabelRequest(
        JSON.stringify({
          schemaVersion: 99,
          sessionKey: 'session-1',
          recentInstructions: [],
        })
      )
    ).toThrow('Schema version');
  });

  it('anchors same-context output to the exact current label', () => {
    const result = parseContextLabelResponse(
      {
        content: [
          {
            type: 'tool_use',
            name: 'record_session_context',
            input: {
              label: 'Checkout postal validation',
              relationship: 'same_context',
              confidence: 0.91,
            },
          },
        ],
      },
      'MVP of Widget Checkout',
      'accepted'
    );
    expect(result).toEqual({
      label: 'MVP of Widget Checkout',
      relationship: 'same_context',
      confidence: 0.91,
    });
  });

  it('allows same-context inference to sharpen raw provisional launch copy', () => {
    const result = parseContextLabelResponse(
      {
        content: [
          {
            type: 'tool_use',
            name: 'record_session_context',
            input: {
              label: 'Improve agent context summaries',
              relationship: 'same_context',
              confidence: 0.93,
            },
          },
        ],
      },
      'Please investigate and improve our stale agent title summarization system',
      'provisional'
    );
    expect(result.label).toBe('Improve agent context summaries');
  });

  it('rejects model narration, control tokens, questions, and paths', () => {
    for (const value of [
      'KEEP',
      'NO_GOAL',
      "I'm improving the summaries",
      'What is this session doing?',
      'Based on the conversation, improve summaries',
      '/tmp/context.png',
      '**Improve summaries**',
    ]) {
      expect(cleanContextLabel(value), value).toBeNull();
    }
  });

  it('gives the model explicit stability and pivot calibration', () => {
    const body = contextLabelAnthropicRequest({
      schemaVersion: 1,
      sessionKey: 'session-1',
      currentLabel: 'Implement cmd+shift+t to reopen tabs',
      recentInstructions: [
        { text: 'Improve the agent title summarizer', submittedAt: 1 },
      ],
    });
    expect(body.system).toContain('Improve agent context summaries');
    expect(body.system).toContain('repeat the current label exactly');
    expect(body.system).toContain('genuinely unrelated purpose');
    expect(body.tool_choice.name).toBe('record_session_context');
    expect(body.tools[0].input_schema.properties.confidence).toEqual({
      type: 'number',
    });
  });
});
