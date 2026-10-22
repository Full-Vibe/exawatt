'use client';

import {
  Suspense,
  useState,
  useCallback,
  useEffect,
  type ComponentType,
} from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, ArrowRight } from 'lucide-react';
import { ConnectSourceDialog } from '@/components/workspace/connect-source-dialog';
import { AgentSourcesSettings } from './agent-sources-settings';
import { FleetSettings } from './fleet-settings';
import { AppearanceSettings } from './appearance-settings';
import { PrivacySettings } from './privacy-settings';
import { PermissionsSettings } from './permissions-settings';
import { SafetySettings } from './safety-settings';
import { PowerSettings } from './power-settings';
import { KeyboardSettings } from './keyboard-settings';
import { NotificationsSettings } from './notifications-settings';
import { SettingsPage } from './settings-controls';
import {
  SETTINGS_DESTINATIONS,
  SETTINGS_GROUPS,
  isSettingsTopic,
  resolveSettingsSection,
  settingsHref,
  searchSettings,
  type SettingsSection,
  type SettingsTopicId,
} from './settings-registry';

/** How long a landed row keeps its wash. */
const LANDED_MS = 2000;

function ConnectionFromLink({ onOpen }: { onOpen: (id: string) => void }) {
  const source = useSearchParams()?.get('source') ?? null;
  useEffect(() => {
    if (source) onOpen(source);
  }, [onOpen, source]);
  return null;
}

/**
 * Feature bodies keep their own controls and persistence. The shell owns
 * finding them and the frame around them.
 */
const SECTION_COMPONENTS = {
  appearance: AppearanceSettings,
  fleet: FleetSettings,
  notifications: NotificationsSettings,
  keyboard: KeyboardSettings,
  power: PowerSettings,
  permissions: PermissionsSettings,
  privacy: PrivacySettings,
  safety: SafetySettings,
} satisfies Record<Exclude<SettingsSection, 'agent-sources'>, ComponentType>;

