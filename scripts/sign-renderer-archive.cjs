const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const {
  mkdtemp,
  opendir,
  readFile,
  rm,
  stat,
  writeFile,
} = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');

const execFileAsync = promisify(execFile);

async function collectNativeBinaries(directory, result = []) {
  for await (const entry of await opendir(directory)) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectNativeBinaries(entryPath, result);
    } else if (entry.isFile()) {
      const metadata = await stat(entryPath);
      const isNativeCandidate =
        /\.(?:dylib|node|so)$/.test(entry.name) ||
        (metadata.mode & 0o111) !== 0;
      if (!isNativeCandidate) continue;
      const { stdout } = await execFileAsync('/usr/bin/file', [
        '-b',
        entryPath,
      ]);
      if (stdout.includes('Mach-O')) result.push(entryPath);
    }
  }
  return result;
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

module.exports = async function signRendererArchive(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const rendererDir = path.join(
    context.appOutDir,
    appName,
    'Contents',
    'Resources',
    'renderer'
  );
  const archive = path.join(rendererDir, 'renderer.zip');
  const hashFile = path.join(rendererDir, 'renderer.sha256');
  await readFile(archive);

  // Import CSC_LINK into electron-builder's temporary keychain before its
  // normal app-signing phase so binaries hidden in the renderer archive can
  // receive the same Developer ID signature.
  const identityOverride = process.env.EXAWATT_RENDERER_SIGN_IDENTITY;
  const signingInfo = identityOverride
    ? { keychainFile: null }
    : await context.packager.codeSigningInfo.value;
  let identity = identityOverride;
  if (!identity) {
    const identityArgs = ['find-identity', '-v', '-p', 'codesigning'];
    if (signingInfo.keychainFile) identityArgs.push(signingInfo.keychainFile);
    const { stdout } = await execFileAsync('/usr/bin/security', identityArgs);
    identity = stdout
      .split('\n')
      .map(line => line.match(/"(Developer ID Application:[^"]+)"/)?.[1])
      .find(Boolean);
  }
  if (!identity) {
    throw new Error(
      'No Developer ID Application identity found for renderer signing'
    );
  }

  const staging = await mkdtemp(path.join(tmpdir(), 'exawatt-renderer-sign-'));
  try {
    await execFileAsync('/usr/bin/ditto', ['-x', '-k', archive, staging]);
    const binaries = await collectNativeBinaries(staging);
    if (binaries.length === 0) {
      throw new Error('Renderer archive contains no native binaries to sign');
    }

    for (const binary of binaries) {
      const args = ['--force', '--options', 'runtime'];
      if (
        identity !== '-' &&
        process.env.EXAWATT_RENDERER_SIGN_TIMESTAMP !== 'false'
      ) {
        args.push('--timestamp');
      }
      args.push('--sign', identity);
      if (signingInfo.keychainFile) {
        args.push('--keychain', signingInfo.keychainFile);
      }
      args.push(binary);
      await execFileAsync('/usr/bin/codesign', args, { timeout: 120_000 });
      await execFileAsync('/usr/bin/codesign', [
        '--verify',
        '--strict',
        binary,
      ]);
    }

    await rm(archive, { force: true });
    await execFileAsync('/usr/bin/ditto', [
      '-c',
      '-k',
      '--sequesterRsrc',
      '--keepParent',
      path.join(staging, 'dist-renderer'),
      archive,
    ]);
    await writeFile(hashFile, `${await sha256(archive)}\n`);
    console.log(`[renderer-sign] signed ${binaries.length} native binaries`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
};
