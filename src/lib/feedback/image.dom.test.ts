import { describe, expect, it } from 'vitest';
import {
  feedbackImageFilesFromTransfer,
  readFeedbackImage,
  validateFeedbackImageFiles,
} from './image';
import { MAX_FEEDBACK_ATTACHMENT_BYTES } from './contract';

describe('feedback image input', () => {
  it('does not intercept ordinary text paste', () => {
    expect(feedbackImageFilesFromTransfer({ files: [] } as unknown as DataTransfer)).toEqual([]);
    expect(validateFeedbackImageFiles([])).toBeNull();
  });

  it('rejects multiple, unsupported, empty and oversized replacements before reading', () => {
    const valid = new File(['png'], 'image.png', { type: 'image/png' });
    expect(validateFeedbackImageFiles([valid])).toBe(valid);
    expect(() => validateFeedbackImageFiles([valid, valid])).toThrow();
    expect(() => validateFeedbackImageFiles([new File(['pdf'], 'file.pdf', { type: 'application/pdf' })])).toThrow();
    expect(() => validateFeedbackImageFiles([new File([], 'empty.png', { type: 'image/png' })])).toThrow();
    const oversized = new File(['bytes'], 'large.webp', { type: 'image/webp' });
    Object.defineProperty(oversized, 'size', { value: MAX_FEEDBACK_ATTACHMENT_BYTES + 1 });
    expect(() => validateFeedbackImageFiles([oversized])).toThrow();
  });

  it('returns local evidence with a contract-bounded filename', async () => {
    const file = new File(['png'], 'image.png', { type: 'image/png' });
    await expect(readFeedbackImage(file)).resolves.toEqual({
      dataUrl: 'data:image/png;base64,cG5n',
      name: file.name,
      source: 'file',
    });
    const longName = new File(['png'], 'x'.repeat(300), { type: 'image/png' });
    expect((await readFeedbackImage(longName)).name.length).toBeLessThanOrEqual(255);
  });

  it('a cancelled evidence read rejects rather than producing a replacement', async () => {
    const cancellation = new AbortController();
    cancellation.abort();
    await expect(readFeedbackImage(
      new File(['png'], 'image.png', { type: 'image/png' }),
      cancellation.signal
    )).rejects.toMatchObject({ name: 'AbortError' });
  });
});
