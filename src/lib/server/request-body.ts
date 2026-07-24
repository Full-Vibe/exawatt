export class RequestBodyTooLargeError extends Error {}

/** Stop consuming an untrusted streamed body as soon as its byte budget is hit. */
export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number
): Promise<string> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyTooLargeError('Request is too large');
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the useful size error when transport cleanup also fails.
        }
        throw new RequestBodyTooLargeError('Request is too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
