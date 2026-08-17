/**
 * Measurement probe for BUG-025 (ENG-016) — a diagnostic, NOT a gate. Sibling
 * of `scripts/transcript-replay-probe.mjs`.
 *
 * The question: after the operator closes, archives, or reaps a Session, how
 * many bytes does the Electron MAIN process still hold for it?
 *
 * Main has two identity spaces. `PtySessionManager`'s `exit` event belongs to
 * the PTY one, and until BUG-025 it was the only lifecycle hook the context
 * summarizer had — so every store keyed by the DURABLE Session id (labels,
 * label sources, instruction evidence, retry state, goal visuals) had an add
 * site and no delete site. A closed Session's goal-visual JPEG stayed resident
 * for the rest of the process lifetime, unreachable from any surface,
 * surviving the deletion of its own on-disk record.
 *
 *   node --expose-gc scripts/session-lifecycle-leak-probe.mjs
 *   node --expose-gc scripts/session-lifecycle-leak-probe.mjs --fleet 100
 *
 * Requires `pnpm electron:compile` first: the probe drives the COMPILED
 * summarizer so the numbers describe shipped code, not a re-implementation.
 * To measure the pre-fix side, compile a tree without the fix and run the same
 * command — the probe always announces `session-forgotten`, and a build that
 * does not subscribe simply ignores it, which is exactly the old behaviour.
 *
 * The manager is stubbed to the small surface the summarizer reads (`list`,
 * `bufferCursor`, `bufferSince`) because `node-pty` is built for Electron's
 * ABI and cannot load under plain Node. The subject is retained memory after a
 * Session is forgotten, not the terminal.
 */
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

if (typeof globalThis.gc !== 'function') {
  console.error(
    'Run with --expose-gc: node --expose-gc scripts/session-lifecycle-leak-probe.mjs'
  );
  process.exit(1);
}

const root = fileURLToPath(new URL('..', import.meta.url));
const compiled = path.join(
  root,
  'dist-electron/main/pty/context-summarizer.js'
);
if (!fs.existsSync(compiled)) {
  console.error(`Missing ${compiled}. Run: pnpm electron:compile`);
  process.exit(1);
}
const { ContextSummarizer } = await import(compiled);

const args = process.argv.slice(2);
const FLEET = Number(
  args.includes('--fleet') ? args[args.indexOf('--fleet') + 1] : 100
);

/**
 * The operator's real goal visual is a ~265 KB JPEG carried as a base64 data
 * URL. Its bytes are what dominate a forgotten Session's residue.
 */
const GOAL_VISUAL_BYTES = 265 * 1024;
function goalVisualDataUrl(seed) {
  const prefix = `data:image/jpeg;base64,${seed}`;
  return (
    prefix + 'YWJj'.repeat(Math.ceil((GOAL_VISUAL_BYTES - prefix.length) / 4))
  );
}

class StubManager extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
    this.sessions = [];
  }
  list() {
    return this.sessions;
  }
  bufferCursor() {
    return 0;
  }
  bufferSince() {
    return { text: '', truncated: false };
  }
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

const manager = new StubManager();
const summarizer = new ContextSummarizer({
  generateLabel: async evidence => ({
    label: `Ship ${evidence.sessionKey}`,
    relationship: 'new_context',
    confidence: 1,
  }),
  generateGoalVisual: async request => ({
    identityKey: `identity-${request.label}`,
    dataUrl: goalVisualDataUrl(request.label.replace(/\W/g, '')),
  }),
});
summarizer.attach(manager);
summarizer.setAccessToken('probe-token');

const idle = retainedBytes();

// Open a realistic run: the operator keeps 8–10 Sessions concurrent and passes
// through roughly 100 in a long one.
for (let i = 0; i < FLEET; i += 1) {
  const durableSessionId = `session-${i}`;
  manager.sessions.push({
    id: `pty-${i}`,
    durableSessionId,
    harness: 'codex',
    exited: false,
    projectDir: '/repo/exawatt',
    projectName: 'Exawatt',
  });
  summarizer.seedFromTask(durableSessionId, `Ship the ${i}th piece of work`);
}
while (
  manager.sessions.some(
    session =>
      summarizer.getGoalVisual(session.durableSessionId)?.state !== 'ready'
  )
) {
  await settle();
}
const open = retainedBytes();

// Close every one of them: `pty:close-session` / `pty:archive-session` /
// the 14-day ledger reap all converge on the same boundary.
const closed = manager.sessions.splice(0, manager.sessions.length);
for (const session of closed) {
  manager.emit('session-forgotten', session.durableSessionId);
}
await settle();
const after = retainedBytes();

const stillLabelled = closed.filter(
  session => summarizer.getSummary(session.durableSessionId) !== null
).length;
const stillPictured = closed.filter(
  session => summarizer.getGoalVisual(session.durableSessionId) !== null
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
  `forgotten Sessions main can still describe: ${stillLabelled} labels, ${stillPictured} goal visuals`
);
