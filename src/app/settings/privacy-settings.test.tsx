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
import { readAnalyticsOptOut } from '@/lib/analytics';
import {
  HOSTED_FEATURE_IDS,
  OUTBOUND_CONTROLS,
  type OutboundControlId,
} from '@/lib/hosted-features/contract';
import { GoalVisualPreferenceProvider } from '@/components/goal-visuals/goal-visual-preference-provider';
import type { ExawattSettings } from '@/types/electron';
import { PrivacySettings } from './privacy-settings';

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

  it('shows every control on by default before any settings load', async () => {
    installSettingsBridge({}, { pendingRead: true });
    await renderPrivacy();

    for (const control of Object.values(OUTBOUND_CONTROLS)) {
      expect(
        within(rowFor(control.id)).getByRole('switch', { name: control.label })
      ).toHaveAttribute('aria-checked', 'true');
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

  it('keeps analytics separate from the hosted features, both ways', async () => {
    installSettingsBridge();
    await renderPrivacy();

    const hosted = groupFor('data-hosted-feature-settings');
    const analytics = groupFor('data-analytics-settings');

    expect(hosted.contains(analytics)).toBe(false);
    expect(analytics.contains(hosted)).toBe(false);

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

  it('links to the privacy policy instead of restating it', async () => {
    installSettingsBridge();
    await renderPrivacy();

    expect(
      screen.getByRole('link', { name: 'Privacy policy' })
    ).toHaveAttribute('href', '/privacy');
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
  });
});
