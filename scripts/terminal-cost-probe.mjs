/**
 * Measurement probe for BUG-012 (ENG-016) — a diagnostic, NOT a gate.
 *
 * Two independent hypotheses come out of reading the code, and a perf pass
 * aimed at the wrong one is how this becomes permanent:
 *
 *   1. Replay cost. `terminal-pane` writes the whole saved buffer into a
 *      fresh terminal, and `ScrollbackStore` retains up to 4MB. If parsing
 *      that blocks the renderer, opening a frozen tab beachballs.
 *   2. Context exhaustion. Every pane stays mounted ("ALL tabs stay
 *      mounted", workspace-client) with a WebGL renderer, and browsers cap
 *      live WebGL contexts — the operator reported 16 paused Agents.
 *
 * Both are measured against the INSTALLED xterm, on a local page, so the
 * numbers describe the library we actually ship rather than a synthetic.
 *
 * Caveat recorded with the results: headless Chromium renders WebGL through
 * SwiftShader, so the context CAP is representative but not identical to the
 * operator's GPU. The replay numbers are CPU parsing and carry over.
 *
 * Run: node scripts/terminal-cost-probe.mjs
 */
import { chromium } from 'playwright-core';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveQaBrowserLaunchOptions } from './lib/qa-browser.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const xtermJs = join(root, 'node_modules/@xterm/xterm/lib/xterm.js');
const xtermCss = join(root, 'node_modules/@xterm/xterm/css/xterm.css');
const webglJs = join(
  root,
  'node_modules/@xterm/addon-webgl/lib/addon-webgl.js'
);

const dir = mkdtempSync(join(tmpdir(), 'exawatt-term-probe-'));
const pagePath = join(dir, 'probe.html');
writeFileSync(
  pagePath,
  `<!doctype html><html><head><link rel="stylesheet" href="file://${xtermCss}"></head>
   <body style="margin:0;background:#000"><div id="host"></div></body></html>`
);

const browser = await chromium.launch({
  ...(await resolveQaBrowserLaunchOptions(chromium)),
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(`file://${pagePath}`);
await page.addScriptTag({ path: xtermJs });
await page.addScriptTag({ path: webglJs });

/** Output shaped like a real harness turn: mostly text, with the cursor
 *  moves and carriage returns a TUI actually emits. */
const REPLAY = await page.evaluate(() => {
  const make = bytes => {
    const line =
      'ENG-016 D52 the option menu fits its window, and both rotted gates run ';
    let out = '';
    let i = 0;
    while (out.length < bytes) {
      i += 1;
      // a spinner frame redrawn in place, then a committed line — the shape
      // that makes width-mismatched replay interleave
      out += `\r\x1b[K\x1b[36m⠋\x1b[0m working ${i}`;
      if (i % 4 === 0) out += `\r\x1b[K${line}${i}\r\n`;
    }
    return out.slice(0, bytes);
  };

  const host = document.getElementById('host');
  const measure = bytes => {
    const el = document.createElement('div');
    el.style.width = '1100px';
    el.style.height = '600px';
    host.append(el);
    const term = new window.Terminal({ scrollback: 50_000 });
    term.open(el);
    const payload = make(bytes);
    const started = performance.now();
    term.write(payload);
    const writeCall = performance.now() - started;
    return new Promise(resolve => {
      term.write('', () => {
        const parsed = performance.now() - started;
        term.dispose();
        el.remove();
        resolve({
          bytes,
          writeCallMs: Math.round(writeCall),
          parsedMs: Math.round(parsed),
        });
      });
    });
  };

  return (async () => {
    const out = [];
    for (const bytes of [64_000, 256_000, 1_000_000, 4_000_000]) {
      out.push(await measure(bytes));
    }
    return out;
  })();
});

/** How many live WebGL-backed terminals before the oldest lose context. */
const CONTEXTS = await page.evaluate(() => {
  const host = document.getElementById('host');
  const terms = [];
  let lost = 0;
  for (let i = 0; i < 24; i += 1) {
    const el = document.createElement('div');
    el.style.width = '300px';
    el.style.height = '160px';
    host.append(el);
    const term = new window.Terminal();
    term.open(el);
    try {
      const addon = new window.WebglAddon.WebglAddon();
      addon.onContextLoss(() => {
        lost += 1;
      });
      term.loadAddon(addon);
      term.write(`pane ${i}\r\n`);
      terms.push({ term, el, addon });
    } catch {
      lost += 1;
      terms.push({ term, el, addon: null });
    }
  }
  return new Promise(resolve =>
    setTimeout(() => {
      const live = terms.filter(t => t.addon !== null).length;
      for (const t of terms) {
        t.term.dispose();
        t.el.remove();
      }
      resolve({ attempted: terms.length, addonsCreated: live, contextLost: lost });
    }, 1200)
  );
});

console.log(
  JSON.stringify(
    { replay: REPLAY, webgl: CONTEXTS, note: 'headless SwiftShader' },
    null,
    2
  )
);
await browser.close();