export function SettingsClient() {
  const [activeSection, setActiveSection] =
    useState<SettingsSection>('agent-sources');
  const [query, setQuery] = useState('');
  const [landed, setLanded] = useState<SettingsTopicId | null>(null);
  const [locationRevision, setLocationRevision] = useState(0);
  const [connectOpen, setConnectOpen] = useState(false);
  const [openConnection, setOpenConnection] = useState<{ id: string } | null>(
    null
  );
  const navigate = useCallback(
    (section: SettingsSection, topic?: SettingsTopicId) => {
      setActiveSection(section);
      setQuery('');
      window.history.pushState(null, '', settingsHref(section, topic));
      setLocationRevision(value => value + 1);
    },
    []
  );
  useEffect(() => {
    const readLocation = () => {
      setActiveSection(
        resolveSettingsSection(
          new URLSearchParams(window.location.search).get('section')
        )
      );
      setQuery('');
      setLocationRevision(value => value + 1);
    };
    readLocation();
    window.addEventListener('popstate', readLocation);
    return () => window.removeEventListener('popstate', readLocation);
  }, []);
  useEffect(() => {
    if (query || !window.location.hash) return;
    let id: string;
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    if (!isSettingsTopic(id)) return;
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView?.({ block: 'center' });
    target.focus({ preventScroll: true });
    setLanded(id);
    const timer = window.setTimeout(() => setLanded(null), LANDED_MS);
    return () => {
      window.clearTimeout(timer);
      setLanded(null);
    };
  }, [activeSection, query, locationRevision]);
  const openConnectionById = useCallback((id: string) => {
    setActiveSection('agent-sources');
    setQuery('');
    setOpenConnection({ id });
  }, []);
  const destination = SETTINGS_DESTINATIONS.find(
    item => item.id === activeSection
  )!;
  const Section =
    activeSection === 'agent-sources'
      ? null
      : SECTION_COMPONENTS[activeSection];
  const results = searchSettings(query);
  const link =
    (section: SettingsSection, topic?: SettingsTopicId) =>
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      )
        return;
      event.preventDefault();
      navigate(section, topic);
    };
  return (
    <main
      data-settings-shell
      className="min-h-[calc(100vh-3.75rem)] bg-[var(--settings-page)] font-ui text-[var(--settings-text)]"
    >
      <h1 className="sr-only">Settings</h1>
      <div className="grid min-h-[calc(100vh-3.75rem)] grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="exa-material-chrome border-b border-[var(--settings-line)] p-4 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-r lg:border-b-0">
          <p className="mb-4 px-2 text-base font-semibold">Settings</p>
          <label className="mb-5 flex items-center gap-2 rounded-md border border-[var(--settings-line-strong)] bg-[var(--settings-panel)] px-3 focus-within:ring-2 focus-within:ring-[var(--settings-teal)]">
            <Search
              aria-hidden
              size={16}
              className="shrink-0 text-[var(--settings-dim)]"
            />
            <input
              type="search"
              aria-label="Search Settings"
              placeholder="Search settings"
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="h-9 min-w-0 w-full bg-transparent text-sm outline-none placeholder:text-[var(--settings-faint)]"
            />
          </label>
          <nav
            aria-label="Settings"
            className="flex gap-6 overflow-x-auto lg:flex-col lg:gap-5"
          >
            {SETTINGS_GROUPS.map(group => (
              <div key={group} className="shrink-0">
                <p className="mb-1 px-2 text-chrome-label font-medium text-[var(--settings-faint)]">
                  {group}
                </p>
                <div className="flex gap-1 lg:flex-col">
                  {SETTINGS_DESTINATIONS.filter(
                    item => item.group === group
                  ).map(item => (
                    <a
                      key={item.id}
                      href={settingsHref(item.id)}
                      onClick={link(item.id)}
                      aria-current={
                        !query && activeSection === item.id ? 'page' : undefined
                      }
                      className="flex min-h-11 items-center rounded-md border border-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)]"
                      style={{
                        color:
                          !query && activeSection === item.id
                            ? 'var(--settings-text)'
                            : 'var(--settings-dim)',
                        background:
                          !query && activeSection === item.id
                            ? 'var(--settings-teal-wash)'
                            : 'transparent',
                      }}
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>
        {query.trim() ? (
          <section
            aria-label="Settings search results"
            className="min-w-0 px-4 py-6 sm:px-8"
          >
            <div className="mx-auto max-w-4xl">
              <h2 className="text-surface-title font-semibold">
                Search Settings
              </h2>
              <p
                role="status"
                className="mt-1 mb-6 text-sm text-[var(--settings-dim)]"
              >
                {results.length
                  ? `${results.length} matching ${results.length === 1 ? 'section' : 'sections'}`
                  : 'No settings found. Try a feature name, such as Fleet, font, or notifications.'}
              </p>
              <div className="space-y-3">
                {results.map(({ destination: item, topics }) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-[var(--settings-line)] bg-[var(--settings-panel)] px-5 py-4"
                  >
                    <p className="mb-1 text-chrome-label text-[var(--settings-faint)]">
                      {item.group}
                    </p>
                    <a
                      href={settingsHref(item.id)}
                      onClick={link(item.id)}
                      className="inline-flex items-center gap-2 text-base font-medium text-[var(--settings-text)] focus-visible:outline-2"
                    >
                      <span>{item.label}</span>
                      <ArrowRight size={14} aria-hidden />
                    </a>
                    <p className="mt-1 text-sm text-[var(--settings-dim)]">
                      {item.description}
                    </p>
                    {!!topics.length && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {topics.map(topic => (
                          <a
                            key={topic.id}
                            href={settingsHref(item.id, topic.id)}
                            onClick={link(item.id, topic.id)}
                            className="rounded border border-[var(--settings-line-strong)] px-3 py-2 text-chrome-label text-[var(--settings-soft)] focus-visible:outline-2"
                          >
                            {topic.label}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : (
          <SettingsPage
            destination={destination}
            landed={landed}
            wide={activeSection === 'agent-sources'}
          >
            {Section ? (
              <Section />
            ) : (
              <AgentSourcesSettings
                onConnectExistingAgent={() => setConnectOpen(true)}
                openConnection={openConnection}
              />
            )}
          </SettingsPage>
        )}
      </div>
      <ConnectSourceDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onManageServer={sourceId => {
          setConnectOpen(false);
          openConnectionById(sourceId);
        }}
      />
      <Suspense fallback={null}>
        <ConnectionFromLink onOpen={openConnectionById} />
      </Suspense>
    </main>
  );
}
