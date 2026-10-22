import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkEvalHandles, closestMember } from './check-eval-handles.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// A small bridge in the shape the real one has: namespaces of members, one
// returning records. Virtual files, never written to disk.
const BRIDGE = new Map([
  [
    'fixture/bridge/window.d.ts',
    `
interface FixtureSession { sessionId: string; title: string }
interface FixtureSettingsApi {
  get(): Promise<unknown>;
  updatePresentation(intent: { field: string; value: string }): Promise<void>;
  setAppearance(value: string): Promise<void>;
}
interface FixturePtyApi { list(): Promise<FixtureSession[]> }
interface FixtureBridge {
  isElectron: true;
  settings: FixtureSettingsApi;
  pty: FixturePtyApi;
}
interface Window { electron?: FixtureBridge }
`,
  ],
]);

function check(script, { product = {}, declarations = BRIDGE } = {}) {
  return checkEvalHandles({
    scripts: new Map([['fixture/eval.mjs', script]]),
    declarations,
    product: new Map(Object.entries(product)),
    root,
    bridgeDirectory: 'fixture/bridge/',
  });
}

const missing = script =>
  check(script).bridge.missing.map(({ line, member, closest }) => ({
    line,
    member,
    closest,
  }));

test('a renamed bridge member fails with the member it became', () => {
  assert.deepEqual(
    missing(`
await page.evaluate(() =>
  window.electron.settings.setPresentation({ fleetView: 'v1' })
);
`),
    [{ line: 3, member: 'setPresentation', closest: 'updatePresentation' }]
  );
});

test('bridge members resolve through aliases, destructuring and optional chains', () => {
  const found = missing(`
await page.evaluate(async () => {
  const settings = window.electron?.settings;
  await settings.updatePresentation({ field: 'fleetView', value: 'v1' });
  await settings.setPresentaton();
  const { pty, nope } = window.electron;
  await pty.lst();
});
`);
  assert.deepEqual(
    found.map(({ line, member }) => ({ line, member })),
    [
      { line: 5, member: 'setPresentaton' },
      { line: 6, member: 'nope' },
      { line: 7, member: 'lst' },
    ]
  );
  assert.equal(found[0].closest, 'updatePresentation');
  assert.equal(found[2].closest, 'list');
});

test('the closest member keeps the noun a rename usually keeps', () => {
  assert.equal(
    closestMember('setPresentation', [
      'setAppearance',
      'updatePresentation',
      'get',
    ]),
    'updatePresentation'
  );
  assert.equal(closestMember('lst', ['list', 'kill', 'write']), 'list');
});

test('a field of what a bridge call returns is checked too', () => {
  assert.deepEqual(
    missing(`
await page.evaluate(async () => {
  const [first] = await window.electron.pty.list();
  return [first.sessionId, first.sesionId];
});
`),
    [{ line: 4, member: 'sesionId', closest: 'sessionId' }]
  );
});

test('page code sent as a string is checked and reports at the string', () => {
  assert.deepEqual(
    missing(`
const x = 1;
await page.evaluate('window.electron.settings.setPresentation()');
`),
    [{ line: 3, member: 'setPresentation', closest: 'updatePresentation' }]
  );
});

test('members that exist, and values the bridge does not type, pass', () => {
  const { bridge } = check(`
await page.evaluate(async () => {
  await window.electron.settings.get();
  const sessions = await window.electron.pty.list();
  return sessions.map(session => session.title).length;
});
const unrelated = { settings: { setPresentation() {} } };
unrelated.settings.setPresentation();
`);
  assert.deepEqual(bridge.missing, []);
  assert.ok(bridge.reached.length >= 4);
});

test('the real bridge declaration resolves from source', () => {
  const declaration = 'src/types/electron.d.ts';
  const { bridge } = checkEvalHandles({
    scripts: new Map([
      [
        'fixture/eval.mjs',
        `await page.evaluate(() => [
  window.electron.platform,
  window.electron.settings.notAMemberOfTheBridge(),
]);`,
      ],
    ]),
    declarations: new Map([
      [declaration, readFileSync(path.join(root, declaration), 'utf8')],
    ]),
    product: new Map(),
    root,
  });
  assert.deepEqual(
    bridge.missing.map(found => found.member),
    ['notAMemberOfTheBridge']
  );
  assert.equal(typeof bridge.missing[0].closest, 'string');
});

// ---- Copy ------------------------------------------------------------------

