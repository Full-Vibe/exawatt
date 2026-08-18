import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  STATUS_LIGHT_META,
  STATUS_LIGHT_STATES,
  statusLightWord,
} from '@/components/status-light';
import ConnectedSourceBenchPage from './page';

afterEach(cleanup);

/** D40 status paint, in both the token and the Classic-hex form. */
const STATUS_COLOUR_TOKENS = [
  '--exa-status-off',
  '--exa-status-active',
  '--exa-status-result',
  '--exa-status-needs-you',
  '--exa-status-fault',
  ...Object.values(STATUS_LIGHT_META).flatMap(meta => [
    meta.color.toLowerCase(),
    meta.sourceColor.toLowerCase(),
  ]),
];

function renderStudy() {
  return render(<ConnectedSourceBenchPage />);
}

function deck(): HTMLElement {
  const node = document.querySelector('[data-connected-source-deck]');
  expect(node).not.toBeNull();
  return node as HTMLElement;
}

function ariaLabels(): string[] {
  return Array.from(document.querySelectorAll('[aria-label]')).map(
    node => node.getAttribute('aria-label') ?? ''
  );
}

describe('Connected Agents study', () => {
  it('renders every connection state with its own treatment', () => {
    renderStudy();

    const states = new Set(
      Array.from(document.querySelectorAll('[data-connection]')).map(node =>
        node.getAttribute('data-connection')
      )
    );
    expect(states).toEqual(
      new Set(['live', 'reconnecting', 'stale', 'unavailable'])
    );

    // The redundant glyph differs per state, so the chips separate with no
    // colour, no hover, and no motion involved.
    const glyphs = ['live', 'reconnecting', 'stale', 'unavailable'].map(
      state =>
        document
          .querySelector(`[data-connection-chip="${state}"] svg`)
          ?.outerHTML.replace(/currentColor/g, '') ?? ''
    );
    expect(glyphs.every(markup => markup.length > 0)).toBe(true);
    expect(new Set(glyphs).size).toBe(4);
  });

  it('names every unavailable failure class', () => {
    renderStudy();

    for (const label of [
      'Server unreachable',
      'Sign-in rejected',
      'Gateway not responding',
      'Approval needed',
      'Version not supported',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('keeps a stale or unreachable Agent on its last known work', () => {
    renderStudy();

    const unreachable = document.querySelector(
      '[data-connected-agent="juno"]'
    ) as HTMLElement;
    expect(unreachable.getAttribute('data-connection')).toBe('unavailable');
    expect(within(unreachable).getByText('Last known')).toBeInTheDocument();
    expect(within(unreachable).getByText('Working')).toBeInTheDocument();
    expect(
      unreachable.querySelector('[data-work-line][data-current="false"]')
    ).not.toBeNull();

    const reconnecting = document.querySelector(
      '[data-connected-agent="vale"]'
    ) as HTMLElement;
    expect(within(reconnecting).getByText('Reconnecting')).toBeInTheDocument();
    expect(within(reconnecting).getByText('Last known')).toBeInTheDocument();

    // Reconnecting, stale, and the five unavailable cards.
    expect(document.querySelectorAll('[data-last-known]')).toHaveLength(7);
    expect(screen.getByText('Last seen 22 minutes ago')).toBeInTheDocument();
  });

  it('reads the same with colour switched off', () => {
    renderStudy();

    expect(deck().getAttribute('data-colour')).toBe('on');
    const noColour = screen.getByRole('button', { name: 'No colour' });
    fireEvent.click(noColour);
    expect(deck().getAttribute('data-colour')).toBe('off');
    expect(noColour).toHaveAttribute('aria-pressed', 'true');

    // Every connection and work state is still carried by words alone.
    for (const label of [
      'Reconnecting',
      'Last seen 22 minutes ago',
      'Server unreachable',
      'Sign-in rejected',
      'Gateway not responding',
      'Approval needed',
      'Version not supported',
      'Last known',
      'Working',
      'Needs you',
      'Result ready',
      'Error',
      'Idle',
      'Local',
      'Remote',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('Live').length).toBeGreaterThan(0);
  });

  it('projects work state identically for a local Agent', () => {
    renderStudy();

    const local = document.querySelector(
      '[data-connected-agent="rowan"]'
    ) as HTMLElement;
    expect(
      local.querySelector('[data-status-light="needs-you"]')
    ).not.toBeNull();
    expect(local.querySelector('[data-placement="local"]')).not.toBeNull();
    expect(within(local).getByText('Local')).toBeInTheDocument();
  });

  it('opens an Agent with no conversation on Automations', () => {
    renderStudy();

    const panel = document.querySelector(
      '[data-agent-panel="automation-only"]'
    ) as HTMLElement;
    const sections = Array.from(
      panel.querySelectorAll('[data-panel-section]')
    ).map(node => node.getAttribute('data-panel-section'));
    expect(sections[0]).toBe('Automations');
    expect(within(panel).getByText('Inbox digest')).toBeInTheDocument();

    // No composer, no reply, no conversation control of any kind.
    expect(within(panel).queryAllByRole('button')).toHaveLength(0);
    expect(within(panel).queryAllByRole('textbox')).toHaveLength(0);
    expect(
      panel.querySelector('[data-conversation-state="unavailable"]')
    ).not.toBeNull();
  });

  it('shows drifted identity beside the mapping it holds', () => {
    renderStudy();

    const panel = document.querySelector(
      '[data-agent-panel="identity-drift"]'
    ) as HTMLElement;
    expect(
      panel.querySelector('[data-identity-side="Mapped identity"]')
    ).not.toBeNull();
    expect(
      panel.querySelector('[data-identity-side="Now observed"]')
    ).not.toBeNull();
    expect(within(panel).getByText('Agent id 7c41f0')).toBeInTheDocument();
    expect(within(panel).getByText('Agent id b0d2e9')).toBeInTheDocument();
    expect(
      within(panel).getByRole('button', { name: 'Remap' })
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole('button', { name: 'Detach' })
    ).toBeInTheDocument();
  });

  it('never paints placement with a D40 status colour', () => {
    renderStudy();

    const tags = Array.from(document.querySelectorAll('[data-placement]'));
    expect(tags.length).toBeGreaterThan(0);

    for (const tag of tags) {
      const nodes = [tag, ...Array.from(tag.querySelectorAll('*'))];
      for (const node of nodes) {
        const style = (node.getAttribute('style') ?? '').toLowerCase();
        for (const token of STATUS_COLOUR_TOKENS) {
          expect(style).not.toContain(token);
        }
        expect(node.hasAttribute('data-status-light')).toBe(false);
      }
      // Placement rides the HUD dim-text role, the quiet-metadata answer.
      expect(tag.getAttribute('style')).toContain('exa-hud-text-dim');
    }
  });

  it('never claims remote work halted, and writes no em dash', () => {
    renderStudy();

    const text = `${document.body.textContent ?? ''} ${ariaLabels().join(' ')}`;
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/\b(stopped|paused|lost)\b/i);
  });

  it('reads its work words from the owner production Team tiles read', () => {
    renderStudy();

    // ENG-033 H2: production adopted this study's word. Both sides now go
    // through `statusLightWord`, so the study cannot quietly re-word a state
    // that the shipped roster still spells the old way.
    for (const state of STATUS_LIGHT_STATES) {
      const word = statusLightWord(state);
      expect(word).toBe(STATUS_LIGHT_META[state].label);
      expect(word).not.toContain('—');
    }
    for (const word of ['Working', 'Needs you', 'Result ready', 'Error']) {
      expect(screen.getAllByText(word).length).toBeGreaterThan(0);
    }
  });
});
