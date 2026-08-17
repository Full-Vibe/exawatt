// Generated for the public repository by the "public-dogfood-tooling" recipe.
import { execFile } from 'node:child_process';
import { opendir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const developerIdPrefix = 'Developer ID Application:';

export function parseCodeSigningIdentities(output) {
  return output
    .split('\n')
    .map(line => {
      const match = line.match(/^\s*\d+\)\s+([0-9a-f]{40})\s+"([^"]+)"/i);
      if (!match) return null;
      return {
        fingerprint: match[1].toUpperCase(),
        name: match[2],
      };
    })
    .filter(Boolean);
}

export function teamIdentifierFromIdentityName(name) {
  return name.match(/\(([A-Z0-9]{10})\)\s*$/)?.[1] ?? null;
}

export function selectDeveloperIdIdentity(
  identities,
  requestedFingerprint,
  expectedTeamIdentifier
) {
  const candidates = identities.filter(identity =>
    identity.name.startsWith(developerIdPrefix)
  );
  const eligible = expectedTeamIdentifier
    ? candidates.filter(
        identity =>
          teamIdentifierFromIdentityName(identity.name) ===
          expectedTeamIdentifier
      )
    : candidates;

  if (requestedFingerprint) {
    if (!/^[0-9a-f]{40}$/i.test(requestedFingerprint)) {
      throw new Error(
        'EXAWATT_DOGFOOD_SIGN_IDENTITY must be the exact 40-character SHA-1 fingerprint of a Developer ID Application identity.'
      );
    }
    const selected = candidates.find(
      identity =>
        identity.fingerprint.toUpperCase() ===
        requestedFingerprint.toUpperCase()
    );
    if (!selected) {
      throw new Error(
        'EXAWATT_DOGFOOD_SIGN_IDENTITY does not match a valid Developer ID Application identity in the current Keychain.'
      );
    }
    const selectedTeamIdentifier = teamIdentifierFromIdentityName(
      selected.name
    );
    if (
      expectedTeamIdentifier &&
      selectedTeamIdentifier !== expectedTeamIdentifier
    ) {
      throw new Error(
        `EXAWATT_DOGFOOD_SIGN_IDENTITY belongs to Team ${selectedTeamIdentifier ?? '(unknown)'}; this distribution requires Team ${expectedTeamIdentifier}.`
      );
    }
    return selected;
  }

  if (eligible.length === 0) {
    throw new Error(
      expectedTeamIdentifier
        ? `No valid Developer ID Application identity for Team ${expectedTeamIdentifier} is available. Import that distributor's Developer ID certificate and private key, then rerun the dogfood install.`
        : 'No valid Developer ID Application identity is available. Import a distribution signing certificate and private key, then rerun the dogfood install.'
    );
  }
  if (eligible.length > 1) {
    throw new Error(
      `Multiple Developer ID Application identities${expectedTeamIdentifier ? ` for Team ${expectedTeamIdentifier}` : ''} are available. Set EXAWATT_DOGFOOD_SIGN_IDENTITY to the exact 40-character SHA-1 fingerprint returned by \`security find-identity -v -p codesigning\`.`
    );
  }
  return eligible[0];
}

export async function resolveDeveloperIdIdentity({
  requestedFingerprint = process.env.EXAWATT_DOGFOOD_SIGN_IDENTITY,
  expectedTeamIdentifier = process.env.EXAWATT_EXPECTED_TEAM_IDENTIFIER,
} = {}) {
  if (process.platform !== 'darwin') {
    throw new Error('Stable dogfood signing is supported only on macOS.');
  }
  const { stdout } = await execFileAsync('/usr/bin/security', [
    'find-identity',
    '-v',
    '-p',
    'codesigning',
  ]);
  return selectDeveloperIdIdentity(
    parseCodeSigningIdentities(stdout),
    requestedFingerprint,
    expectedTeamIdentifier
  );
}

export function parseCodesignDetails(output) {
  const values = new Map();
  const authorities = [];
  for (const line of output.split('\n')) {
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key === 'Authority') authorities.push(value);
    else values.set(key, value);
  }
  return {
    identifier: values.get('Identifier') ?? null,
    teamIdentifier: values.get('TeamIdentifier') ?? null,
    signature: values.get('Signature') ?? null,
    cdHash: values.get('CDHash') ?? null,
    timestamp: values.get('Timestamp') ?? null,
    runtimeVersion: values.get('Runtime Version') ?? null,
    authorities,
  };
}

export function assertStableDeveloperIdSignature(
  signature,
  { expectedIdentifier, expectedTeamIdentifier, label = 'code object' } = {}
) {
  if (!signature.identifier) {
    throw new Error(`${label} has no signed program identifier.`);
  }
  if (expectedIdentifier && signature.identifier !== expectedIdentifier) {
    throw new Error(
      `${label} uses identifier ${signature.identifier}; expected ${expectedIdentifier}.`
    );
  }
  if (
    !signature.teamIdentifier ||
    signature.teamIdentifier.toLowerCase() === 'not set'
  ) {
    throw new Error(`${label} has no stable Team Identifier.`);
  }
  if (!signature.cdHash) {
    throw new Error(`${label} has no code-directory hash.`);
  }
  if (!signature.timestamp) {
    throw new Error(`${label} has no secure signing timestamp.`);
  }
  if (!signature.runtimeVersion) {
    throw new Error(`${label} is not signed with hardened-runtime options.`);
  }
  if (
    expectedTeamIdentifier &&
    signature.teamIdentifier !== expectedTeamIdentifier
  ) {
    throw new Error(
      `${label} uses Team Identifier ${signature.teamIdentifier}; expected ${expectedTeamIdentifier}.`
    );
  }
  if (
    signature.signature?.toLowerCase() === 'adhoc' ||
    !signature.authorities.some(authority =>
      authority.startsWith(developerIdPrefix)
    )
  ) {
    throw new Error(
      `${label} is not signed with a Developer ID Application identity.`
    );
  }
}

