import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COMMUNITY_DISTRIBUTION,
  parseDistributionContract,
} from '@exawatt/core/distribution';
import { DEFAULT_AGENT_PERMISSION_MODE } from '@/components/workspace/agent-sources';
import { OUTBOUND_CONTROLS } from '@/lib/hosted-features/contract';
import { MachineDisclosures } from './machine-disclosures';

afterEach(cleanup);

/**
 * Decision `0021` requires a plain account of what Exawatt does on the reader's
 * machine on every download surface, and 2026-08-18 recorded what happens when
 * nothing holds it: `0021` itself carried a privacy claim OS1.5 had made false
 * months earlier. These tests hold each load-bearing sentence to the code it
 * describes, so the claim fails here rather than in front of a stranger.
 */

const HOSTED = parseDistributionContract({
  ...COMMUNITY_DISTRIBUTION,
  // `account is required when an authenticated service or enrichment endpoint
  // is configured` (packages/core/src/distribution/contract.ts).
  account: {
    supabaseUrl: 'https://account.example.test',
    supabaseAnonKey: 'public-anon-key',
    recoveryOrigin: 'https://account.example.test',
  },
  enrichment: {
    ...COMMUNITY_DISTRIBUTION.enrichment,
    contextLabels: {
      url: 'https://services.example.test/context-labels',
      protocolVersion: 1,
    },
  },
  updates: { feedUrl: 'https://updates.example.test/macos/arm64' },
});

describe('the YOLO default is stated because it is the default', () => {
  it('matches the launcher default rather than a remembered one', () => {
    // If the launcher's default ever stops being unrestricted, this sentence
    // becomes a false safety claim in the worse direction.
    expect(DEFAULT_AGENT_PERMISSION_MODE).toBe('unrestricted');

    render(<MachineDisclosures distribution={COMMUNITY_DISTRIBUTION} />);
    expect(
      screen.getByText('Agents launch in YOLO mode by default')
    ).toBeVisible();
    expect(
      screen.getByText(/approvals and sandboxing off/)
    ).toBeInTheDocument();
    // The two escapes are named, because naming only the default would read as
    // a product with no choice in it.
    expect(screen.getByText(/Ask first/)).toBeInTheDocument();
    expect(screen.getByText(/Auto-review/)).toBeInTheDocument();
  });
});

describe('the transcript directories are the ones actually read', () => {
  it('names every harness root the code reads, not the two anyone remembers', () => {
    // `electron/main/pty/conversation-catalog.ts` and
    // `packages/core/src/consumption/{node-fs,adapters}.ts` read three roots.
    // Grok's was added after this disclosure was first written, which is
    // exactly how a trust claim goes quietly incomplete.
    render(<MachineDisclosures distribution={COMMUNITY_DISTRIBUTION} />);
    for (const root of [
      '~/.claude/projects',
      '~/.codex/sessions',
      '~/.grok/sessions',
    ]) {
      expect(screen.getByText(root)).toBeVisible();
    }
  });
});

describe('a distribution with hosted capabilities discloses them', () => {
  it('describes the excerpts, the project sync, and the switches', () => {
    render(<MachineDisclosures distribution={HOSTED} version="1.2.3" />);

    const leaves = screen.getByText(
      /Exawatt sends bounded excerpts to name and summarize your Sessions/
    );
    // OS2.2 corrected this paragraph: the operator's own typed prompts go, and
    // the recap sends the most and redacts nothing. Neither may quietly go
    // back to "your prompts are never uploaded".
    expect(leaves.textContent).toContain('the instruction you typed');
    expect(leaves.textContent).toContain('redacts nothing');
    // Named because `OUTBOUND_CONTROLS` says every one of these has a control.
    expect(leaves.textContent).toContain('Settings, under Privacy');
    expect(
      Object.values(OUTBOUND_CONTROLS).every(control => Boolean(control.label))
    ).toBe(true);
    expect(screen.getByText('Updates wait for you')).toBeVisible();
    expect(screen.getByText(/This is version 1\.2\.3\./)).toBeInTheDocument();
  });
});

describe('a community distribution says what it does not do, and what it still does', () => {
  it('claims nothing reaches Exawatt, and does not claim silence', () => {
    render(<MachineDisclosures distribution={COMMUNITY_DISTRIBUTION} />);

    const leaves = screen.getByText(/declares no Exawatt services/);
    expect(leaves.textContent).toContain('no analytics');

    // The recap is the one outbound feature a community build keeps, because
    // `OUTBOUND_CONTROLS.reentryRecap` requires no distribution capability and
    // `context-summarizer.ts` runs the operator's own `claude` CLI. A page
    // claiming a community build makes no network call at all would be false.
    expect(OUTBOUND_CONTROLS.reentryRecap.requiresDistributionCapability).toBe(
      null
    );
    expect(leaves.textContent).toContain('claude');
    expect(leaves.textContent).toContain('Settings, under Privacy');
  });

  it('does not offer an update channel it has no feed for', () => {
    expect(COMMUNITY_DISTRIBUTION.updates).toBe(null);

    render(<MachineDisclosures distribution={COMMUNITY_DISTRIBUTION} />);
    expect(screen.queryByText('Updates wait for you')).toBeNull();
    expect(screen.getByText('There are no updates to wait for')).toBeVisible();
  });

  it('makes no automatic own-account read, because none is granted', () => {
    // BUG-060's boundary: the automatic Claude plan read needs
    // `ownAccount.claudePlanUsage`, which community never declares. If that
    // ever changes, the community disclosure above stops being complete.
    expect(COMMUNITY_DISTRIBUTION.ownAccount).toBe(null);
    expect(
      OUTBOUND_CONTROLS.claudePlanWindows.requiresDistributionCapability
    ).toBe('ownAccount.claudePlanUsage');
  });
});
