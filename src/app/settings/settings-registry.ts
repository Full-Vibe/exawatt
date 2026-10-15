/**
 * Settings information architecture. A feature contributes a destination with
 * an owner, user-facing description and search vocabulary, then mounts its own
 * component in SettingsClient. This is navigation metadata, not a form engine.
 * IDs and topic IDs are public deep links; keep them stable when copy changes.
 */
export const SETTINGS_GROUPS = [
  'Workspace',
  'Personalization',
  'Device & trust',
] as const;
type SettingsGroup = (typeof SETTINGS_GROUPS)[number];
interface SettingsTopic {
  id: string;
  label: string;
  keywords: readonly string[];
}
interface SettingsDestination {
  id: string;
  group: SettingsGroup;
  label: string;
  description: string;
  owner: string;
  keywords: readonly string[];
  topics: readonly SettingsTopic[];
}

export const SETTINGS_DESTINATIONS = [
  {
    id: 'agent-sources',
    group: 'Workspace',
    label: 'Agent Sources',
    description:
      'Connect and manage the sources that bring Agents into your Workspace.',
    owner: 'agent-sources',
    keywords: [
      'connect',
      'server',
      'gateway',
      'OpenClaw',
      'Codex',
      'Claude',
      'harness',
    ],
    topics: [],
  },
  {
    id: 'fleet',
    group: 'Workspace',
    label: 'Fleet',
    description: 'Choose the Fleet view and the material of its Agent tiles.',
    owner: 'spatial-operations-board',
    keywords: ['board', 'agents', 'presentation', 'tiles', 'dots', 'v1', 'v2'],
    topics: [
      {
        id: 'fleet-view',
        label: 'Fleet view',
        keywords: ['v1', 'v2', 'preview', 'dots', 'tiles'],
      },
      {
        id: 'fleet-material',
        label: 'Tile material',
        keywords: ['matte', 'glazed', 'gummy', 'acrylic', 'anodized', 'finish'],
      },
    ],
  },
  {
    id: 'appearance',
    group: 'Personalization',
    label: 'Appearance',
    description: 'Set the theme, interface font and text size.',
    owner: 'appearance',
    keywords: [
      'theme',
      'color',
      'dark',
      'light',
      'classic',
      'air',
      'night',
      'readability',
    ],
    topics: [
      {
        id: 'theme-mode',
        label: 'Theme',
        keywords: ['automatic', 'manual', 'dark', 'light'],
      },
      { id: 'system-accent', label: 'System accent', keywords: ['color'] },
      {
        id: 'interface-font',
        label: 'Interface font',
        keywords: ['typeface', 'system', 'geist'],
      },
      {
        id: 'interface-text-size',
        label: 'Interface text size',
        keywords: ['scale', 'zoom', 'readability'],
      },
    ],
  },
  {
    id: 'notifications',
    group: 'Personalization',
    label: 'Notifications',
    description: 'Control desktop notifications, Dock badges and usage alerts.',
    owner: 'notifications',
    keywords: ['alert', 'notification', 'dock', 'badge', 'usage', 'sound'],
    topics: [],
  },
  {
    id: 'keyboard',
    group: 'Personalization',
    label: 'Keyboard shortcuts',
    description: 'Find commands and customize their keyboard bindings.',
    owner: 'shortcuts',
    keywords: ['keyboard', 'shortcut', 'hotkey', 'command', 'binding', 'keys'],
    topics: [],
  },
  {
    id: 'power',
    group: 'Device & trust',
    label: 'Power',
    description: 'Manage sleep prevention while local Agents work.',
    owner: 'device-power',
    keywords: ['battery', 'sleep', 'awake', 'energy', 'power', 'AC'],
    topics: [],
  },
  {
    id: 'permissions',
    group: 'Device & trust',
    label: 'Permissions',
    description: 'Review access granted by macOS and within Exawatt.',
    owner: 'permissions',
    keywords: [
      'macOS',
      'grant',
      'access',
      'files',
      'folders',
      'microphone',
      'camera',
      'permission',
    ],
    topics: [],
  },
  {
    id: 'privacy',
    group: 'Device & trust',
    label: 'Privacy',
    description:
      'Choose what data leaves this device and which hosted features can use it.',
    owner: 'hosted-features',
    keywords: [
      'data',
      'sharing',
      'hosted',
      'summaries',
      'context',
      'visuals',
      'analytics',
      'privacy',
    ],
    topics: [],
  },
  {
    id: 'safety',
    group: 'Device & trust',
    label: 'Safety',
    description: 'Manage agent guardrails and recovery controls.',
    owner: 'safety-controls',
    keywords: ['guardrail', 'approval', 'safety', 'stop', 'recover', 'reset'],
    topics: [],
  },
] as const satisfies readonly SettingsDestination[];

export type SettingsSection = (typeof SETTINGS_DESTINATIONS)[number]['id'];

export function resolveSettingsSection(id: string | null): SettingsSection {
  // The old catch-all destination remains a useful inbound link.
  if (id === 'preferences') return 'appearance';
  return (
    SETTINGS_DESTINATIONS.find(item => item.id === id)?.id ?? 'agent-sources'
  );
}

export function settingsHref(section: SettingsSection, topic?: string): string {
  return `/settings?section=${section}${topic ? `#${encodeURIComponent(topic)}` : ''}`;
}

export function searchSettings(query: string) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return SETTINGS_DESTINATIONS.flatMap(destination => {
    const sectionText = [
      destination.label,
      destination.description,
      ...destination.keywords,
    ]
      .join(' ')
      .toLocaleLowerCase();
    const matches = (text: string) => words.every(word => text.includes(word));
    const topics = destination.topics.filter(topic =>
      matches(
        `${destination.label} ${topic.label} ${topic.keywords.join(' ')}`.toLocaleLowerCase()
      )
    );
    if (!matches(sectionText) && !topics.length) return [];
    return [{ destination, topics }];
  });
}
