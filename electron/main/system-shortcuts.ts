import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { handleTrusted } from './ipc-security';

const execFileAsync = promisify(execFile);

/**
 * macOS system-shortcut truth (ENG-016 D19 amendment): expose the user's
 * ACTUAL symbolic-hotkey preferences so Settings can report real conflicts
 * ("macOS uses ⇧⌘3 for …") instead of assuming Apple defaults — the user
 * may have rebound or disabled any of them in System Settings.
 *
 * This side stays dumb: read the plist, convert to JSON with the system
 * `plutil`, ship it to the renderer. The defaults merge, key mapping, and
 * conflict lookup are pure renderer code (src/lib/shortcuts/system-shortcuts)
 * where they are unit-tested. A missing/unreadable plist returns null and
 * the renderer falls back to Apple defaults.
 */
export function registerSystemShortcutIPC(): void {
  handleTrusted('shortcuts:system-hotkeys', async () => {
    if (process.platform !== 'darwin') return null;
    const plistPath = join(
      homedir(),
      'Library/Preferences/com.apple.symbolichotkeys.plist'
    );
    // Never-customized prefs have no plist at all — that IS the machine
    // truth (Apple defaults apply), so report a verified empty override set
    // rather than falling back to "unverified".
    if (!existsSync(plistPath)) return {};
    try {
      const { stdout } = await execFileAsync(
        '/usr/bin/plutil',
        ['-convert', 'json', '-o', '-', plistPath],
        { timeout: 4_000, maxBuffer: 4 * 1024 * 1024 }
      );
      return JSON.parse(stdout) as unknown;
    } catch {
      // Unreadable prefs: the renderer keeps its Apple-defaults fallback but
      // reports the conflict as UNVERIFIED so the message stays honest.
      return null;
    }
  });
}
