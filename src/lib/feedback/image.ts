import { MAX_FEEDBACK_ATTACHMENT_BYTES } from './contract';
import type { FeedbackImage } from './attempt-store';

export const FEEDBACK_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
const IMAGE_TYPES = new Set(FEEDBACK_IMAGE_ACCEPT.split(','));

/** Validate replacements before reading, so a bad selection keeps prior evidence. */
export function validateFeedbackImageFiles(files: readonly File[]): File | null {
  if (!files.length) return null;
  if (files.length !== 1) {
    throw new Error('Attach one image at a time. Your current image is still here.');
  }
  const file = files[0];
  if (!IMAGE_TYPES.has(file.type)) {
    throw new Error('Choose a PNG, JPEG, or WebP image.');
  }
  if (!file.size || file.size > MAX_FEEDBACK_ATTACHMENT_BYTES) {
    throw new Error(`Choose an image up to ${MAX_FEEDBACK_ATTACHMENT_BYTES / (1024 * 1024)} MiB.`);
  }
  return file;
}

/** An ordinary text paste returns no files and stays under native input ownership. */
export function feedbackImageFilesFromTransfer(transfer: DataTransfer): File[] {
  return Array.from(transfer.files);
}

/** Local form-owned read. An abort never replaces the current valid image. */
export function readFeedbackImage(file: File, signal?: AbortSignal): Promise<FeedbackImage> {
  validateFeedbackImageFiles([file]);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => {
      reader.abort();
      cleanup();
      reject(signal?.reason ?? new DOMException('Image read cancelled', 'AbortError'));
    };
    reader.onerror = () => {
      cleanup();
      reject(new Error('Could not read that image. Your current image is still here.'));
    };
    reader.onload = () => {
      cleanup();
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not read that image.'));
        return;
      }
      resolve({ dataUrl: reader.result, name: (file.name || 'image').slice(0, 255), source: 'file' });
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    reader.readAsDataURL(file);
  });
}
