import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMUNITY_DISTRIBUTION,
  type DistributionContractV2,
} from '@exawatt/core/distribution';
import { readAnalyticsOptOut } from '@/lib/analytics';
import {
  HOSTED_FEATURE_IDS,
  OUTBOUND_CONTROLS,
  type OutboundControlId,
} from '@/lib/hosted-features/contract';
import { GoalVisualPreferenceProvider } from '@/components/goal-visuals/goal-visual-preference-provider';
import type { ExawattSettings } from '@/types/electron';
import { PrivacySettings } from './privacy-settings';

/**
 * BUG-060: the Claude plan read is the first control on this surface gated by
 * a distribution capability, so the surface now has two states per row. These
 * tests run against a distribution that DECLARES the capability unless they
 * say otherwise; the community case has its own test at the bottom.
 */
const { distributionState } = vi.hoisted(() => ({
  distributionState: { current: null as unknown },
}));

vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => distributionState.current,
  resolvedDistributionDigest: () => null,
  resetResolvedDistributionForTest: () => undefined,
}));

const SIGNED_DISTRIBUTION = {
  ...COMMUNITY_DISTRIBUTION,
  ownAccount: { claudePlanUsage: 'stable-signed' },
} satisfies DistributionContractV2;

/** A named distribution, which is the signal that it serves its own legal pages. */
const BRANDED_DISTRIBUTION = {
  ...COMMUNITY_DISTRIBUTION,
  brand: {
    appId: 'ai.exawatt.desktop',
    productName: 'Exawatt',
    protocolScheme: 'exawatt',
    iconPath: 'electron/resources/icon.icns',
    updateChannel: 'stable',
  },
} satisfies DistributionContractV2;

const { goalVisualSource } = vi.hoisted(() => {
  const listeners = new Set<(enabled: boolean) => void>();
  let enabled = true;
  return {
    goalVisualSource: {
      kind: 'web' as const,
      save: vi.fn(async (next: boolean) => {
        enabled = next;
        for (const listener of listeners) listener(next);
        return next;
      }),
      load: async () => enabled,
      subscribe: (handler: (next: boolean) => void) => {
        listeners.add(handler);
        return () => listeners.delete(handler);
      },
      reset: () => {
        enabled = true;
        listeners.clear();
      },
    },
  };
});

vi.mock('@/lib/goal-visuals/preference-source', () => ({
  createGoalVisualPreferenceSource: () => goalVisualSource,
}));

type SettingsBridge = {
  get: ReturnType<typeof vi.fn>;
  onChanged: ReturnType<typeof vi.fn>;
  setHostedConversationSummaries: ReturnType<typeof vi.fn>;
  setHostedContextLabels: ReturnType<typeof vi.fn>;
  setReentryRecap: ReturnType<typeof vi.fn>;
  setClaudePlanWindows: ReturnType<typeof vi.fn>;
  setOperatorAutoPublish: ReturnType<typeof vi.fn>;
};

/** The desktop settings store, as this surface sees it: a local read, a live
 *  change stream, and one setter per hosted feature. */
function installSettingsBridge(
  initial: ExawattSettings = {},
  options: { pendingRead?: boolean } = {}
): SettingsBridge {
  let store: ExawattSettings = initial;
  const listeners = new Set<(settings: ExawattSettings) => void>();
  const publish = () => {
    for (const listener of listeners) listener(store);
  };
  const write = (next: ExawattSettings) => {
    store = next;
    publish();
    return store;
  };

  const bridge: SettingsBridge = {
    get: vi.fn(() =>
      options.pendingRead
        ? new Promise<ExawattSettings>(() => undefined)
        : Promise.resolve(store)
    ),
    onChanged: vi.fn((handler: (settings: ExawattSettings) => void) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    }),
    setHostedConversationSummaries: vi.fn(async (enabled: boolean) =>
      write({ ...store, conversationSummaries: { hosted: enabled } })
    ),
    setHostedContextLabels: vi.fn(async (enabled: boolean) =>
      write({ ...store, contextLabels: { hosted: enabled } })
    ),
    setReentryRecap: vi.fn(async (enabled: boolean) =>
      write({ ...store, reentryRecap: { enabled } })
    ),
    setClaudePlanWindows: vi.fn(async (enabled: boolean) =>
      write({ ...store, claudePlanWindows: { enabled } })
    ),
    setOperatorAutoPublish: vi.fn(async (enabled: boolean) =>
      write({ ...store, operatorProfile: { autoPublish: enabled } })
    ),
  };

  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { isElectron: true, platform: 'darwin', settings: bridge },
  });
  return bridge;
}

