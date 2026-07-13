import { cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const root = process.cwd();
const dependencyRoot = path.join(root, 'dist-electron', 'node_modules');
await rm(dependencyRoot, { recursive: true, force: true });
await mkdir(dependencyRoot, { recursive: true });

const staged = new Set();

async function resolvePackageManifest(name, localRequire) {
  try {
    return localRequire.resolve(`${name}/package.json`);
  } catch (error) {
    if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;

    let directory = path.dirname(await realpath(localRequire.resolve(name)));
    while (directory !== path.dirname(directory)) {
      const candidate = path.join(directory, 'package.json');
      try {
        const parsed = JSON.parse(await readFile(candidate, 'utf8'));
        if (parsed.name === name) return candidate;
      } catch (candidateError) {
        if (candidateError?.code !== 'ENOENT') throw candidateError;
      }
      directory = path.dirname(directory);
    }
    throw error;
  }
}

async function stagePackage(name, resolveFrom = path.join(root, 'package.json')) {
  if (staged.has(name)) return;
  staged.add(name);
  const localRequire = createRequire(resolveFrom);
  const manifest = await resolvePackageManifest(name, localRequire);
  const source = await realpath(path.dirname(manifest));
  const target = path.join(dependencyRoot, ...name.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, dereference: true });
  const parsed = JSON.parse(await readFile(manifest, 'utf8'));
  for (const dependency of Object.keys(parsed.dependencies ?? {})) {
    await stagePackage(dependency, manifest);
  }
}

await stagePackage('node-pty');
await stagePackage('electron-updater');
await stagePackage('@supabase/ssr');
await stagePackage('@supabase/supabase-js');

const { stdout: shaOutput } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
});
const { stdout: branchOutput } = await execFileAsync(
  'git',
  ['branch', '--show-current'],
  { cwd: root }
);
await writeFile(
  path.join(root, 'dist-electron', 'build-info.json'),
  `${JSON.stringify(
    {
      sha: shaOutput.trim(),
      branch: branchOutput.trim(),
      builtAt: new Date().toISOString(),
      delivery:
        process.env.EXAWATT_RELEASE_CHANNEL === 'signed'
          ? 'signed'
          : 'dogfood',
    },
    null,
    2
  )}\n`
);

console.log(`[electron-main] staged ${staged.size} runtime packages`);
