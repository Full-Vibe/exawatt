/**
 * Measurement probe for BUG-037 (ENG-016) — a diagnostic, NOT a gate. The
 * renderer sibling of `scripts/session-lifecycle-leak-probe.mjs`.
 *
 * The question: after the operator closes a Session, how many bytes does the
 * RENDERER still hold for it?
 *
 * The renderer has the same two identity spaces as main and, until BUG-037,
 * had no "this Session is forgotten" moment either. `closeTab` and
 * `removeTabFromLayout` are layout operations that several code paths perform
 * and none of them owned Session-scoped memory, so `summaries`, `goalVisuals`,
 * `engaged`, `attention`, `activity`, `delegation` and the observed-identity
 * map had add sites and no delete sites. Every Session the operator ever
 * opened stayed resident for the life of the window.
 *
 *   node --expose-gc scripts/renderer-session-lifecycle-leak-probe.mjs
 *   node --expose-gc scripts/renderer-session-lifecycle-leak-probe.mjs --fleet 100
 *
 * It drives the REAL hook — `useWorkspaceState` rendered by React 19 into a
 * jsdom document, fed by a stubbed `window.electron` that plays main's actual
 * broadcast stream — so the numbers describe shipped code rather than a
 * re-implementation. To measure the pre-fix side, check out a tree without the
 * fix and run the same command.
 *
 * `esbuild` is used to bundle the renderer module graph for plain Node. It is
 * not a declared dependency; the probe resolves the copy vite/vitest already
 * install and says so plainly if it cannot find one.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

if (typeof globalThis.gc !== 'function') {
  console.error(
    'Run with --expose-gc: node --expose-gc scripts/renderer-session-lifecycle-leak-probe.mjs'
  );
  process.exit(1);
}

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const FLEET = Number(
  args.includes('--fleet') ? args[args.indexOf('--fleet') + 1] : 100
);

/** esbuild ships inside the vite toolchain; find whichever copy is installed. */
async function loadEsbuild() {
  const candidates = [
    'esbuild',
    path.join(root, 'node_modules/.pnpm/node_modules/esbuild/lib/main.js'),
  ];
  const store = path.join(root, 'node_modules/.pnpm');
  if (fs.existsSync(store)) {
    for (const entry of fs.readdirSync(store)) {
      if (entry.startsWith('esbuild@')) {
        candidates.push(
          path.join(store, entry, 'node_modules/esbuild/lib/main.js')
        );
      }
    }
  }
  for (const candidate of candidates) {
    try {
      return await import(
        candidate.startsWith('esbuild')
          ? candidate
          : pathToFileURL(candidate).href
      );
    } catch {
      // try the next location
    }
  }
  console.error(
    'Could not resolve esbuild. Run `pnpm install` in this worktree first.'
  );
  process.exit(1);
}

const esbuild = await loadEsbuild();
const outfile = path.join(
  root,
  'node_modules/.cache/exawatt/renderer-session-leak-probe.mjs'
);
fs.mkdirSync(path.dirname(outfile), { recursive: true });
await esbuild.build({
  stdin: {
    contents:
      "export { useWorkspaceState } from '@/components/workspace/use-workspace-state';\n",
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  target: 'es2022',
  logLevel: 'error',
  outfile,
  alias: { '@': path.join(root, 'src') },
  external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.NEXT_PUBLIC_SUPABASE_URL': '"http://localhost"',
    'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '"probe"',
  },
});

// ---- a document to render into -------------------------------------------
const { JSDOM } = await import('jsdom');
const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  {
    url: 'http://localhost/workspace',
    pretendToBeVisual: true,
  }
);
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (key in globalThis) continue;
  try {
    globalThis[key] = dom.window[key];
  } catch {
    // read-only jsdom internals are not needed here
  }
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator ??= dom.window.navigator;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { useWorkspaceState } = await import(pathToFileURL(outfile).href);

// ---- main's broadcast side, stubbed ---------------------------------------
const REPO = '/repo/exawatt';
/**
 * The operator's real goal visual is a ~265 KB JPEG carried as a base64 data
 * URL. Its bytes dominate a forgotten Session's residue.
 *
 * The payload is UNIQUE per Session and incompressible, like the JPEG it
 * stands for. A repeated pattern is not a fair stand-in: V8 stores
 * `'YWJj'.repeat(n)` in a fraction of the space, which understates the leak by
 * two orders of magnitude.
 */
const GOAL_VISUAL_BYTES = 265 * 1024;
const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function goalVisualDataUrl(seed) {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    state = Math.imul(state ^ seed.charCodeAt(i), 16777619) >>> 0 || 1;
  }
  const bytes = new Array(GOAL_VISUAL_BYTES);
  for (let i = 0; i < GOAL_VISUAL_BYTES; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bytes[i] = BASE64[state >>> 26];
  }
  return `data:image/jpeg;base64,${bytes.join('')}`;
}

const handlers = {};
const channel = name => handler => {
  (handlers[name] ??= []).push(handler);
  return () => {};
};
const emit = (name, payload) => {
  for (const handler of handlers[name] ?? []) handler(payload);
};
const sessions = Array.from({ length: FLEET }, (_, index) => ({
  id: `pty-${index}`,
  durableSessionId: `session-${index}`,
  harness: 'claude',
  title: 'Claude Code',
  cwd: REPO,
  projectDir: REPO,
  projectName: 'exawatt',
  cols: 120,
  rows: 40,
  startedAt: 1,
  exited: false,
  exitCode: null,
  lastDataAt: 1,
  harnessSessionId: null,
}));