async function codesignDetails(codePath) {
  try {
    const { stderr } = await execFileAsync(
      '/usr/bin/codesign',
      ['--display', '--verbose=4', codePath],
      { maxBuffer: 1024 * 1024 }
    );
    return parseCodesignDetails(stderr);
  } catch (cause) {
    const error = new Error(
      `${codePath} is unsigned or its signature cannot be inspected.`
    );
    if (
      /code object is not signed at all/i.test(
        String(cause?.stderr ?? cause?.stdout ?? '')
      )
    ) {
      error.code = 'ERR_CODE_OBJECT_UNSIGNED';
    }
    error.cause = cause;
    throw error;
  }
}

async function verifyCode(codePath, { deep = false } = {}) {
  const args = ['--verify'];
  if (deep) args.push('--deep');
  args.push('--strict', '--verbose=2', codePath);
  try {
    await execFileAsync('/usr/bin/codesign', args, {
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    const details = String(error?.stderr ?? error?.stdout ?? '').trim();
    throw new Error(
      `${codePath} failed strict code-signature verification.${details ? ` ${details}` : ''}`
    );
  }
}

async function isMachO(file) {
  try {
    const { stdout } = await execFileAsync('/usr/bin/file', ['-b', file]);
    return stdout.includes('Mach-O');
  } catch {
    return false;
  }
}

async function collectCodeObjects(directory, result = new Set()) {
  for await (const entry of await opendir(directory)) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (/\.(?:app|framework|xpc|bundle)$/.test(entry.name)) {
        result.add(entryPath);
      }
      await collectCodeObjects(entryPath, result);
      continue;
    }
    if (!entry.isFile()) continue;
    const metadata = await stat(entryPath);
    const isNativeCandidate =
      /\.(?:dylib|node|so)$/.test(entry.name) || (metadata.mode & 0o111) !== 0;
    if (isNativeCandidate && (await isMachO(entryPath))) result.add(entryPath);
  }
  return result;
}

export async function inspectCodeSignature(codePath) {
  return codesignDetails(codePath);
}

export function hasStableSignerIdentity(signature) {
  return Boolean(
    signature.identifier &&
    signature.teamIdentifier &&
    signature.teamIdentifier.toLowerCase() !== 'not set' &&
    signature.signature?.toLowerCase() !== 'adhoc' &&
    signature.authorities.length > 0
  );
}

async function verifyCodeObjects(
  codeObjects,
  { expectedTeamIdentifier, rootDirectory }
) {
  let verified = 0;
  for (const codePath of [...codeObjects].sort()) {
    await verifyCode(codePath);
    const signature = await codesignDetails(codePath);
    const label = rootDirectory
      ? path.relative(rootDirectory, codePath) || path.basename(codePath)
      : codePath;
    assertStableDeveloperIdSignature(signature, {
      expectedTeamIdentifier,
      label,
    });
    verified += 1;
  }
  return verified;
}

async function verifyRendererArchive(rendererArchive, expectedTeamIdentifier) {
  const staging = await mkdtemp(
    path.join(tmpdir(), 'exawatt-renderer-verify-')
  );
  try {
    await execFileAsync('/usr/bin/ditto', [
      '-x',
      '-k',
      rendererArchive,
      staging,
    ]);
    const codeObjects = await collectCodeObjects(staging);
    if (codeObjects.size === 0) {
      throw new Error(
        'The renderer archive contains no verifiable native code.'
      );
    }
    return await verifyCodeObjects(codeObjects, {
      expectedTeamIdentifier,
      rootDirectory: staging,
    });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function evaluateAppCodeIdentity(
  appPath,
  { expectedIdentifier, expectedTeamIdentifier } = {}
) {
  if (process.platform !== 'darwin') {
    throw new Error('The macOS code-identity evaluator requires macOS.');
  }

  await verifyCode(appPath, { deep: true });
  const appSignature = await codesignDetails(appPath);
  assertStableDeveloperIdSignature(appSignature, {
    expectedIdentifier,
    expectedTeamIdentifier,
    label: appPath,
  });

  const codeObjects = await collectCodeObjects(appPath);
  codeObjects.delete(appPath);
  const nestedCodeCount = await verifyCodeObjects(codeObjects, {
    expectedTeamIdentifier: appSignature.teamIdentifier,
    rootDirectory: appPath,
  });

  const rendererArchive = path.join(
    appPath,
    'Contents',
    'Resources',
    'renderer',
    'renderer.zip'
  );
  const archivedNativeCodeCount = await verifyRendererArchive(
    rendererArchive,
    appSignature.teamIdentifier
  );

  return {
    identifier: appSignature.identifier,
    teamIdentifier: appSignature.teamIdentifier,
    nestedCodeCount,
    archivedNativeCodeCount,
  };
}
