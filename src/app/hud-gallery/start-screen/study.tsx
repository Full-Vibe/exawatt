'use client';

/**
 * Start screen study (ENG-046 O0), for operator review before O2 and O5 wire
 * it into production.
 *
 * Direction the operator decided on 2026-10-15: the empty-Project state
 * (today one centred Open Project button and the account card) becomes a
 * Start screen assembled from parts that already exist and already carry
 * their own truth, in this order:
 *
 *   1. Agents you can run: the Settings source cards in the composer's
 *      engine order, each with exactly one next step (Sign in, Install
 *      guide, Recheck) and decision 0051's line on the Gemini card.
 *   2. Your projects: ENG-046's harness-store suggestions with harness
 *      badges and one-click inert open; "Pick a folder" when there are none.
 *   3. Try the Demo: the existing Workspace switch.
 *
 * It stays the empty-Project state forever: a home, never a wizard. No
 * progress, no steps, no dismiss. The ⌘N chooser, the composer and this
 * screen are the same components arranged once.
 *
 * REUSED (controlled production components, fed fixture props): `Button`,
 * `SourceIdentityMark`, `SourceMark`, `StatusLight`,
 * `AgentLauncher` (the hand-off after a one-click open), the launcher bench
 * fixtures, `DEMO_WORKSPACE` / `PERSONAL_WORKSPACE`, `OUTBOUND_CONTROLS`, the
 * Voltaic Demo fixture, the workspace HUD roles and the theme registry.
 *
 * COPIED (production components that are not controllable; each is named in
 * the notes under the frame so the production packet knows what to make
 * controllable): the Settings source card (rail row, state pill and the
 * repair actions live inside `AgentSourcesSettings`, bound to the registry
 * IPC), the chooser's Project row and its Browse / Import / Connect footer
 * (inline JSX inside `ProjectOpener`, bound to the registry and the native
 * picker), the account menu's Workspace row, the Demo ribbon's Project chip,
 * and `AccountFirstRunCard` (reads Supabase, the pathname and storage).
 *
 * Design-system rungs (docs/engineering/design-system.md): type from the
 * named scale only (`text-base` section titles as the chooser's dialog
 * title, `text-sm` rows, `text-chrome-label` controls, `text-chrome-meta`
 * captions, `text-chrome-micro` mono paths); spacing on the 4px grid (`p-4`
 * operational cards, `gap-2` siblings, `gap-3` related blocks, `space-y-6`
 * sections, `px-8` gutter); `rounded-lg` cards, `rounded-md` rows; the
 * workspace HUD roles for paint; the one shadcn button recipe (`outline`
 * neutral, `ghost` quiet, no `default` because every row is its own action,
 * the chooser's rule); source brand colour only inside `SourceIdentityMark`;
 * status only through `StatusLight`; every transition under
 * `motion-reduce`; no em dash in any string a user reads.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Cable,
  Check,
  ChevronDown,
  ExternalLink,
  FolderInput,
  FolderOpen,
  Laptop,
  MonitorPlay,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  WORKSPACE_HUD as HUD,
  withThemeAlpha,
} from '@/components/workspace/workspace-theme';
import { SourceIdentityMark } from '@/components/workspace/source-identity-mark';
import { SourceMark } from '@/components/agent-sources/source-card';
import { AGENT_SOURCE_META } from '@/components/workspace/agent-sources';
import {
  StatusLight,
  statusLightStateForAgentStatus,
} from '@/components/status-light';
import { AgentLauncher } from '@/components/workspace/launcher/agent-launcher';
import {
  BENCH_SCENARIOS,
  benchAxes,
} from '@/components/workspace/launcher/launcher-fixtures';
import type { LauncherSetup } from '@/components/workspace/launcher/launcher-model';
import {
  DEMO_WORKSPACE,
  PERSONAL_WORKSPACE,
} from '@/lib/tenancy/workspace-scope';
import { OUTBOUND_CONTROLS } from '@/lib/hosted-features/contract';
import { THEME_REGISTRY } from '@/generated/theme-registry';
import { resolveAppearance } from '@/lib/appearance/resolve-appearance';
import { resolvedAppearanceCssVariables } from '@/lib/appearance/dom-adapter';
import type { BuiltInThemeId } from '@/lib/appearance/types';
import {
  DEMO_RIBBON,
  PROJECT_SUGGESTIONS,
  START_STATES,
  isRecent,
  relativeActivity,
  sourceCardsFor,
  type ProjectSuggestion,
  type StartSourceCard,
  type StartState,
} from './fixtures';

/* -------------------------------------------------------------------------- */
/* Study controls                                                             */
/* -------------------------------------------------------------------------- */

