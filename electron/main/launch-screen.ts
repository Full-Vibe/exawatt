import { THEME_BOOTSTRAP_REGISTRY } from './generated-theme-bootstrap';
import type { NativeAppearanceBootstrap } from './appearance';

export interface StartupStage {
  progress: number;
  label: string;
  detail: string;
  failed?: boolean;
}

export type LaunchAppearance = NativeAppearanceBootstrap;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    character =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!
  );
}

const html = (appearance: LaunchAppearance, productName: string) => {
  const escapedProductName = escapeHtml(productName);
  const escapedDisplayName = escapeHtml(productName.toLocaleUpperCase('en-US'));
  const startupFallback = JSON.stringify(`Starting ${productName}`).replace(
    /</g,
    '\\u003c'
  );
  return String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
    />
    <meta name="color-scheme" content="${appearance.colorScheme}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedProductName} — Starting</title>
    <style>
      :root {
        color-scheme: ${appearance.colorScheme};
        --ink: ${appearance.foreground};
        --muted: ${appearance.muted};
        --faint: ${appearance.faint};
        --surface: ${appearance.background};
        --signal: ${appearance.signal};
        --danger: ${appearance.danger};
        --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
      }

      * { box-sizing: border-box; }

      html, body { width: 100%; height: 100%; margin: 0; }

      body {
        overflow: hidden;
        color: var(--ink);
        background:
          linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px),
          var(--surface);
        background-size: 48px 48px;
        font-family: "Avenir Next", "Helvetica Neue", sans-serif;
        -webkit-font-smoothing: antialiased;
        -webkit-app-region: drag;
      }

      .shell {
        position: relative;
        display: grid;
        grid-template-rows: auto 1fr auto;
        width: 100%;
        height: 100%;
        padding: 30px 34px 34px;
        isolation: isolate;
      }

      .shell::before {
        position: absolute;
        inset: 0;
        z-index: -1;
        content: "";
        background: radial-gradient(circle at 50% 48%, rgba(215, 255, 67, 0.055), transparent 34%);
      }

      .masthead,
      .readout {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }

      .masthead { padding-left: 64px; color: var(--muted); }
      .masthead strong { color: var(--ink); font-weight: 700; }

      .core {
        align-self: center;
        justify-self: center;
        display: grid;
        justify-items: center;
        gap: 24px;
        transform: translateY(-2vh);
      }

      .mark {
        display: flex;
        align-items: flex-end;
        gap: 5px;
        height: 40px;
      }

      .mark span {
        width: 4px;
        height: 100%;
        background: var(--signal);
        transform: scaleY(0.18);
        transform-origin: 50% 100%;
        animation: energize 1.15s var(--ease-out) infinite alternate;
      }

      .mark span:nth-child(2) { animation-delay: -0.32s; }
      .mark span:nth-child(3) { animation-delay: -0.61s; }
      .mark span:nth-child(4) { animation-delay: -0.18s; }
      .mark span:nth-child(5) { animation-delay: -0.74s; }

      @keyframes energize {
        from { transform: scaleY(0.18); opacity: 0.42; }
        to { transform: scaleY(1); opacity: 1; }
      }

      .identity { display: grid; justify-items: center; gap: 5px; }

      h1 {
        margin: 0;
        font-family: "Avenir Next Condensed", "Avenir Next", sans-serif;
        font-size: clamp(54px, 7vw, 88px);
        font-weight: 700;
        letter-spacing: -0.045em;
        line-height: 0.9;
      }

      .identity p {
        margin: 0;
        color: var(--muted);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.42em;
        text-transform: uppercase;
      }

      .readout {
        display: grid;
        grid-template-columns: minmax(190px, 0.7fr) minmax(260px, 1.6fr) auto;
        gap: 28px;
        align-items: end;
      }

      .status { display: grid; gap: 7px; min-width: 0; }
      .status-label { color: var(--ink); }
      .status-detail {
        overflow: hidden;
        color: var(--muted);
        font-weight: 500;
        letter-spacing: 0.08em;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-transform: none;
      }

      .track {
        position: relative;
        height: 1px;
        margin-bottom: 7px;
        overflow: hidden;
        background: var(--faint);
      }

      .progress {
        position: absolute;
        inset: 0;
        background: var(--signal);
        transform: scaleX(0.08);
        transform-origin: 0 50%;
        transition: transform 280ms var(--ease-out), background-color 160ms linear;
        will-change: transform;
      }

      .percent {
        min-width: 4ch;
        color: var(--signal);
        font-variant-numeric: tabular-nums;
        text-align: right;
      }

      body[data-failed="true"] .progress { background: var(--danger); }
      body[data-failed="true"] .percent { color: var(--danger); }
      body[data-failed="true"] .mark span { background: var(--danger); animation: none; transform: scaleY(0.34); }

      @media (prefers-reduced-motion: reduce) {
        .mark span { animation: none; transform: scaleY(0.66); opacity: 0.8; }
        .progress { transition: none; }
      }

      @media (max-width: 720px) {
        .shell { padding: 26px 24px 28px; }
        .readout { grid-template-columns: 1fr auto; }
        .status:first-child { display: none; }
      }
    </style>
  </head>
  <body data-exawatt-launch data-failed="false">
    <main class="shell" role="status" aria-live="polite" aria-atomic="true">
      <header class="masthead">
        <span><strong>${escapedProductName}</strong> / Local command layer</span>
        <span>Boot sequence 01</span>
      </header>

      <section class="core" aria-hidden="true">
        <div class="mark"><span></span><span></span><span></span><span></span><span></span></div>
        <div class="identity">
          <h1>${escapedDisplayName}</h1>
          <p>Agent command surface</p>
        </div>
      </section>

      <footer class="readout">
        <div class="status">
          <span class="status-label">Source / This machine</span>
          <span class="status-detail">Local privileges stay local</span>
        </div>
        <div class="status">
          <span class="status-label" id="startup-label">Opening command surface</span>
          <span class="status-detail" id="startup-detail">Preparing the local agent interface</span>
          <div class="track" aria-hidden="true"><div class="progress" id="startup-progress"></div></div>
        </div>
        <span class="percent" id="startup-percent">08</span>
      </footer>
    </main>
    <script>
      (() => {
        const label = document.getElementById('startup-label');
        const detail = document.getElementById('startup-detail');
        const progress = document.getElementById('startup-progress');
        const percent = document.getElementById('startup-percent');
        window.exawattSetStartupStage = stage => {
          const value = Math.max(0, Math.min(1, Number(stage.progress) || 0));
          label.textContent = String(stage.label || ${startupFallback});
          detail.textContent = String(stage.detail || '');
          progress.style.transform = 'scaleX(' + value + ')';
          percent.textContent = String(Math.round(value * 100)).padStart(2, '0');
          document.body.dataset.failed = stage.failed ? 'true' : 'false';
        };
      })();
    </script>
  </body>
</html>`;
};

export function launchScreenUrl(
  appearance: LaunchAppearance = THEME_BOOTSTRAP_REGISTRY[
    'exawatt-classic-dark'
  ],
  productName = 'Exawatt Community'
): string {
  return `data:text/html;charset=UTF-8,${encodeURIComponent(
    html(appearance, productName)
  )}`;
}