/** Launched one at a time, so `idle` is a MOUNTED workspace holding nothing. */
let nextLaunch = 0;
dom.window.electron = {
  pty: {
    list: async () => [],
    create: async () => ({ ok: true, session: sessions[nextLaunch++] }),
    closeSession: async () => true,
    archiveSession: async entry => ({ ...entry, closedAt: 1 }),
    closedSessions: async () => [],
    reopenSession: async () => null,
    focus: async () => {},
    onExit: channel('exit'),
    onIdentity: channel('identity'),
    onContext: channel('context'),
    onGoalVisual: channel('goal-visual'),
    onRecap: channel('recap'),
    onAttention: channel('attention'),
    onActivity: channel('activity'),
    onEngaged: channel('engaged'),
    onDelegation: channel('delegation'),
  },
  workspace: {
    load: async () => null,
    recovery: async () => ({ previousRunInterrupted: false }),
    save: async () => {},
  },
};

// ---- render the real hook --------------------------------------------------
const box = { current: null };
function Probe() {
  box.current = useWorkspaceState();
  return null;
}

function settle() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** Retained heap after the collector has actually had its say. */
function retainedBytes() {
  for (let i = 0; i < 6; i += 1) globalThis.gc();
  return process.memoryUsage().heapUsed;
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const reactRoot = createRoot(dom.window.document.getElementById('root'));
await React.act(async () => {
  reactRoot.render(React.createElement(Probe));
});
while (!box.current?.ready) {
  await React.act(async () => {
    await settle();
  });
}
// The baseline is a MOUNTED, ready workspace holding no Sessions, so every
// byte below this line belongs to Sessions rather than to React or jsdom.
const idle = retainedBytes();

// The operator keeps 8-10 Sessions concurrent and passes through roughly 100
// in a long run. Every one of them is opened through the real launch path and
// described the way main describes it.
await React.act(async () => {
  for (let i = 0; i < FLEET; i += 1) {
    await box.current.launch({ harness: 'claude', dir: REPO });
  }
});
await React.act(async () => {
  for (const session of sessions) {
    emit('context', {
      durableSessionId: session.durableSessionId,
      summary: `Ship the ${session.durableSessionId} piece of work`,
    });
    emit('goal-visual', {
      durableSessionId: session.durableSessionId,
      visual: {
        identityKey: `identity-${session.durableSessionId}`,
        revision: 1,
        state: 'ready',
        dataUrl: goalVisualDataUrl(session.durableSessionId.replace(/\W/g, '')),
      },
    });
    emit('identity', {
      id: session.id,
      durableSessionId: session.durableSessionId,
      harnessSessionId: `harness-${session.durableSessionId}`,
    });
    emit('engaged', { id: session.id });
    emit('activity', { id: session.id, working: true });
    emit('attention', {
      id: session.id,
      attention: { kind: 'question', since: 1 },
    });
    emit('delegation', {
      id: session.id,
      delegation: {
        children: [
          { id: `child-${session.id}`, agentType: 'claude', startedAt: 1 },
        ],
        ownTurn: true,
      },
    });
  }
});
const open = retainedBytes();

// Close every one of them, exactly as Command-W does.
const tabIds = box.current.projects.flatMap(project =>
  project.tabs.map(tab => tab.id)
);
const openGoals = Object.keys(box.current.summaries).length;
const openVisuals = Object.values(box.current.goalVisuals).filter(
  visual => typeof visual?.dataUrl === 'string'
).length;
if (tabIds.length !== FLEET || openVisuals !== FLEET) {
  console.error(
    `probe did not open the fleet: ${tabIds.length} tabs, ${openGoals} goals, ${openVisuals} visuals`
  );
  process.exit(1);
}
for (const tabId of tabIds) {
  await React.act(async () => {
    await box.current.closeTab(tabId, { force: true });
  });
}
await React.act(async () => {
  await settle();
});
const after = retainedBytes();

const surface = box.current;
const stillDescribed = sessions.filter(
  session => surface.summaries[session.durableSessionId] !== undefined
).length;
const stillPictured = sessions.filter(
  session => surface.goalVisuals[session.durableSessionId] !== undefined
).length;
const stillFlagged = sessions.filter(
  session =>
    surface.engaged[session.id] !== undefined ||
    surface.activity[session.id] !== undefined ||
    surface.attention[session.id] !== undefined ||
    surface.delegation[session.id] !== undefined
).length;

console.log(`sessions opened then closed   ${FLEET}`);
console.log(`goal visual per Session       ${mb(GOAL_VISUAL_BYTES)}`);
console.log('');
console.log(`heap idle                     ${mb(idle)}`);
console.log(`heap with ${String(FLEET).padEnd(4)} Sessions open   ${mb(open)}`);
console.log(`heap after all are closed     ${mb(after)}`);
console.log('');
console.log(`RETAINED AFTER CLOSE          ${mb(after - idle)}`);
console.log(`released by closing           ${mb(open - after)}`);
console.log(
  `forgotten Sessions the renderer can still describe: ${stillDescribed} goals, ${stillPictured} goal visuals, ${stillFlagged} PTY-scoped flags`
);
process.exit(0);
