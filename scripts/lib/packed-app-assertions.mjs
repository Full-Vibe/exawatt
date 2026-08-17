import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertIcnsMatchesMaster } from './app-icon.mjs';
import { readAsarFiles } from './asar.mjs';
import {
  ASAR_SNAPSHOT_PREFIX,
  BUILD_TOOLCHAIN,
  packagesAlongPath,
  resolveRuntimeClosure,
  stagedPackageOf,
} from './electron-runtime-deps.mjs';

function packageVersion(root) {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    .version;
}

export function readInfoPlist(app) {
  const plist = path.join(app, 'Contents', 'Info.plist');
  if (!existsSync(plist)) throw new Error(`${app} has no Contents/Info.plist`);
  return JSON.parse(
    execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    })
  );
}

function sha256(file) {
  return execFileSync('/usr/bin/shasum', ['-a', '256', file], {
    encoding: 'utf8',
  })
    .trim()
    .split(/\s+/)[0];
}

export function assertBundleIdentity(
  app,
  plist,
  { root = process.cwd(), builderConfig } = {}
) {
  if (!builderConfig) {
    throw new Error('Packed app identity requires the resolved builder config.');
  }
  const version = packageVersion(root);
  for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) {
    if (plist[key] !== version) {
      throw new Error(
        `${app} has ${key} ${plist[key]}, but package.json is ${version}.`
      );
    }
  }
  if (plist.CFBundleIdentifier !== builderConfig.appId) {
    throw new Error(
      `${app} has CFBundleIdentifier ${plist.CFBundleIdentifier}, but the resolved builder config declares ${builderConfig.appId}.`
    );
  }
  const declaredName = builderConfig.productName;
  const shippedNames = [plist.CFBundleName, plist.CFBundleDisplayName].filter(
    Boolean
  );
  if (
    shippedNames.length > 0 &&
    shippedNames.some(name => name !== declaredName)
  ) {
    throw new Error(
      `${app} carries product name ${shippedNames.join('/')} instead of ${declaredName}.`
    );
  }
  const declaredSchemes = (
    Array.isArray(builderConfig.protocols)
      ? builderConfig.protocols
      : [builderConfig.protocols ?? {}]
  )
    .flatMap(protocol => protocol?.schemes ?? [])
    .sort();
  const shippedSchemes = (plist.CFBundleURLTypes ?? [])
    .flatMap(type => type.CFBundleURLSchemes ?? [])
    .sort();
  if (
    declaredSchemes.length !== shippedSchemes.length ||
    declaredSchemes.some((scheme, index) => scheme !== shippedSchemes[index])
  ) {
    throw new Error(
      `${app} registers URL schemes ${shippedSchemes.join(', ') || 'none'}; the resolved distribution declares ${declaredSchemes.join(', ') || 'none'}.`
    );
  }
}

export function assertAppIcon(
  app,
  plist,
  { root = process.cwd(), builderConfig } = {}
) {
  const declaredIcon = plist.CFBundleIconFile;
  const configuredIcon = builderConfig?.mac?.icon;
  if (!configuredIcon) {
    if (!declaredIcon) return;
    const iconName = path.extname(declaredIcon)
      ? declaredIcon
      : `${declaredIcon}.icns`;
    const packagedIcon = path.join(app, 'Contents', 'Resources', iconName);
    const officialIcon = path.join(
      root,
      'electron',
      'resources',
      'icon.icns'
    );
    if (
      existsSync(packagedIcon) &&
      existsSync(officialIcon) &&
      Buffer.compare(readFileSync(packagedIcon), readFileSync(officialIcon)) ===
        0
    ) {
      throw new Error(
        `${app} carries the official icon although this distribution declares no branded icon.`
      );
    }
    return;
  }
  if (!declaredIcon) {
    throw new Error(`${app} declares no CFBundleIconFile.`);
  }
  const iconName = path.extname(declaredIcon)
    ? declaredIcon
    : `${declaredIcon}.icns`;
  const packagedIcon = path.join(app, 'Contents', 'Resources', iconName);
  const configuredPath = path.join(root, configuredIcon);
  if (!existsSync(packagedIcon) || !existsSync(configuredPath)) {
    throw new Error(`${app} is missing its configured icon ${configuredIcon}.`);
  }
  const packagedBytes = readFileSync(packagedIcon);
  if (configuredIcon === 'electron/resources/icon.icns') {
    assertIcnsMatchesMaster(
      packagedBytes,
      readFileSync(path.join(root, 'electron/resources/icon-master.png')),
      `${path.basename(app)}/Contents/Resources/${iconName}`
    );
  }
  if (Buffer.compare(packagedBytes, readFileSync(configuredPath)) !== 0) {
    throw new Error(`${app}'s icon does not match ${configuredIcon}.`);
  }
}

