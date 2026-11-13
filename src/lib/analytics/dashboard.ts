/**
 * ENG-047 F8 — the operator's PostHog dashboard, as code.
 *
 * This module is the source of truth for the "Exawatt activation" dashboard
 * in PostHog project 545032: every insight's name, description and HogQL.
 * `pnpm analytics:dashboard` applies it (dry run by default); the live
 * dashboard is never edited by hand, so the queries cannot drift from what
 * the repository says they are. `dashboard.test.ts` refuses a query that
 * names an event or a property the allowlist (`events.ts`) does not declare.
 *
 * Nothing here runs in the product: the module is read by that script and
 * its test only, and holds no runtime imports, so Node can load it directly
 * with type stripping.
 *
 * Shared reading rules, every insight:
 *  - Nothing before F0 (2026-10-15). Builds before it could mint a new
 *    installation id on a fallback-port launch, so earlier installs are
 *    inflated; the bound holds whatever date range the viewer picks.
 *  - The team's own installs and browsers are left out (`internal`).
 *  - A person is an installation (or a browser), merged with its web id when
 *    the "Open Exawatt" alias exists. The signed-in account stream is read
 *    only by the activity-stream insight, so an account never counts twice.
 *  - Coming back is an `app_active` on a second local day (one per local
 *    day by construction), or, for builds that predate `app_active`, a
 *    desktop launch on a later day.
 */

import type { AnalyticsEventName } from './events';

/** The dashboard every insight below sits on. */
export const ANALYTICS_DASHBOARD = {
  projectId: 545032,
  id: 2218458,
  name: 'Exawatt activation',
  description:
    'Who visits, downloads, launches, opens a Project, starts an Agent and comes back. Source of truth: src/lib/analytics/dashboard.ts (pnpm analytics:dashboard).',
} as const;

/** F0: the first day an installation id was stable across launches. */
export const ANALYTICS_READ_FROM = '2026-10-15';

/** `INGEST_LIBS.accountStream` (`ingest.ts`); the test pins the two equal. */
export const ACCOUNT_STREAM_LIB = 'exawatt-account-stream';

/** Events a query may name beyond the allowlist: PostHog's own. */
export const POSTHOG_OWN_EVENTS = ['$exception', '$create_alias'] as const;

type DashboardEventName =
  | AnalyticsEventName
  | (typeof POSTHOG_OWN_EVENTS)[number];

export type InsightDisplay = 'ActionsBar' | 'ActionsLineGraph' | 'Table';

export interface AnalyticsInsight {
  /** PostHog's short id, for insights that already exist. */
  shortId?: string;
  name: string;
  description: string;
  /** HogQL; `{filters}` binds the insight's date range. */
  query: string;
  /** The default date range, relative (`-30d`) or absolute. */
  dateFrom: string;
  display: InsightDisplay;
  /** For a line graph: the x column and the y columns, in order. */
  axes?: { x: string; y: readonly string[] };
}

/* ------------------------------------------------------------------ *
 * Fragments. Every query is assembled from these, so a rule such as
 * "skip the team's installs" is written once.
 * ------------------------------------------------------------------ */

const lines = (...parts: readonly string[]): string => parts.join('\n');
const quoted = (value: string): string => `'${value}'`;

const eventIs = (name: DashboardEventName): string => `event = ${quoted(name)}`;
const eventIn = (names: readonly DashboardEventName[]): string =>
  `event IN (${names.map(quoted).join(', ')})`;

const ON_DESKTOP = `properties.surface = 'desktop'`;
const DESKTOP_LAUNCH = `${eventIs('app_launched')} AND ${ON_DESKTOP}`;
const ACTIVE_DAY = `${eventIs('app_active')} AND ${ON_DESKTOP}`;

/** The viewer's date range, never earlier than F0. */
const IN_RANGE = `{filters} AND timestamp >= toDateTime('${ANALYTICS_READ_FROM} 00:00:00')`;

/**
 * `internal` is a boolean property; PostHog reads it as text. A missing value
 * (events from builds before allowlist version 2) is not internal.
 */
const NOT_INTERNAL = `coalesce(toString(properties.internal), 'false') NOT IN ('true', '1')`;

const INSTALLATION_STREAM = `coalesce(properties.$lib, '') != ${quoted(ACCOUNT_STREAM_LIB)}`;
const ACCOUNT_STREAM = `properties.$lib = ${quoted(ACCOUNT_STREAM_LIB)}`;

/** `WHERE` for the installation stream: in range, not the team, not an account. */
const installationEvents = (names: readonly DashboardEventName[]): string =>
  `${IN_RANGE} AND ${eventIn(names)} AND ${INSTALLATION_STREAM} AND ${NOT_INTERNAL}`;

const at = 'toUnixTimestamp(timestamp)';
const firstAt = (condition: string, alias: string): string =>
  `minIf(${at}, ${condition}) AS ${alias}`;
const lastAt = (condition: string, alias: string): string =>
  `maxIf(${at}, ${condition}) AS ${alias}`;

