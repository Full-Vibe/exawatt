import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const FONT_ASSETS = [
  {
    path: 'src/app/fonts/Exo2-Variable-Latin.woff2',
    sha256: '4a259dde317e08aa5d37e6eb684e222ae833516b2a0fccba36ee5e36224f16be',
    magic: 'wOF2',
  },
  {
    path: 'src/app/fonts/Geist-Variable-Latin.woff2',
    sha256: '19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1',
    magic: 'wOF2',
  },
  {
    path: 'src/app/fonts/GeistMono-Variable-Latin.woff2',
    sha256: '684ad5b531f81d43c1e8c7038262d5db7cdc1f68006e04d6c7769efa8d33c8cc',
    magic: 'wOF2',
  },
  {
    path: 'public/fonts/Exo2-Medium.ttf',
    sha256: '956d939727817620d6b8c3b459d8086151bd6c2b6a48258d134f60a0dcb2b6d2',
    magic: '\u0000\u0001\u0000\u0000',
  },
];

const SOURCE_EXTENSIONS = new Set([
  '.css',
  '.js',
  '.jsx',
  '.mjs',
  '.ts',
  '.tsx',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('the exact licensed font binaries are committed', () => {
  const provenance = readFileSync('LICENSES/fonts/README.md', 'utf8');

  for (const asset of FONT_ASSETS) {
    const bytes = readFileSync(asset.path);
    assert.equal(
      bytes.subarray(0, 4).toString('latin1'),
      asset.magic,
      asset.path
    );
    assert.equal(sha256(bytes), asset.sha256, asset.path);
    assert.match(provenance, new RegExp(asset.path.replaceAll('/', '\\/')));
    assert.match(provenance, new RegExp(asset.sha256));
  }

  assert.equal(
    sha256(readFileSync('LICENSES/fonts/Exo-2-OFL-1.1.txt')),
    '41970aabe4fafb48410304c00fa10f29c03318f142b9928f332ecb15bb404b78'
  );
  assert.equal(
    sha256(readFileSync('LICENSES/fonts/Geist-OFL-1.1.txt')),
    '942560b236adfa83745b2c64e5fc09ebaf91cb331751b1157eb92187e5d6e930'
  );
});

test('the layout preserves the three typography variables and variable weights', () => {
  const layout = readFileSync('src/app/layout.tsx', 'utf8');

  assert.match(layout, /import localFont from 'next\/font\/local'/);
  assert.doesNotMatch(layout, /next\/font\/google/);

  for (const [file, variable] of [
    ['Exo2-Variable-Latin.woff2', '--font-exo2'],
    ['Geist-Variable-Latin.woff2', '--font-geist-sans'],
    ['GeistMono-Variable-Latin.woff2', '--font-geist-mono'],
  ]) {
    assert.match(layout, new RegExp(file.replace('.', '\\.')));
    assert.match(layout, new RegExp(`variable: '${variable}'`));
  }

  assert.equal(layout.match(/weight: '100 900'/g)?.length, 3);
  assert.equal(layout.match(/style: 'normal'/g)?.length, 3);
  assert.equal(layout.match(/display: 'swap'/g)?.length, 3);

  const scene = readFileSync('src/components/hud/webgl/scenes.tsx', 'utf8');
  assert.match(scene, /const FONT = '\/fonts\/Exo2-Medium\.ttf'/);
});

test('application sources have no remote Google font build or runtime dependency', () => {
  const tracked = execFileSync(
    'git',
    ['ls-files', '--', 'src', 'electron', 'packages', 'next.config.*'],
    { encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter(file => SOURCE_EXTENSIONS.has(file.slice(file.lastIndexOf('.'))));

  const forbidden =
    /next\/font\/google|fonts\.googleapis\.com|fonts\.gstatic\.com/;
  const offenders = tracked.filter(file =>
    forbidden.test(readFileSync(file, 'utf8'))
  );
  assert.deepEqual(offenders, []);
});