export function assertPackagedPayload(app) {
  const resources = path.join(app, 'Contents', 'Resources');
  if (!existsSync(path.join(resources, 'app.asar'))) {
    throw new Error(`${app} has no Contents/Resources/app.asar`);
  }
  const pty = path.join(
    resources,
    'app.asar.unpacked',
    'dist-electron',
    'node_modules',
    'node-pty',
    'build',
    'Release',
    'pty.node'
  );
  if (!existsSync(pty)) {
    throw new Error(`${app} has no unpacked node-pty binary.`);
  }
  const archive = path.join(resources, 'renderer', 'renderer.zip');
  const hashFile = path.join(resources, 'renderer', 'renderer.sha256');
  for (const file of [archive, hashFile]) {
    if (!existsSync(file)) throw new Error(`${app} has no ${file}`);
  }
  if (readFileSync(hashFile, 'utf8').trim() !== sha256(archive)) {
    throw new Error(`${app}'s renderer hash does not match renderer.zip.`);
  }
  for (const file of [
    'AGPL-3.0.txt',
    'Apache-2.0.txt',
    'LICENSING.md',
    'THIRD_PARTY_NOTICES.md',
    'Electron-LICENSE',
    'LICENSES.chromium.html',
  ]) {
    if (!existsSync(path.join(resources, 'licenses', file))) {
      throw new Error(`${app} has no Contents/Resources/licenses/${file}`);
    }
  }
}

export function assertRuntimePayload(app, { root = process.cwd() } = {}) {
  const files = readAsarFiles(
    path.join(app, 'Contents', 'Resources', 'app.asar')
  );
  for (const file of files) {
    const toolchain = packagesAlongPath(file.path).find(name =>
      BUILD_TOOLCHAIN.includes(name)
    );
    if (toolchain) {
      throw new Error(
        `${app} ships a build toolchain in its runtime payload: ${toolchain} (${file.path}).`
      );
    }
  }
  const nested = files.find(
    file =>
      file.path.startsWith(ASAR_SNAPSHOT_PREFIX) &&
      file.path.slice(ASAR_SNAPSHOT_PREFIX.length).includes('/node_modules/')
  );
  if (nested) throw new Error(`${app} stages a nested node_modules.`);
  const foreignPrebuild = files.find(file => {
    const owner = stagedPackageOf(file.path);
    if (owner === null) return false;
    const within = file.path.slice(
      ASAR_SNAPSHOT_PREFIX.length + owner.length + 1
    );
    const triplet = /^prebuilds\/([a-z0-9]+)-[a-z0-9]+\//.exec(within);
    return Boolean(triplet) && triplet[1] !== 'darwin';
  });
  if (foreignPrebuild) {
    throw new Error(`${app} ships prebuilt binaries for another platform.`);
  }
  const declared = resolveRuntimeClosure(root);
  const staged = new Set();
  for (const file of files) {
    const owner = stagedPackageOf(file.path);
    if (owner !== null) staged.add(owner);
  }
  const extra = [...staged].filter(name => !declared.has(name)).sort();
  const missing = [...declared.keys()]
    .filter(name => !staged.has(name))
    .sort();
  if (extra.length > 0) {
    throw new Error(`${app} stages undeclared packages: ${extra.join(', ')}.`);
  }
  if (missing.length > 0) {
    throw new Error(`${app} is missing runtime packages: ${missing.join(', ')}.`);
  }
}

export function assertRendererServes(app, plist) {
  const archive = path.join(
    app,
    'Contents',
    'Resources',
    'renderer',
    'renderer.zip'
  );
  const executable = path.join(
    app,
    'Contents',
    'MacOS',
    plist.CFBundleExecutable
  );
  const probe = fileURLToPath(
    new URL('./renderer-archive.mjs', import.meta.url)
  );
  try {
    execFileSync(
      process.execPath,
      [probe, archive, existsSync(executable) ? executable : process.execPath],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 8 * 1024 * 1024,
      }
    );
  } catch (error) {
    throw new Error(
      `${app} ships a renderer that does not serve.\n${error.stderr ?? ''}${error.stdout ?? ''}`.trim()
    );
  }
}

export function assertPackedApp(
  app,
  { root = process.cwd(), builderConfig } = {}
) {
  const plist = readInfoPlist(app);
  assertBundleIdentity(app, plist, { root, builderConfig });
  assertAppIcon(app, plist, { root, builderConfig });
  assertPackagedPayload(app);
  assertRuntimePayload(app, { root });
  assertRendererServes(app, plist);
}