/**
 * Came back on a later day. `app_active` is sent once per local day, so two
 * of them are two days; a later-dated launch covers builds without it.
 */
const RETURNED = `(active_days >= 2 OR last_launch_day > first_launch_day)`;
const RETURN_COLUMNS = [
  `countIf(${ACTIVE_DAY}) AS active_days`,
  `minIf(toDate(timestamp), ${DESKTOP_LAUNCH}) AS first_launch_day`,
  `maxIf(toDate(timestamp), ${DESKTOP_LAUNCH}) AS last_launch_day`,
];

/* ------------------------------------------------------------------ *
 * Insights.
 * ------------------------------------------------------------------ */

/**
 * Visit → download → first launch → first Project → first Agent → back on a
 * later day. A step counts when it happened at or after the previous step's
 * first occurrence (an Agent restored at launch before the day's first open
 * still counts). `minIf` answers 0 when nothing matched, so a step a person
 * never reached fails every later comparison. `installs` reads the desktop
 * funnel on its own, since the web steps join only through the alias.
 */
const ACTIVATION_FUNNEL = lines(
  'WITH people AS (',
  '  SELECT person_id,',
  `    ${firstAt(eventIs('page_viewed'), 'visit')},`,
  `    ${firstAt(eventIs('download_requested'), 'download')},`,
  `    ${lastAt(eventIs('download_requested'), 'download_last')},`,
  `    ${firstAt(DESKTOP_LAUNCH, 'launch')},`,
  `    ${lastAt(DESKTOP_LAUNCH, 'launch_last')},`,
  `    ${firstAt(eventIs('project_opened'), 'project')},`,
  `    ${lastAt(eventIs('project_opened'), 'project_last')},`,
  `    ${lastAt(eventIs('agent_launched'), 'agent_last')},`,
  `    ${RETURN_COLUMNS.join(',\n    ')}`,
  '  FROM events',
  `  WHERE ${installationEvents([
    'page_viewed',
    'download_requested',
    'app_launched',
    'app_active',
    'project_opened',
    'agent_launched',
  ])}`,
  '  GROUP BY person_id',
  '), reached AS (',
  '  SELECT',
  '    visit > 0 AS s1,',
  '    s1 AND download_last >= visit AS s2,',
  '    s2 AND launch_last >= download AS s3,',
  '    s3 AND project_last >= launch AS s4,',
  '    s4 AND agent_last >= project AS s5,',
  `    s5 AND ${RETURNED} AS s6,`,
  '    launch > 0 AS d1,',
  '    d1 AND project_last >= launch AS d2,',
  '    d2 AND agent_last >= project AS d3,',
  `    d3 AND ${RETURNED} AS d4`,
  '  FROM people',
  ')',
  'SELECT step, people, installs FROM (',
  "  SELECT 1 AS n, 'Visited the site' AS step, countIf(s1) AS people, NULL AS installs FROM reached",
  "  UNION ALL SELECT 2, 'Downloaded', countIf(s2), NULL FROM reached",
  "  UNION ALL SELECT 3, 'Launched the app', countIf(s3), countIf(d1) FROM reached",
  "  UNION ALL SELECT 4, 'Opened a Project', countIf(s4), countIf(d2) FROM reached",
  "  UNION ALL SELECT 5, 'Started an Agent', countIf(s5), countIf(d3) FROM reached",
  "  UNION ALL SELECT 6, 'Came back on a later day', countIf(s6), countIf(d4) FROM reached",
  ')',
  'ORDER BY n'
);

/** Each launched install, filed under the first step it has not reached. */
const WHERE_INSTALLS_STOP = lines(
  'SELECT',
  '  multiIf(',
  "    projects = 0, '1. Launched, no Project',",
  "    agents = 0, '2. Project, no Agent',",
  `    NOT ${RETURNED}, '3. Agent, not back on a later day',`,
  "    '4. Came back'",
  '  ) AS stopped_at,',
  '  count() AS installs,',
  '  groupArray(10)(toString(person_id)) AS examples',
  'FROM (',
  '  SELECT person_id,',
  `    countIf(${DESKTOP_LAUNCH}) AS launches,`,
  `    countIf(${eventIs('project_opened')}) AS projects,`,
  `    countIf(${eventIs('agent_launched')}) AS agents,`,
  `    ${RETURN_COLUMNS.join(',\n    ')}`,
  '  FROM events',
  `  WHERE ${installationEvents([
    'app_launched',
    'app_active',
    'project_opened',
    'agent_launched',
  ])} AND ${ON_DESKTOP}`,
  '  GROUP BY person_id',
  '  HAVING launches > 0 OR active_days > 0',
  ')',
  'GROUP BY stopped_at',
  'ORDER BY stopped_at'
);

/** Installations in use per period, by how the build was delivered. */
const activeInstalls = (bucket: string, column: string): string =>
  lines(
    `SELECT ${bucket} AS ${column},`,
    '  uniq(person_id) AS installs,',
    "  uniqIf(person_id, properties.delivery = 'signed') AS signed,",
    "  uniqIf(person_id, properties.delivery != 'signed') AS other",
    'FROM events',
    `WHERE ${installationEvents(['app_active'])} AND ${ON_DESKTOP}`,
    `GROUP BY ${column}`,
    `ORDER BY ${column}`
  );