const THEMES = {
  classic: 'exawatt-classic-dark',
  air: 'exawatt-air-light',
  night: 'exawatt-night-dark',
} as const satisfies Record<string, BuiltInThemeId>;

type ThemeKey = keyof typeof THEMES;
type WidthKey = 'desktop' | 'narrow';

interface StudyControls {
  state: StartState;
  theme: ThemeKey;
  width: WidthKey;
  /** The ENG-030 OS0 account invitation, floating as it does in production. */
  card: boolean;
}

const DEFAULTS: StudyControls = {
  state: 'no-harness',
  theme: 'night',
  width: 'desktop',
  // Hidden by default so the composition reads first; shown, it floats over
  // the top-right cards exactly as production's fixed card would (question 2).
  card: false,
};

const STATE_IDS = START_STATES.map(state => state.id);

function readControls(search: string): StudyControls {
  const params = new URLSearchParams(search);
  const state = params.get('state');
  const theme = params.get('theme');
  return {
    state: STATE_IDS.includes(state as StartState)
      ? (state as StartState)
      : DEFAULTS.state,
    theme: theme && theme in THEMES ? (theme as ThemeKey) : DEFAULTS.theme,
    width: params.get('width') === 'narrow' ? 'narrow' : 'desktop',
    card: params.get('card') === 'on',
  };
}

function controlsHref(controls: StudyControls): string {
  const params = new URLSearchParams({
    state: controls.state,
    theme: controls.theme,
    width: controls.width,
    card: controls.card ? 'on' : 'off',
  });
  return `/hud-gallery/start-screen?${params.toString()}`;
}

