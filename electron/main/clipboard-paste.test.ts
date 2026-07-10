import { describe, expect, it } from 'vitest';
import { shellQuote } from './clipboard-paste';

describe('shellQuote', () => {
  it('quotes image paths without permitting shell injection', () => {
    expect(shellQuote("/tmp/a user's; image.png")).toBe(
      "'/tmp/a user'\\''s; image.png'"
    );
  });
});