const PRODUCT = {
  'src/launcher.tsx': `
export function Launcher({ count }: { count: number }) {
  return (
    <div data-launcher>
      <button data-launcher-start aria-label="Start">Start</button>
      <p>{\`Resume \${count} agents in this project\`}</p>
      <ul data-shortcut-id="fixed-back-out"><li>Return focus to the Session</li></ul>
    </div>
  );
}
`,
};

const copy = (script, product = PRODUCT) =>
  check(script, { product }).copy.map(({ line, kind }) => ({ line, kind }));

test('locators bound to text the product writes fail', () => {
  assert.deepEqual(
    copy(`
await page.getByRole('button', { name: 'Start' }).click();
await page.getByText('Return focus to the Session').waitFor();
await page.locator('li', { hasText: /return focus/i }).waitFor();
await page.locator('[aria-label="Start"]').click();
await page.locator('button:has-text("Start")').click();
await page.getByRole('button', { name: 'Resume 2 agents in this project' }).click();
`),
    [
      { line: 2, kind: 'getByRole name' },
      { line: 3, kind: 'getByText' },
      { line: 4, kind: 'hasText' },
      { line: 5, kind: 'copy selector' },
      { line: 6, kind: 'copy selector' },
      { line: 7, kind: 'getByRole name' },
    ]
  );
});

test('a label reached through a loop over literals fails, the shape that broke', () => {
  assert.deepEqual(
    copy(`
for (const label of ['Return focus to the Session', 'Start']) {
  await dialog.getByText(label).waitFor();
}
`),
    [{ line: 3, kind: 'getByText' }]
  );
});

test('rendered text compared against product copy fails', () => {
  assert.deepEqual(
    copy(`
const text = await page.locator('[data-launcher]').innerText();
check('offers start', text.includes('Start'));
check('exact', (await row.textContent()) === 'Return focus to the Session');
check('pattern', /resume \\d+ agents/i.test(await row.innerText()));
`),
    [
      { line: 3, kind: 'rendered text includes' },
      { line: 4, kind: 'rendered text equality' },
      { line: 5, kind: 'rendered text test' },
    ]
  );
});

test('rendered text read through a helper the script defines fails too', () => {
  assert.deepEqual(
    copy(`
const panelText = async page => {
  await page.locator('[data-launcher]').waitFor();
  return page.locator('[data-launcher]').innerText();
};
check('offers start', (await panelText(page)).includes('Start'));
`),
    [{ line: 6, kind: 'rendered text includes' }]
  );
});

test('handles, roles and text the eval wrote itself pass', () => {
  assert.deepEqual(
    copy(`
await page.locator('[data-shortcut-id="fixed-back-out"]').waitFor();
await page.locator('[data-launcher-start]').click();
await page.getByRole('dialog').waitFor();
await page.getByRole('button', { name: 'alpha-fixture-project' }).click();
await page.keyboard.type('echo EVAL_READY');
check('typed', (await terminal.innerText()).includes('EVAL_READY'));
check('count', (await badge.innerText()) === '3');
`),
    []
  );
});

test('a stated reason keeps a text binding', () => {
  assert.deepEqual(
    copy(`
// binds-text: the native dialog is macOS's own and has no handle
await page.getByText('Start').click();
await page.getByRole('button', {
  name: 'Start', // binds-text: the accessible name is the promise under test
}).click();
await page.getByText('Start').click();
`),
    [{ line: 7, kind: 'getByText' }]
  );
});

// ---- Rendered handles -----------------------------------------------------

test('an attribute selector the product never renders fails', () => {
  const { handles } = check(
    `
await page.locator('[data-launcher-start]').click();
await page.locator('[data-launcher-stop]').click();
await page.evaluate(() => document.querySelectorAll('[data-board-tile]').length);
await page.locator('[data-shortcut-id="fixed-back-out"]').waitFor();
`,
    {
      product: {
        ...PRODUCT,
        'src/board.tsx':
          'export const mark = (el: HTMLElement) => { el.dataset.boardTile = "1"; };',
      },
    }
  );
  assert.deepEqual(
    handles.map(({ line, attribute }) => ({ line, attribute })),
    [{ line: 3, attribute: 'launcher-stop' }]
  );
});

test('fixtures and tests in the product tree are not product copy', () => {
  assert.deepEqual(
    copy(`await page.getByText('Fixture only label').click();`, {
      'src/launcher.fixtures.ts': `export const label = 'Fixture only label';`,
      'src/launcher.test.tsx': `const label = 'Fixture only label';`,
    }),
    []
  );
});
