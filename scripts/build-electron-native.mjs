// Compiles the first-party native addons the Electron main loads (ENG-045).
//
// The addons read/request notification authorization and read the current
// screen-lock snapshot, capabilities Electron does not expose reliably.
// They use N-API only, so a single build loads in any Electron version
// and nothing here needs an Electron ABI rebuild or node-gyp. The output sits
// beside the compiled main (`dist-electron/native`), and the packaged app
// unpacks it from the asar (`electron-builder.yml`).
//
// Runs as part of `electron:compile`. Other platforms use their own source
// adapters and do not load these macOS capabilities.
// A missing addon at runtime is not an error: the status reads `unknown`.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ADDONS = [
  {
    name: 'screen-lock-snapshot',
    frameworks: ['CoreGraphics', 'CoreFoundation'],
  },
  {
    name: 'notification-authorization',
    frameworks: ['Foundation', 'UserNotifications'],
  },
];

/** The oldest macOS the packaged app declares support for. */
const MINIMUM_MACOS = '12.0';

function nodeApiHeadersDirectory(root) {
  const require = createRequire(path.join(root, 'package.json'));
  return path.join(
    path.dirname(require.resolve('node-api-headers/package.json')),
    'include'
  );
}

function compileCommand(addon, { root, arch, headers }) {
  return {
    command: 'xcrun',
    args: [
      'clang++',
      '-std=c++17',
      '-fobjc-arc',
      '-bundle',
      '-undefined',
      'dynamic_lookup',
      '-arch',
      arch,
      `-mmacosx-version-min=${MINIMUM_MACOS}`,
      '-I',
      headers,
      ...addon.frameworks.flatMap(framework => ['-framework', framework]),
      '-o',
      path.join(root, 'dist-electron', 'native', `${addon.name}.node`),
      path.join(root, 'electron', 'native', `${addon.name}.mm`),
    ],
  };
}

export function buildElectronNative({
  root = process.cwd(),
  platform = process.platform,
  arch = process.arch,
  run = execFileSync,
} = {}) {
  if (platform !== 'darwin') {
    console.log('[electron-native] skipped: no native addons on this platform');
    return [];
  }
  const headers = nodeApiHeadersDirectory(root);
  mkdirSync(path.join(root, 'dist-electron', 'native'), { recursive: true });
  return ADDONS.map(addon => {
    const { command, args } = compileCommand(addon, {
      root,
      arch: arch === 'arm64' ? 'arm64' : 'x86_64',
      headers,
    });
    run(command, args, { stdio: 'inherit' });
    console.log(`[electron-native] built ${addon.name}.node`);
    return addon.name;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildElectronNative();
}
