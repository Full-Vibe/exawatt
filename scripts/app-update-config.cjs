/**
 * Write `app-update.yml` into a packaged macOS app (BUG-015, incident 0009).
 *
 * electron-updater has no compiled-in feed. On its first check it reads
 * `Contents/Resources/app-update.yml`, and `loadUpdateConfig` does a bare
 * `readFile` with no existence check — a missing file is an ENOENT rejection,
 * surfaced to the operator as "Update failed" on every launch, forever.
 *
 * electron-builder normally writes that file itself, from `PublishManager`'s
 * `onAfterPack`. But that handler returns early unless the darwin pack
 * produced a `dmg` or `zip` target:
 *
 *     if (event.electronPlatformName === "darwin") {
 *       if (!event.targets.some(it => it.name === "dmg" || it.name === "zip")) return
 *     }
 *
 * The release build packs `--mac dir` on purpose: ENG-020 notarizes the .app
 * once and builds the containers afterwards from the stapled bundle, so the
 * pack step has no container target to declare. `release-package.mjs` then
 * runs `--prepackaged`, which skips packing entirely and never fires
 * `afterPack` at all. Neither half of the release path could write the file,
 * so every signed release shipped with a dead updater.
 *
 * This module writes the same file, from the same config, at the same moment
 * electron-builder would — inside `afterPack`, which runs before
 * `doSignAfterPack`, so the file is covered by the app signature rather than
 * invalidating it.
 */

const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const { stringify } = require('yaml');

/**
 * Resolve the publish entry electron-builder would hand the updater: the
 * platform-specific block wins over the top level, and the first entry wins
 * when several are declared (`getAppUpdatePublishConfiguration` takes
 * `publishConfigs[0]`).
 */
function resolvePublishConfig(publish) {
  const first = Array.isArray(publish) ? publish[0] : publish;
  if (typeof first === 'string') return { provider: first };
  return first ?? null;
}

/**
 * The exact object electron-builder serializes: the publish entry plus the
 * updater's cache directory name. electron-updater logs an error and falls
 * back to a guessed directory when `updaterCacheDirName` is absent, so it is
 * required here rather than optional.
 */
function appUpdateConfig({ publish, platformPublish, updaterCacheDirName }) {
  const config = resolvePublishConfig(platformPublish ?? publish);
  if (config == null) {
    throw new Error(
      'No publish configuration to write into app-update.yml — a build with ' +
        'no feed leaves electron-updater failing on every launch (BUG-015)'
    );
  }
  if (typeof config.provider !== 'string' || config.provider.length === 0) {
    throw new Error(
      `Publish configuration has no provider: ${JSON.stringify(config)}`
    );
  }
  if (
    typeof updaterCacheDirName !== 'string' ||
    updaterCacheDirName.length === 0
  ) {
    throw new Error('appInfo.updaterCacheDirName is required for app-update.yml');
  }
  return { ...config, updaterCacheDirName };
}

/** electron-builder `afterPack` hook. */
async function writeAppUpdateConfig(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const { packager } = context;
  const config = appUpdateConfig({
    publish: packager.config?.publish,
    platformPublish: packager.platformSpecificBuildOptions?.publish,
    updaterCacheDirName: packager.appInfo.updaterCacheDirName,
  });

  const target = path.join(
    context.appOutDir,
    `${packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
    'app-update.yml'
  );
  await writeFile(target, stringify(config));
  console.log(`[app-update-config] ${config.provider} feed written`);
}

module.exports = { appUpdateConfig, resolvePublishConfig, writeAppUpdateConfig };
