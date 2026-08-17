import { describe, expect, it, vi } from 'vitest';
import { shellQuote } from './clipboard-paste';

// This suite runs in Node, so importing the real `electron` package would run
// its installer shim: it reads `node_modules/electron/path.txt`, and when that
// file is briefly absent — which it is every time a sibling agent worktree
// re-links Electron — it tries to DOWNLOAD Electron and then throws "Electron
// failed to install correctly". Nothing here wants the binary's path, only the
// pure logic under test, so the module is stood down rather than resolved
// (BUG-057). The four suites that need `app` already mock it with a body.
vi.mock('electron', () => ({}));

describe('shellQuote', () => {
  it('quotes image paths without permitting shell injection', () => {
    expect(shellQuote("/tmp/a user's; image.png")).toBe(
      "'/tmp/a user'\\''s; image.png'"
    );
  });
});