const VISITS_AND_DOWNLOADS = lines(
  'SELECT toStartOfWeek(timestamp, 1) AS week,',
  `  uniqIf(person_id, ${eventIs('page_viewed')}) AS visitors,`,
  `  uniqIf(person_id, ${eventIs('page_viewed')} AND properties.path LIKE '/download%') AS download_page,`,
  `  uniqIf(person_id, ${eventIs('download_requested')}) AS downloaders,`,
  `  countIf(${eventIs('download_requested')}) AS downloads`,
  'FROM events',
  `WHERE ${installationEvents(['page_viewed', 'download_requested'])}`,
  'GROUP BY week',
  'ORDER BY week'
);

const REFERRERS = lines(
  'SELECT properties.referrer_host AS referrer, uniq(person_id) AS visitors',
  'FROM events',
  `WHERE ${installationEvents(['page_viewed'])} AND properties.referrer_host IS NOT NULL`,
  'GROUP BY referrer',
  'ORDER BY visitors DESC',
  'LIMIT 20'
);

/** One row per event, the account UUID as the person; names stay in Supabase. */
const ACCOUNT_ACTIVITY = lines(
  'SELECT timestamp, distinct_id AS account, event,',
  '  properties.harness AS harness,',
  '  properties.placement AS placement,',
  '  properties.source AS opened_from,',
  '  properties.recipients AS recipients,',
  '  properties.delivered AS delivered,',
  '  properties.agents_running AS agents_running',
  'FROM events',
  `WHERE ${IN_RANGE} AND ${eventIn([
    'app_launched',
    'app_active',
    'project_opened',
    'agent_launched',
    'agent_directed',
    'agent_finished',
  ])} AND ${ACCOUNT_STREAM} AND ${NOT_INTERNAL}`,
  'ORDER BY timestamp DESC',
  'LIMIT 500'
);

export const ANALYTICS_INSIGHTS: readonly AnalyticsInsight[] = [
  {
    shortId: 'xQwajwce',
    name: 'Activation funnel',
    description:
      'Visit, download, launch, first Project, first Agent, back on a later day. "installs" is the desktop funnel alone. Team installs and anything before 2026-10-15 left out.',
    query: ACTIVATION_FUNNEL,
    dateFrom: '-30d',
    display: 'ActionsBar',
  },
  {
    shortId: 'FTDfDzeL',
    name: 'Where installs stop',
    description:
      'Each launched install under the first step it has not reached, with up to ten example person ids to open.',
    query: WHERE_INSTALLS_STOP,
    dateFrom: '-30d',
    display: 'Table',
  },
  {
    name: 'Active installs per day',
    description:
      'Installations in use each day (app_active: a window focused or an Agent running), signed builds apart.',
    query: activeInstalls('toDate(timestamp)', 'day'),
    dateFrom: '-30d',
    display: 'ActionsLineGraph',
    axes: { x: 'day', y: ['installs', 'signed', 'other'] },
  },
  {
    name: 'Active installs per week',
    description:
      'Installations in use at least one day that week, signed builds apart.',
    query: activeInstalls('toStartOfWeek(timestamp, 1)', 'week'),
    dateFrom: '-90d',
    display: 'ActionsLineGraph',
    axes: { x: 'week', y: ['installs', 'signed', 'other'] },
  },
  {
    name: 'Visits and downloads per week',
    description:
      'Unique web visitors, visitors who reached /download, and downloads the site recorded. Downloads count only when the link carried a web id; the first-party total is on /admin/adoption.',
    query: VISITS_AND_DOWNLOADS,
    dateFrom: '-90d',
    display: 'Table',
  },
  {
    name: 'Where visitors come from',
    description: 'Referring sites by unique visitors (hostname only).',
    query: REFERRERS,
    dateFrom: '-30d',
    display: 'Table',
  },
  {
    shortId: 'vhM6a9kc',
    name: 'Signed-in activity stream',
    description:
      'Signed-in accounts only, keyed by account id; join to a name in Supabase, never in PostHog.',
    query: ACCOUNT_ACTIVITY,
    dateFrom: '-7d',
    display: 'Table',
  },
];

/** The PostHog `query` object an insight is saved with. */
export function insightQuery(
  insight: AnalyticsInsight
): Record<string, unknown> {
  const source = {
    kind: 'HogQLQuery',
    query: insight.query,
    filters: { dateRange: { date_from: insight.dateFrom } },
  };
  if (insight.display === 'Table') return { kind: 'DataTableNode', source };
  return {
    kind: 'DataVisualizationNode',
    source,
    display: insight.display,
    ...(insight.axes
      ? {
          chartSettings: {
            xAxis: { column: insight.axes.x },
            yAxis: insight.axes.y.map(column => ({ column })),
          },
        }
      : {}),
  };
}