async function renderPrivacy() {
  const view = render(
    <GoalVisualPreferenceProvider>
      <PrivacySettings />
    </GoalVisualPreferenceProvider>
  );
  await act(async () => undefined);
  return view;
}

function rowFor(id: OutboundControlId): HTMLElement {
  const row = document.querySelector<HTMLElement>(
    `[data-outbound-control="${id}"]`
  );
  if (!row) throw new Error(`No row rendered for ${id}`);
  return row;
}

function groupFor(attribute: string): HTMLElement {
  const group = document.querySelector<HTMLElement>(`[${attribute}]`);
  if (!group) throw new Error(`No group rendered for ${attribute}`);
  return group;
}

describe('Settings → Privacy', () => {
  beforeEach(() => {
    distributionState.current = SIGNED_DISTRIBUTION;
    window.localStorage.clear();
    goalVisualSource.reset();
    goalVisualSource.save.mockClear();
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, 'electron');
  });

  it('renders every outbound control with its full disclosure', async () => {
    installSettingsBridge();
    await renderPrivacy();

    for (const control of Object.values(OUTBOUND_CONTROLS)) {
      const row = within(rowFor(control.id));
      expect(row.getByRole('switch', { name: control.label })).toBeVisible();
      expect(row.getByText(control.purpose)).toBeVisible();
      expect(row.getByText(control.sends)).toBeVisible();
      expect(row.getByText(control.destination)).toBeVisible();
      expect(row.getByText(control.cost)).toBeVisible();
    }
  });

  it('shows every control at its disclosed default before any settings load', async () => {
    installSettingsBridge({}, { pendingRead: true });
    await renderPrivacy();

    // Everything defaults on (decision `0031`) except public sharing, which
    // defaults OFF (decision `0029`) — the contract states each honestly.
    expect(OUTBOUND_CONTROLS.operatorProfile.defaultEnabled).toBe(false);
    for (const control of Object.values(OUTBOUND_CONTROLS)) {
      expect(
        within(rowFor(control.id)).getByRole('switch', { name: control.label })
      ).toHaveAttribute('aria-checked', String(control.defaultEnabled));
    }
  });

  it('persists a hosted feature switch and reflects the saved state', async () => {
    const bridge = installSettingsBridge();
    await renderPrivacy();

    const summaries = within(rowFor('conversationSummaries')).getByRole(
      'switch',
      { name: OUTBOUND_CONTROLS.conversationSummaries.label }
    );
    fireEvent.click(summaries);

    await waitFor(() =>
      expect(bridge.setHostedConversationSummaries).toHaveBeenCalledWith(false)
    );
    await waitFor(() =>
      expect(summaries).toHaveAttribute('aria-checked', 'false')
    );

    fireEvent.click(summaries);
    await waitFor(() =>
      expect(bridge.setHostedConversationSummaries).toHaveBeenCalledWith(true)
    );
    await waitFor(() =>
      expect(summaries).toHaveAttribute('aria-checked', 'true')
    );
  });

  it('gives context labels their own switch, the one control that had none', async () => {
    const bridge = installSettingsBridge();
    await renderPrivacy();

    const labels = within(rowFor('contextLabels')).getByRole('switch', {
      name: OUTBOUND_CONTROLS.contextLabels.label,
    });
    fireEvent.click(labels);

    await waitFor(() =>
      expect(bridge.setHostedContextLabels).toHaveBeenCalledWith(false)
    );
    await waitFor(() =>
      expect(labels).toHaveAttribute('aria-checked', 'false')
    );
  });

  it('reflects a hosted preference changed elsewhere', async () => {
    installSettingsBridge({ conversationSummaries: { hosted: false } });
    await renderPrivacy();

    expect(
      within(rowFor('conversationSummaries')).getByRole('switch', {
        name: OUTBOUND_CONTROLS.conversationSummaries.label,
      })
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('drives goal visuals through the same preference the exposé toggle uses', async () => {
    installSettingsBridge();
    await renderPrivacy();

    const visuals = within(rowFor('goalVisuals')).getByRole('switch', {
      name: OUTBOUND_CONTROLS.goalVisuals.label,
    });
    fireEvent.click(visuals);

    await waitFor(() =>
      expect(goalVisualSource.save).toHaveBeenCalledWith(false)
    );
    await waitFor(() =>
      expect(visuals).toHaveAttribute('aria-checked', 'false')
    );
  });

  // ENG-030 OS1.5: the recap is a THIRD category — outbound under the
  // operator's own Claude Code sign-in, hosted by nobody — so it gets its own
  // group rather than borrowing "Hosted features" or "Analytics".
  it('gives the since-you-left recap its own switch in its own group', async () => {
    const bridge = installSettingsBridge();
    await renderPrivacy();

    const ownAccounts = groupFor('data-own-account-settings');
    const recap = within(ownAccounts).getByRole('switch', {
      name: OUTBOUND_CONTROLS.reentryRecap.label,
    });
    expect(recap).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(recap);
    await waitFor(() =>
      expect(bridge.setReentryRecap).toHaveBeenCalledWith(false)
    );
    await waitFor(() => expect(recap).toHaveAttribute('aria-checked', 'false'));

    fireEvent.click(recap);
    await waitFor(() =>
      expect(bridge.setReentryRecap).toHaveBeenCalledWith(true)
    );
    await waitFor(() => expect(recap).toHaveAttribute('aria-checked', 'true'));
  });

  // ENG-038: the Claude plan-window read — same own-account group as the
  // recap (the operator's own sign-in, never Exawatt), default on because
  // the operator pulled the feature; off must persist through its own setter.
  it('gives the Claude plan-window read its own default-on switch beside the recap', async () => {
    const bridge = installSettingsBridge();
    await renderPrivacy();

    const ownAccounts = groupFor('data-own-account-settings');
    const plan = within(ownAccounts).getByRole('switch', {
      name: OUTBOUND_CONTROLS.claudePlanWindows.label,
    });
    expect(plan).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(plan);
    await waitFor(() =>
      expect(bridge.setClaudePlanWindows).toHaveBeenCalledWith(false)
    );
    await waitFor(() => expect(plan).toHaveAttribute('aria-checked', 'false'));
    expect(bridge.setReentryRecap).not.toHaveBeenCalled();
  });

  // BUG-060. A community build has no stable signed identity to make this
  // request under, so the read never happens there. Rendering a live switch
  // for it would be a control that changes nothing — the shape incident
  // `0017` cost eighteen hours, one level down.
  it('states plainly that a community build does not carry the plan read', async () => {
    distributionState.current = COMMUNITY_DISTRIBUTION;
    installSettingsBridge();
    await renderPrivacy();

    const ownAccounts = groupFor('data-own-account-settings');
    const plan = rowFor('claudePlanWindows');
    expect(ownAccounts.contains(plan)).toBe(true);
    expect(plan).toHaveAttribute('data-outbound-state', 'unconfigured');
    expect(
      within(ownAccounts).queryByRole('switch', {
        name: OUTBOUND_CONTROLS.claudePlanWindows.label,
      })
    ).toBeNull();
    expect(
      within(rowFor('claudePlanWindows')).getByText(
        'Not configured in this build'
      )
    ).toBeVisible();

    // The disclosure survives: this surface is the manifest of what the app
    // would send, and an absent capability does not erase the sentence.
    expect(
      within(rowFor('claudePlanWindows')).getByText(
        OUTBOUND_CONTROLS.claudePlanWindows.sends
      )
    ).toBeVisible();

    // The recap is gated by nothing, so it keeps its switch in the same
    // group and in the same build.
    expect(
      within(ownAccounts).getByRole('switch', {
        name: OUTBOUND_CONTROLS.reentryRecap.label,
      })
    ).toBeVisible();
  });

  it('reflects a plan-window preference persisted earlier', async () => {
    installSettingsBridge({ claudePlanWindows: { enabled: false } });
    await renderPrivacy();

    expect(
      within(groupFor('data-own-account-settings')).getByRole('switch', {
        name: OUTBOUND_CONTROLS.claudePlanWindows.label,
      })
    ).toHaveAttribute('aria-checked', 'false');
  });

  // ENG-035: public sharing is a FOURTH structurally separate group — the
  // only control that makes data public, and the only one that is opt-in.
  it('gives the operator profile an off-by-default switch in its own group', async () => {
    const bridge = installSettingsBridge();
    await renderPrivacy();

    const publicSharing = groupFor('data-public-sharing-settings');
    const publishing = within(publicSharing).getByRole('switch', {
      name: OUTBOUND_CONTROLS.operatorProfile.label,
    });
    // Absent preference means OFF — enabling is the consent act.
    expect(publishing).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(publishing);
    await waitFor(() =>
      expect(bridge.setOperatorAutoPublish).toHaveBeenCalledWith(true)
    );
    await waitFor(() =>
      expect(publishing).toHaveAttribute('aria-checked', 'true')
    );

    fireEvent.click(publishing);
    await waitFor(() =>
      expect(bridge.setOperatorAutoPublish).toHaveBeenCalledWith(false)
    );
    await waitFor(() =>
      expect(publishing).toHaveAttribute('aria-checked', 'false')
    );
  });

  it('reflects a publishing preference persisted earlier', async () => {
    installSettingsBridge({ operatorProfile: { autoPublish: true } });
    await renderPrivacy();

    expect(
      within(groupFor('data-public-sharing-settings')).getByRole('switch', {
        name: OUTBOUND_CONTROLS.operatorProfile.label,
      })
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps public sharing structurally separate from every other group', async () => {
    installSettingsBridge();
    await renderPrivacy();

    const publicSharing = groupFor('data-public-sharing-settings');
    for (const attribute of [
      'data-hosted-feature-settings',
      'data-own-account-settings',
      'data-analytics-settings',
    ]) {
      const other = groupFor(attribute);
      expect(publicSharing.contains(other)).toBe(false);
      expect(other.contains(publicSharing)).toBe(false);
      expect(
        within(other).queryByRole('switch', {
          name: OUTBOUND_CONTROLS.operatorProfile.label,
        })
      ).toBeNull();
    }
    expect(
      within(publicSharing).getByRole('switch', {
        name: OUTBOUND_CONTROLS.operatorProfile.label,
      })
    ).toBeVisible();
  });

  it('reflects a recap preference persisted earlier', async () => {
    installSettingsBridge({ reentryRecap: { enabled: false } });
    await renderPrivacy();

    expect(
      within(groupFor('data-own-account-settings')).getByRole('switch', {
        name: OUTBOUND_CONTROLS.reentryRecap.label,
      })
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps analytics separate from the hosted features, both ways', async () => {
    installSettingsBridge();
    await renderPrivacy();

    const hosted = groupFor('data-hosted-feature-settings');
    const analytics = groupFor('data-analytics-settings');
    const ownAccounts = groupFor('data-own-account-settings');

    expect(hosted.contains(analytics)).toBe(false);
    expect(analytics.contains(hosted)).toBe(false);
    expect(hosted.contains(ownAccounts)).toBe(false);
    expect(ownAccounts.contains(hosted)).toBe(false);
    expect(analytics.contains(ownAccounts)).toBe(false);
    expect(ownAccounts.contains(analytics)).toBe(false);

    expect(
      within(ownAccounts).getByRole('switch', {
        name: OUTBOUND_CONTROLS.reentryRecap.label,
      })
    ).toBeVisible();
    expect(
      within(hosted).queryByRole('switch', {
        name: OUTBOUND_CONTROLS.reentryRecap.label,
      })
    ).toBeNull();
    expect(
      within(analytics).queryByRole('switch', {
        name: OUTBOUND_CONTROLS.reentryRecap.label,
      })
    ).toBeNull();

    expect(
      within(analytics).getByRole('switch', {
        name: OUTBOUND_CONTROLS.productAnalytics.label,
      })
    ).toBeVisible();
    expect(
      within(hosted).queryByRole('switch', {
        name: OUTBOUND_CONTROLS.productAnalytics.label,
      })
    ).toBeNull();

    for (const id of HOSTED_FEATURE_IDS) {
      expect(
        within(hosted).getByRole('switch', {
          name: OUTBOUND_CONTROLS[id].label,
        })
      ).toBeVisible();
      expect(
        within(analytics).queryByRole('switch', {
          name: OUTBOUND_CONTROLS[id].label,
        })
      ).toBeNull();
    }
  });

  it('turns product analytics off and back on', async () => {
    installSettingsBridge();
    await renderPrivacy();

    const analytics = within(rowFor('productAnalytics')).getByRole('switch', {
      name: OUTBOUND_CONTROLS.productAnalytics.label,
    });
    expect(analytics).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(analytics);
    expect(readAnalyticsOptOut()).toBe(true);
    expect(analytics).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(analytics);
    expect(readAnalyticsOptOut()).toBe(false);
    expect(analytics).toHaveAttribute('aria-checked', 'true');
  });

  it('starts from a saved analytics opt-out', async () => {
    window.localStorage.setItem('exawatt.analytics.opt-out.v1', 'true');
    installSettingsBridge();
    await renderPrivacy();

    expect(
      within(rowFor('productAnalytics')).getByRole('switch', {
        name: OUTBOUND_CONTROLS.productAnalytics.label,
      })
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('links to the privacy policy when this distribution serves one', async () => {
    distributionState.current = BRANDED_DISTRIBUTION;
    installSettingsBridge();
    await renderPrivacy();

    expect(
      screen.getByRole('link', { name: 'Privacy policy' })
    ).toHaveAttribute('href', '/privacy');
  });

  it('omits the link in a build that serves no privacy page', async () => {
    // The page lives in the company overlay, so an unbranded community build
    // does not serve `/privacy`. Linking it anyway would be a broken product,
    // not merely a 404 — and the surface already states the outbound
    // behaviour inline, which is the part a user needs.
    installSettingsBridge();
    await renderPrivacy();

    expect(
      screen.queryByRole('link', { name: 'Privacy policy' })
    ).toBeNull();
  });

  it('still renders the browser-reachable controls without a desktop bridge', async () => {
    await renderPrivacy();

    expect(
      screen.getByRole('switch', {
        name: OUTBOUND_CONTROLS.productAnalytics.label,
      })
    ).toBeVisible();
    expect(
      screen.getByRole('switch', { name: OUTBOUND_CONTROLS.goalVisuals.label })
    ).toBeVisible();
    expect(
      screen.queryByRole('switch', {
        name: OUTBOUND_CONTROLS.contextLabels.label,
      })
    ).toBeNull();
    // The recap is terminal-fed and desktop-only, like context labels.
    expect(
      screen.queryByRole('switch', {
        name: OUTBOUND_CONTROLS.reentryRecap.label,
      })
    ).toBeNull();
    // Publishing is fed by the local desktop source; no dead switch on web.
    expect(
      screen.queryByRole('switch', {
        name: OUTBOUND_CONTROLS.operatorProfile.label,
      })
    ).toBeNull();
  });
});
