import { describe, expect, it } from 'vitest';
import { parseFeedbackRequest } from './contract';

const base = {
  kind: 'bug',
  message: 'The tab label is stale after a topic pivot.',
  surface: 'workspace-tab-strip',
  idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
};

describe('product-feedback contract', () => {
  it('accepts broad text feedback with bounded context', () => {
    expect(
      parseFeedbackRequest(
        JSON.stringify({ ...base, context: { tabCount: 4 } })
      )
    ).toMatchObject({
      kind: 'bug',
      message: base.message,
      context: { tabCount: 4 },
      attachment: null,
    });
  });

  it('requires a vote for label feedback and text for general feedback', () => {
    expect(() =>
      parseFeedbackRequest(
        JSON.stringify({ ...base, kind: 'context_label', message: null })
      )
    ).toThrow('requires a vote');
    expect(() =>
      parseFeedbackRequest(JSON.stringify({ ...base, message: null }))
    ).toThrow('message is required');
  });

  it('accepts private screenshot formats but rejects arbitrary files', () => {
    const parsed = parseFeedbackRequest(
      JSON.stringify({
        ...base,
        attachment: {
          dataUrl: `data:image/png;base64,${Buffer.from('png').toString('base64')}`,
        },
      })
    );
    expect(parsed.attachment).toMatchObject({
      mimeType: 'image/png',
      extension: 'png',
    });
    expect(() =>
      parseFeedbackRequest(
        JSON.stringify({
          ...base,
          attachment: {
            dataUrl: `data:text/plain;base64,${Buffer.from('secret').toString('base64')}`,
          },
        })
      )
    ).toThrow('type is invalid');
  });

  it('requires UUID idempotency keys', () => {
    expect(() =>
      parseFeedbackRequest(
        JSON.stringify({ ...base, idempotencyKey: 'retry-me' })
      )
    ).toThrow('Idempotency key');
  });
});