function Control<Value extends string>({
  label,
  options,
  current,
  onChange,
}: {
  label: string;
  options: readonly { value: Value; label: string }[];
  current: Value;
  onChange: (value: Value) => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label={label}
    >
      <span
        className="mr-1 font-mono text-chrome-micro uppercase tracking-[0.12em]"
        style={{ color: HUD.textDim }}
      >
        {label}
      </span>
      {options.map(option => {
        const on = option.value === current;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            data-study-control={`${label.toLowerCase()}:${option.value}`}
            onClick={() => onChange(option.value)}
            className="inline-flex min-h-8 items-center rounded border px-2.5 text-chrome-label transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-hud-cyan motion-reduce:transition-none"
            style={{
              color: on ? HUD.text : HUD.textDim,
              borderColor: withThemeAlpha(HUD.textDim, on ? 0.55 : 0.2),
              background: on
                ? withThemeAlpha(HUD.textDim, 0.08)
                : 'transparent',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Start screen: shared bits                                                  */
/* -------------------------------------------------------------------------- */

function SectionTitle({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
      <h2
        className="font-display text-base font-semibold"
        style={{ color: HUD.text }}
      >
        {children}
      </h2>
      {trailing}
    </div>
  );
}

/** Copied from `ProjectOpener`'s footer: the three routes into a Project. */
function ChooserRoutes() {
  const secondary = {
    color: HUD.text,
    borderColor: HUD.strokeSoft,
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-chooser-routes>
      <button
        type="button"
        data-chooser-route="browse"
        className="inline-flex h-8 items-center gap-2 rounded border px-3 font-mono text-xs outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
        style={secondary}
      >
        <FolderOpen className="h-3.5 w-3.5" /> Browse Folder
      </button>
      <button
        type="button"
        data-chooser-route="import"
        className="inline-flex h-8 items-center gap-2 rounded px-3 font-mono text-xs outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
        style={{ color: HUD.textDim }}
      >
        <FolderInput className="h-3.5 w-3.5" /> Import Folder
      </button>
      <span
        aria-hidden
        className="mx-1 h-5 w-px"
        style={{ background: HUD.strokeFaint }}
      />
      <button
        type="button"
        data-chooser-route="connect"
        className="inline-flex h-8 items-center gap-2 rounded border px-3 font-mono text-xs outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
        style={secondary}
      >
        <Cable className="h-3.5 w-3.5" /> Connect a server…
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 1. Agents you can run                                                      */
/* -------------------------------------------------------------------------- */

function cardTone(state: StartSourceCard['state']): string {
  // The same roles Settings' `stateTone` maps to: the action role for ready,
  // the chrome attention role for a repair, the muted role for unknown.
  if (state === 'ready') return 'var(--exa-foundation-action)';
  if (state === 'action-required') return HUD.amber;
  return HUD.textDim;
}

/** Copied from Settings' `StatePill`, painted from the shared roles. */
function StatePill({ card }: { card: StartSourceCard }) {
  const tone = cardTone(card.state);
  return (
    <span
      className="inline-flex min-h-7 shrink-0 items-center gap-2 rounded-full border px-2.5 font-ui text-chrome-label font-medium"
      data-source-state-pill
      style={{
        color: tone,
        borderColor: withThemeAlpha(tone, 0.34),
        background: withThemeAlpha(tone, 0.08),
      }}
    >
      <span className="size-1.5 rounded-full" style={{ background: tone }} />
      {card.stateLabel}
    </span>
  );
}

function SourceCard({ card }: { card: StartSourceCard }) {
  const repair = card.nextStep.kind !== 'recheck';
  return (
    <article
      data-source-card={card.id}
      data-source-state={card.state}
      className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
      style={{
        borderColor: HUD.strokeFaint,
        background: HUD.bg.panelFill,
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <SourceIdentityMark className="size-9 rounded-lg" color={card.color}>
          <SourceMark id={card.id} />
        </SourceIdentityMark>
        <span className="min-w-0 flex-1">
          <span
            className="block truncate font-ui text-sm font-medium"
            style={{ color: HUD.text }}
          >
            {card.label}
          </span>
          <span
            className="mt-0.5 block truncate font-ui text-chrome-label"
            style={{ color: HUD.textDim }}
          >
            {card.connectionName}
          </span>
        </span>
        <StatePill card={card} />
      </div>

      {card.disclosure ? (
        <p
          className="text-chrome-meta leading-4"
          data-source-disclosure
          style={{ color: HUD.textDim }}
        >
          {card.disclosure.text}{' '}
          <a
            href={card.disclosure.href}
            className="underline underline-offset-2"
            style={{ color: HUD.textDim }}
          >
            {card.disclosure.linkLabel}
          </a>
        </p>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-next-step={card.nextStep.kind}
          className="min-w-0 max-w-full motion-reduce:transition-none"
        >
          {repair ? <ExternalLink aria-hidden /> : <RefreshCw aria-hidden />}
          <span className="truncate">{card.nextStep.label}</span>
        </Button>
        {card.recheck ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-source-recheck
            className="motion-reduce:transition-none"
          >
            <RefreshCw aria-hidden />
            Recheck
          </Button>
        ) : null}
        {card.checkedAt ? (
          <span
            className="ml-auto whitespace-nowrap text-chrome-meta"
            style={{ color: HUD.textDim }}
          >
            Checked {relativeActivity(card.checkedAt)}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function AgentsSection({ cards }: { cards: readonly StartSourceCard[] }) {
  return (
    <section
      aria-labelledby="start-agents"
      data-start-section="agents"
      className="flex flex-col gap-3"
    >
      <SectionTitle>
        <span id="start-agents">Agents you can run</span>
      </SectionTitle>
      <div className="grid grid-cols-1 items-start gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
        {cards.map(card => (
          <SourceCard key={card.id} card={card} />
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Your projects / Pick a folder                                           */
/* -------------------------------------------------------------------------- */

function HarnessBadges({
  harnesses,
}: {
  harnesses: ProjectSuggestion['harnesses'];
}) {
  return (
    <span className="flex shrink-0 items-center gap-1" data-harness-badges>
      {harnesses.map(harness => {
        const meta = AGENT_SOURCE_META[harness];
        const label = harness === 'antigravity' ? 'Gemini' : meta.label;
        return (
          <span key={harness} className="inline-flex" title={label}>
            <SourceIdentityMark
              className="size-5 rounded-sm"
              color={meta.color}
            >
              <SourceMark id={harness} size={11} />
            </SourceIdentityMark>
            <span className="sr-only">{label}</span>
          </span>
        );
      })}
    </span>
  );
}

/** Copied from the chooser's Project card: identity bar, name, mono path. A
 *  suggestion has no Project colour yet because it is not a registry row. */
function SuggestionRow({
  suggestion,
  onOpen,
}: {
  suggestion: ProjectSuggestion;
  onOpen: (suggestion: ProjectSuggestion) => void;
}) {
  return (
    <li>
      <button
        type="button"
        data-project-suggestion={suggestion.path}
        onClick={() => onOpen(suggestion)}
        className="group flex w-full min-w-0 items-center gap-3 rounded-md border px-3 py-2 text-left outline-none transition-colors hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
        style={{
          borderColor: HUD.strokeFaint,
          background: HUD.surfaceInputSoft,
        }}
      >
        <span
          aria-hidden
          className="block h-5 w-[3px] shrink-0 rounded-full"
          style={{ background: HUD.textDim }}
        />
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-sm font-medium"
            style={{ color: HUD.text }}
          >
            {suggestion.name}
          </span>
          <span
            className="block truncate font-mono text-chrome-micro"
            style={{ color: HUD.textDim }}
          >
            {suggestion.path}
          </span>
        </span>
        <HarnessBadges harnesses={suggestion.harnesses} />
        <span
          className="w-16 shrink-0 text-right font-mono text-chrome-meta"
          style={{ color: HUD.textDim }}
        >
          {relativeActivity(suggestion.lastActivityAt)}
        </span>
      </button>
    </li>
  );
}

function ProjectsSection({
  suggestions,
  onOpen,
}: {
  suggestions: readonly ProjectSuggestion[];
  onOpen: (suggestion: ProjectSuggestion) => void;
}) {
  const [older, setOlder] = useState(false);
  // Explicit lambdas: `filter(isRecent)` would hand the index in as `now`.
  const recent = suggestions.filter(suggestion => isRecent(suggestion));
  const rest = suggestions.filter(suggestion => !isRecent(suggestion));
  const empty = suggestions.length === 0;

  return (
    <section
      aria-labelledby="start-projects"
      data-start-section="projects"
      data-start-projects={empty ? 'pick-a-folder' : 'suggestions'}
      className="flex flex-col gap-3"
    >
      <SectionTitle
        trailing={
          empty ? null : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-open-all-recent
              className="motion-reduce:transition-none"
            >
              Open all recent
            </Button>
          )
        }
      >
        <span id="start-projects">
          {empty ? 'Pick a folder' : 'Your projects'}
        </span>
      </SectionTitle>

      {empty ? null : (
        <>
          <ul className="flex flex-col gap-1" data-project-suggestions>
            {recent.map(suggestion => (
              <SuggestionRow
                key={suggestion.path}
                suggestion={suggestion}
                onOpen={onOpen}
              />
            ))}
            {older
              ? rest.map(suggestion => (
                  <SuggestionRow
                    key={suggestion.path}
                    suggestion={suggestion}
                    onOpen={onOpen}
                  />
                ))
              : null}
          </ul>
          {rest.length > 0 ? (
            <button
              type="button"
              data-show-older
              aria-expanded={older}
              onClick={() => setOlder(current => !current)}
              className="inline-flex h-8 w-fit items-center gap-1.5 rounded px-2 font-mono text-xs outline-none hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
              style={{ color: HUD.textDim }}
            >
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${older ? 'rotate-180' : ''}`}
              />
              {older ? 'Hide older' : `Show older (${rest.length})`}
            </button>
          ) : null}
        </>
      )}

      <ChooserRoutes />
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Try the Demo                                                            */
/* -------------------------------------------------------------------------- */

/** Copied from the account menu's Workspace row (`site-header-nav.tsx`),
 *  laid flat with the switch verb beside it. */
function DemoSection({ onSwitch }: { onSwitch: () => void }) {
  return (
    <section
      aria-labelledby="start-demo"
      data-start-section="demo"
      className="flex flex-col gap-3"
    >
      <SectionTitle>
        <span id="start-demo">Try the Demo</span>
      </SectionTitle>
      <div
        className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
        style={{
          borderColor: HUD.strokeFaint,
          background: HUD.surfaceInputSoft,
        }}
      >
        <MonitorPlay
          aria-hidden
          className="h-4 w-4 shrink-0"
          style={{ color: HUD.textDim }}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className="truncate text-sm font-medium"
            style={{ color: HUD.text }}
          >
            {DEMO_WORKSPACE.name}
          </span>
          <span
            className="truncate text-chrome-meta"
            style={{ color: HUD.textDim }}
          >
            {DEMO_WORKSPACE.tagline}
          </span>
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-try-demo
          onClick={onSwitch}
          className="motion-reduce:transition-none"
        >
          Open Demo
        </Button>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* State 5: what switching shows                                              */
/* -------------------------------------------------------------------------- */

/** A faithful miniature of the Demo Workspace shell: the switched Workspace
 *  named, the D45 ribbon of Voltaic Projects, the first Project's Agents, and
 *  the way back. The chips are copied from the ribbon's look; status comes
 *  from the real `StatusLight` over the real fixture. */
function DemoWorkspacePreview({ onBack }: { onBack: () => void }) {
  const [activeKey, setActiveKey] = useState(DEMO_RIBBON[0].key);
  const active =
    DEMO_RIBBON.find(project => project.key === activeKey) ?? DEMO_RIBBON[0];
  return (
    <div className="flex flex-col gap-4" data-demo-workspace>
      <div
        className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
        data-active-tenant-workspace={DEMO_WORKSPACE.id}
        style={{
          borderColor: HUD.strokeFaint,
          background: HUD.surfaceInputSoft,
        }}
      >
        <MonitorPlay
          aria-hidden
          className="h-4 w-4 shrink-0"
          style={{ color: HUD.textDim }}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className="flex items-center gap-2 truncate text-sm font-medium"
            style={{ color: HUD.text }}
          >
            {DEMO_WORKSPACE.name}
            <Check
              aria-hidden
              className="h-3.5 w-3.5"
              style={{ color: 'var(--exa-foundation-action)' }}
            />
          </span>
          <span
            className="truncate text-chrome-meta"
            style={{ color: HUD.textDim }}
          >
            {DEMO_WORKSPACE.tagline}
          </span>
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-switch-personal
          onClick={onBack}
          className="motion-reduce:transition-none"
        >
          <Laptop aria-hidden />
          {PERSONAL_WORKSPACE.name}
        </Button>
      </div>

      <div
        role="tablist"
        aria-label="Projects"
        className="flex gap-1 overflow-x-auto pb-1"
        data-demo-ribbon
      >
        {DEMO_RIBBON.map(project => {
          const on = project.key === active.key;
          return (
            <button
              key={project.key}
              type="button"
              role="tab"
              aria-selected={on}
              data-demo-project={project.key}
              onClick={() => setActiveKey(project.key)}
              className="flex h-9 shrink-0 items-center gap-2 rounded px-2.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
              style={{
                background: on ? HUD.fillHi : 'transparent',
                color: on ? HUD.text : HUD.textDim,
              }}
            >
              <span
                aria-hidden
                className="h-4 w-[3px] rounded-full"
                style={{ background: project.color }}
              />
              <span className="whitespace-nowrap text-chrome-label font-medium">
                {project.name}
              </span>
              <span className="font-mono text-chrome-micro">
                {project.agents.length}
              </span>
            </button>
          );
        })}
      </div>

      <ul
        className="grid grid-cols-1 gap-2 @xl:grid-cols-2"
        data-demo-stage={active.key}
      >
        {active.agents.map(agent => (
          <li
            key={agent.id}
            className="flex items-center gap-3 rounded-md border px-3 py-2"
            style={{
              borderColor: HUD.strokeFaint,
              background: HUD.surfaceInputSoft,
            }}
          >
            <StatusLight
              size="compact"
              state={statusLightStateForAgentStatus(agent.status)}
            />
            <span
              className="min-w-0 flex-1 truncate text-sm"
              style={{ color: HUD.text }}
            >
              {agent.name}
            </span>
            <span
              className="inline-flex shrink-0"
              style={{ color: HUD.textDim }}
            >
              <SourceMark id={agent.harness} size={12} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* After one click: the hand-off (O3's moment, shown once)                    */
/* -------------------------------------------------------------------------- */

const COLD_SETUPS =
  BENCH_SCENARIOS.find(scenario => scenario.id === 'cold')?.setups ?? [];

function OpenedProject({
  suggestion,
  cards,
}: {
  suggestion: ProjectSuggestion;
  cards: readonly StartSourceCard[];
}) {
  // The composer's chips are the launcher bench's cold setups, one per
  // engine, with availability read off the cards above: an engine the Start
  // screen says is not installed stays on the row, dimmed with that reason.
  const setups = useMemo<LauncherSetup[]>(
    () =>
      COLD_SETUPS.map(setup => {
        const card = cards.find(entry => entry.id === setup.engine.harness);
        if (!card || card.state === 'ready') return setup;
        return {
          ...setup,
          available: false,
          unavailableReason: `${card.label} is not installed.`,
        };
      }),
    [cards]
  );
  const recommended =
    setups.find(
      setup =>
        setup.engine.harness === suggestion.harnesses[0] && setup.available
    ) ??
    setups.find(setup => setup.available) ??
    null;
  const [selectedId, setSelectedId] = useState<string | null>(
    recommended?.id ?? null
  );
  const [task, setTask] = useState('');
  const [permission, setPermission] = useState('Ask first');
  const selected = setups.find(setup => setup.id === selectedId) ?? null;
  const onAxisChange = useCallback((axisId: string, optionId: string) => {
    if (axisId === 'permission') setPermission(optionId);
  }, []);

  return (
    <div className="flex flex-col gap-4" data-start-opened={suggestion.path}>
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className="block h-5 w-[3px] shrink-0 rounded-full"
          style={{ background: HUD.cyan }}
        />
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-sm font-medium"
            style={{ color: HUD.text }}
          >
            {suggestion.name}
          </span>
          <span
            className="block truncate font-mono text-chrome-micro"
            style={{ color: HUD.textDim }}
          >
            {suggestion.path}
          </span>
        </span>
        <HarnessBadges harnesses={suggestion.harnesses} />
      </div>
      <div
        className="@container rounded-md p-4"
        style={{ background: HUD.bg.void }}
      >
        <AgentLauncher
          setups={setups}
          selectedId={selectedId}
          state="ready"
          axes={benchAxes(selected, permission, onAxisChange)}
          detailFootnote="Changes apply to this Agent only until you start it."
          task={task}
          onTaskChange={setTask}
          onSelect={setSelectedId}
          onOpenCatalog={() => {}}
          onStart={() => {}}
          placeholderCount={3}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The account invitation, floating as in production                         */
/* -------------------------------------------------------------------------- */

const ACCOUNT_FEATURES = [
  OUTBOUND_CONTROLS.contextLabels.label,
  OUTBOUND_CONTROLS.conversationSummaries.label,
  OUTBOUND_CONTROLS.goalVisuals.label,
  'Project sync across machines',
  'Sending feedback',
];

/** Copied from `AccountFirstRunCard`, positioned inside the frame instead of
 *  fixed to the window. An invitation, never a gate. */
function AccountCardCopy() {
  return (
    <aside
      data-account-first-run-study
      aria-label="Account features"
      className="exa-material-overlay absolute top-4 right-4 z-10 w-80 max-w-[calc(100%-2rem)] rounded-lg border border-[var(--exa-foundation-border-strong)] px-5 py-4 shadow-lg"
    >
      <h2 className="text-chrome-title font-semibold text-[var(--exa-foundation-text)]">
        Sign in to add hosted features
      </h2>
      <ul className="mt-3 list-disc space-y-1 ps-4 text-chrome-label text-[var(--exa-foundation-text)] marker:text-[var(--exa-foundation-text-muted)]">
        {ACCOUNT_FEATURES.map(feature => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <p className="mt-3 text-chrome-meta text-[var(--exa-foundation-text-muted)]">
        Agents, Projects, and Demo Mode work without an account.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <Button
          size="sm"
          type="button"
          className="motion-reduce:transition-none"
        >
          Sign in
        </Button>
        <Button
          size="sm"
          variant="outline"
          type="button"
          className="motion-reduce:transition-none"
        >
          Not now
        </Button>
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* The Start screen                                                           */
/* -------------------------------------------------------------------------- */

function StartScreen({
  state,
  showAccountCard,
  opened,
  onOpen,
  demoSwitched,
  onDemoSwitch,
}: {
  state: StartState;
  showAccountCard: boolean;
  opened: ProjectSuggestion | null;
  onOpen: (suggestion: ProjectSuggestion) => void;
  demoSwitched: boolean;
  onDemoSwitch: (switched: boolean) => void;
}) {
  const cards = useMemo(() => sourceCardsFor(state), [state]);
  const suggestions = state === 'ready-projects' ? PROJECT_SUGGESTIONS : [];

  let body: ReactNode;
  if (demoSwitched) {
    body = <DemoWorkspacePreview onBack={() => onDemoSwitch(false)} />;
  } else if (opened) {
    body = <OpenedProject suggestion={opened} cards={cards} />;
  } else {
    body = (
      <>
        <AgentsSection cards={cards} />
        <ProjectsSection suggestions={suggestions} onOpen={onOpen} />
        <DemoSection onSwitch={() => onDemoSwitch(true)} />
      </>
    );
  }

  return (
    <div
      data-start-screen
      data-start-state={state}
      data-start-view={demoSwitched ? 'demo' : opened ? 'opened' : 'start'}
      className="relative @container min-h-[560px] overflow-hidden rounded-lg border"
      style={{
        background: `radial-gradient(120% 90% at 50% -10%, ${HUD.bg.hazeTeal}, transparent 55%), ${HUD.bg.void}`,
        borderColor: HUD.strokeFaint,
        color: HUD.text,
      }}
    >
      {showAccountCard && !demoSwitched && !opened ? <AccountCardCopy /> : null}
      <div className="mx-auto flex w-full max-w-[960px] flex-col space-y-6 px-4 py-6 @xl:px-8 @xl:py-10">
        {body}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The study page body                                                        */
/* -------------------------------------------------------------------------- */

export function StartScreenStudy() {
  // `useSearchParams` is null outside the App Router (unit tests); the
  // controls then start from their defaults. Later changes rewrite the URL
  // through the History API so every state is a deep link for screenshots.
  const params = useSearchParams();
  const [controls, setControls] = useState<StudyControls>(() =>
    readControls(params?.toString() ?? '')
  );
  const [opened, setOpened] = useState<ProjectSuggestion | null>(null);
  const [demoSwitched, setDemoSwitched] = useState(false);

  const update = useCallback((patch: Partial<StudyControls>) => {
    setControls(current => {
      const next = { ...current, ...patch };
      if (typeof window !== 'undefined') {
        window.history.replaceState(
          window.history.state,
          '',
          controlsHref(next)
        );
      }
      return next;
    });
    if ('state' in patch) {
      setOpened(null);
      setDemoSwitched(patch.state === 'demo');
    }
  }, []);

  const resolvedAppearance = useMemo(() => {
    const themeId = THEMES[controls.theme];
    const theme = THEME_REGISTRY[themeId];
    return resolveAppearance(
      THEME_REGISTRY,
      {
        schemaVersion: 1,
        selection: { mode: 'manual', themeId },
        accentSource: 'theme',
        interfaceFont: 'theme',
        interfaceScale: 100,
        contrast: 'system',
        transparency: 'system',
      },
      {
        dark: theme.appearance === 'dark',
        highContrast: false,
        forcedColors: false,
        invertedColors: false,
        reducedTransparency: false,
      }
    );
  }, [controls.theme]);

  const active = START_STATES.find(state => state.id === controls.state)!;
  const showDemo = demoSwitched || (controls.state === 'demo' && !opened);

  return (
    <main
      className="min-h-screen bg-background px-4 py-6 font-ui text-foreground sm:px-6 sm:py-8 lg:px-8"
      style={resolvedAppearanceCssVariables(resolvedAppearance)}
      data-exa-theme={resolvedAppearance.themeId}
      data-exa-appearance={resolvedAppearance.appearance}
      data-exa-font={resolvedAppearance.interfaceFont}
      data-exa-typography={resolvedAppearance.theme.typography.profile}
      data-start-study
    >
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6">
        <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end sm:gap-6">
          <div>
            <p
              className="font-mono text-chrome-micro uppercase tracking-[0.16em]"
              style={{ color: HUD.textDim }}
            >
              <a href="/hud-gallery" className="hover:underline">
                HUD Gallery
              </a>{' '}
              / First run
            </p>
            <h1 className="mt-1 text-surface-title font-semibold">
              Start screen
            </h1>
            <p
              className="mt-2 max-w-2xl text-sm"
              style={{ color: HUD.textDim }}
            >
              ENG-046 O0. The empty-Project state as a home assembled from the
              source cards, the chooser and the Demo switch. Five states, one
              composition, no wizard.
            </p>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border p-3">
          <Control
            label="State"
            options={START_STATES.map(state => ({
              value: state.id,
              label: state.label,
            }))}
            current={controls.state}
            onChange={state => update({ state })}
          />
          <Control
            label="Theme"
            options={(Object.keys(THEMES) as ThemeKey[]).map(value => ({
              value,
              label: value[0].toUpperCase() + value.slice(1),
            }))}
            current={controls.theme}
            onChange={theme => update({ theme })}
          />
          <Control
            label="Width"
            options={[
              { value: 'desktop' as const, label: 'Desktop' },
              { value: 'narrow' as const, label: 'Narrow 520' },
            ]}
            current={controls.width}
            onChange={width => update({ width })}
          />
          <Control
            label="Account card"
            options={[
              { value: 'on' as const, label: 'Shown' },
              { value: 'off' as const, label: 'Hidden' },
            ]}
            current={controls.card ? 'on' : 'off'}
            onChange={value => update({ card: value === 'on' })}
          />
          {opened || (demoSwitched && controls.state !== 'demo') ? (
            <button
              type="button"
              data-study-back
              onClick={() => {
                setOpened(null);
                setDemoSwitched(false);
              }}
              className="inline-flex min-h-8 items-center rounded border px-2.5 text-chrome-label outline-none focus-visible:ring-2 focus-visible:ring-hud-cyan"
              style={{
                color: HUD.text,
                borderColor: withThemeAlpha(HUD.textDim, 0.55),
              }}
            >
              Back to the Start screen
            </button>
          ) : null}
        </div>

        <p
          className="max-w-prose text-chrome-meta"
          style={{ color: HUD.textDim }}
        >
          {active.note}
        </p>

        <div
          className="w-full"
          style={{
            width: controls.width === 'narrow' ? 520 : undefined,
            maxWidth: '100%',
          }}
        >
          <StartScreen
            state={controls.state}
            showAccountCard={controls.card}
            opened={opened}
            onOpen={setOpened}
            demoSwitched={showDemo}
            onDemoSwitch={setDemoSwitched}
          />
        </div>

        <section
          aria-labelledby="start-notes"
          className="grid gap-6 rounded-lg border border-border p-4 text-sm md:grid-cols-3"
          data-start-notes
        >
          <div>
            <h2 id="start-notes" className="text-chrome-title font-semibold">
              Reused as is
            </h2>
            <ul
              className="mt-2 list-disc space-y-1 ps-4 text-chrome-label"
              style={{ color: HUD.textDim }}
            >
              <li>Button, SourceIdentityMark, SourceMark</li>
              <li>StatusLight over the Voltaic Demo fixture</li>
              <li>
                AgentLauncher and the launcher bench fixtures (the hand-off)
              </li>
              <li>DEMO_WORKSPACE, PERSONAL_WORKSPACE, OUTBOUND_CONTROLS</li>
              <li>The composer&rsquo;s engine order and source declarations</li>
              <li>
                Workspace HUD roles, the theme registry, container queries
              </li>
            </ul>
          </div>
          <div>
            <h2 className="text-chrome-title font-semibold">
              Copied, to make controllable
            </h2>
            <ul
              className="mt-2 list-disc space-y-1 ps-4 text-chrome-label"
              style={{ color: HUD.textDim }}
            >
              <li>
                Settings source card: rail row, state pill, repair actions
                (inside AgentSourcesSettings, bound to the registry IPC)
              </li>
              <li>
                Chooser Project row and Browse / Import / Connect footer (inline
                in ProjectOpener, bound to the native picker)
              </li>
              <li>Account menu Workspace row (inside the dropdown)</li>
              <li>Demo ribbon Project chip (TabStrip over live state)</li>
              <li>AccountFirstRunCard (reads Supabase, pathname, storage)</li>
            </ul>
          </div>
          <div>
            <h2 className="text-chrome-title font-semibold">
              Questions for the operator
            </h2>
            <ol
              className="mt-2 list-decimal space-y-1 ps-4 text-chrome-label"
              style={{ color: HUD.textDim }}
            >
              <li>
                Six cards or only the installed ones? The composer&rsquo;s order
                shows every engine; the no-harness state is then six install
                guides.
              </li>
              <li>
                Does the account invitation keep floating over the Start screen,
                or become a fourth row under Try the Demo?
              </li>
              <li>
                After a one-click open, is the composer alone enough, or should
                the Project&rsquo;s recent conversations sit beside it from the
                first open (O3)?
              </li>
            </ol>
          </div>
        </section>
      </div>
    </main>
  );
}
