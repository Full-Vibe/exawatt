'use client';

/**
 * The Start screen (ENG-046 O2, O5): the workspace with no Project open.
 *
 * A home, not a wizard (operator, 2026-10-15): no steps, no progress, no
 * dismiss, and it stays the empty-Project state forever. It is the parts that
 * already carry their own truth, arranged once, in the order the operator
 * reviewed in the O0 study:
 *
 *   1. Agents you can run: the installed engines and one Add an engine card.
 *   2. Your projects: the harness-store suggestions, or Pick a folder.
 *   3. Try the Demo: the Workspace switch the account menu also offers.
 *   4. The account invitation, as a row here instead of floating over it.
 *
 * Design-system rungs (docs/engineering/design-system.md): `text-base`
 * section titles, `text-sm` rows, `text-chrome-label` controls,
 * `text-chrome-meta` captions; `p-4` operational cards, `gap-3` related
 * blocks, `space-y-6` sections; `rounded-lg` cards, `rounded-md` rows; the
 * workspace HUD roles for paint; the one button recipe (`outline` neutral,
 * `ghost` quiet; no `default`, because every row is its own action, the
 * chooser's rule); source colour only inside `SourceIdentityMark`; every
 * transition under `motion-reduce`.
 */
import { MonitorPlay } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AccountInvitationRow } from '@/components/auth/account-first-run-card';
import { DEMO_WORKSPACE } from '@/lib/tenancy/workspace-scope';
import { useOptionalWorkspaceTenancy } from '@/lib/tenancy/tenancy-provider';
import { useAgentSourceRegistry } from '../use-agent-source-registry';
import { WORKSPACE_HUD as HUD } from '../workspace-theme';
import { ProjectRoutes } from '../project-routes';
import { AgentsYouCanRun } from './agents-you-can-run';
import { YourProjects, type SuggestionOpen } from './your-projects';

function TryTheDemo() {
  const tenancy = useOptionalWorkspaceTenancy();
  if (!tenancy) return null;
  return (
    <section
      aria-labelledby="start-demo-heading"
      data-start-section="demo"
      className="flex flex-col gap-3"
    >
      <div className="flex min-h-8 items-center">
        <h2
          id="start-demo-heading"
          className="font-display text-base font-semibold"
          style={{ color: HUD.text }}
        >
          Try the Demo
        </h2>
      </div>
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
          onClick={() => tenancy.switchWorkspace(DEMO_WORKSPACE.id)}
          className="motion-reduce:transition-none"
        >
          Open Demo
        </Button>
      </div>
    </section>
  );
}

export function StartScreen({
  connectSupported,
  onOpenSuggestion,
  onOpenAllSuggestions,
  onBrowse,
  onImport,
  onConnect,
}: {
  connectSupported: boolean;
  onOpenSuggestion: (open: SuggestionOpen) => Promise<boolean>;
  onOpenAllSuggestions: (opens: SuggestionOpen[]) => Promise<boolean>;
  onBrowse: () => void;
  onImport: () => void;
  onConnect: () => void;
}) {
  const registryRead = useAgentSourceRegistry('launch');
  return (
    <div
      data-start-screen
      className="@container h-full overflow-y-auto"
      style={{
        background: `radial-gradient(120% 90% at 50% -10%, ${HUD.bg.hazeTeal}, transparent 55%)`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[960px] flex-col space-y-6 px-4 py-6 @xl:px-8 @xl:py-10">
        <AgentsYouCanRun
          registry={registryRead.registry}
          checking={
            registryRead.painted === 'none' &&
            registryRead.status === 'checking'
          }
          recheck={() => registryRead.recheck(true)}
        />
        <YourProjects
          emptyHeading="Pick a folder"
          registry={registryRead.registry}
          onOpen={onOpenSuggestion}
          onOpenAll={onOpenAllSuggestions}
        >
          <ProjectRoutes
            connectSupported={connectSupported}
            onBrowse={onBrowse}
            onImport={onImport}
            onConnect={onConnect}
          />
        </YourProjects>
        <TryTheDemo />
        <AccountInvitationRow />
      </div>
    </div>
  );
}
