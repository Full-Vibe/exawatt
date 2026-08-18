import type { DistributionContractV2 } from '@exawatt/core/distribution';

/**
 * What Exawatt does on the reader's machine, stated once for every download
 * surface (decision `0021`).
 *
 * `0021` requires the plain account to appear wherever a build is handed over,
 * and ENG-030 WP3 split that handover across the composition boundary: the
 * hosted page under `company/overlay/web/` offers the official signed build,
 * and `/download/community` in this tree describes the build you compile from
 * source. Two pages, one account. The 2026-08-18 correction to `0021` is the
 * reason this is a shared component rather than two copies: that document
 * carried a privacy claim the code had disproved months earlier, and a claim
 * written twice decays twice.
 *
 * THE CONTRACT IS THE BRANCH. Everything that differs between distributions is
 * read from the resolved `DistributionContractV2`, never from a prop a caller
 * chooses. A community build declares no services, so "nothing reaches Exawatt"
 * is derivable rather than asserted, and a distributor who configures one of
 * these endpoints gets the disclosure that goes with it automatically.
 *
 * The hosted wording is the one OS2.2's outbound audit landed on 2026-08-18
 * (`src/lib/hosted-features/outbound-disclosure.test.ts` scans this file for
 * the claims that audit forbids). Do not soften it back.
 *
 * Before editing any sentence here, read the code it describes and update
 * `src/components/download/machine-disclosures.test.tsx`, which pins the
 * load-bearing claims to `OUTBOUND_CONTROLS` and to the launcher's own default.
 * `src/app/privacy/page.tsx` carries the same discipline for the same reason.
 */

export interface MachineDisclosuresProps {
  /**
   * The distribution the DOWNLOADED APP will run under, which is not always the
   * one serving this page: `/download/community` describes a build compiled
   * from source and passes `COMMUNITY_DISTRIBUTION` even when the hosted site
   * is the tree serving it.
   */
  distribution: DistributionContractV2;
  /** The advertised build version, when the surface knows one. */
  version?: string | null;
}

function hasHostedCapability(contract: DistributionContractV2): boolean {
  return (
    contract.analytics !== null ||
    Object.values(contract.enrichment).some(endpoint => endpoint !== null) ||
    Object.values(contract.services).some(endpoint => endpoint !== null)
  );
}

export function MachineDisclosures({
  distribution,
  version,
}: MachineDisclosuresProps) {
  const hosted = hasHostedCapability(distribution);

  return (
    <section className="mt-14">
      <h2 className="text-lg font-semibold tracking-tight">
        How it works on your machine
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Exawatt runs the agents you already have, on your own machine, with your
        permissions.
      </p>
      <dl className="mt-6 space-y-6">
        <Disclosure term="Agents launch in YOLO mode by default">
          Exawatt hosts the coding agents you already installed and runs them
          under your account with your permissions. By default it starts them
          with approvals and sandboxing off, so a fleet keeps moving instead of
          stopping on every step. That is a choice you control per Agent: the
          launcher also offers Ask first, which keeps the harness protections
          on, and Auto-review, which lets the harness stop risky work.
        </Disclosure>
        <Disclosure term="It reads the logs your agents already write">
          To show your recent conversations, Exawatt reads the session logs your
          harnesses already keep on disk: <Path>~/.claude/projects</Path>,{' '}
          <Path>~/.codex/sessions</Path> and the Codex index beside it, and{' '}
          <Path>~/.grok/sessions</Path>. That includes conversations you started
          outside Exawatt. OpenCode is listed by asking its own command instead
          of reading a directory. The transcripts stay on your machine.
        </Disclosure>
        <Disclosure term="macOS asks before Exawatt touches a folder">
          Agents reach your projects through Exawatt, so macOS attributes the
          prompts for Documents, Desktop, Downloads, and external volumes to it.
          Granting access is what lets an agent work on a project stored there.
        </Disclosure>
        {hosted ? (
          <Disclosure term="What leaves your machine">
            When you are signed in, Exawatt sends bounded excerpts to name and
            summarize your Sessions: the Project name, the instruction you typed
            to start a Session, and up to eight recent prompts from it go to
            Exawatt and on to Anthropic&rsquo;s API. Recognizable secrets are
            replaced first. Signing in also syncs a project list: each
            Project&rsquo;s name, folder path, and git remote. One feature sends
            more and redacts nothing: the &ldquo;since you left&rdquo; recap
            pipes recent terminal output straight into the <Path>claude</Path>{' '}
            command already signed in on your machine, so it runs on your own
            Claude Code account and never touches Exawatt. Your files and your
            git history are not uploaded, your agents talk to their providers
            directly, and every one of these has its own switch in Settings,
            under Privacy, with the exact sentence for each.
          </Disclosure>
        ) : (
          <Disclosure term="What leaves your machine">
            This build declares no Exawatt services, so nothing reaches Exawatt:
            no Session excerpts, no project list, no analytics, and no account
            to sign in to. One feature still leaves the machine. Returning to a
            Session can summarize what changed while you were away, and it does
            that by piping up to 6,000 characters of recent terminal output,
            exactly as it appeared and not redacted, to the <Path>claude</Path>{' '}
            command already signed in here. That request is your own Claude Code
            traffic, not Exawatt&rsquo;s, and it has a switch in Settings, under
            Privacy. Your agents talk to their providers directly, the way they
            do without Exawatt.
          </Disclosure>
        )}
        {distribution.updates ? (
          <Disclosure term="Updates wait for you">
            The app checks a public update feed and downloads new builds in the
            background, then applies them only when you restart. It asks before
            it restarts, and says how many agents will stop. Their sessions and
            terminal history are saved first, so you can resume them afterwards.
          </Disclosure>
        ) : (
          <Disclosure term="There are no updates to wait for">
            This build has no update channel and never asks for one. You move to
            a newer version by pulling the source and building again.
          </Disclosure>
        )}
        <Disclosure term="It is early">
          {version ? `This is version ${version}. ` : ''}Expect rough edges and
          layouts that move between builds. Your work does not live here: your
          agents&rsquo; own logs and your git history stay the source of truth,
          so nothing is trapped in Exawatt.
        </Disclosure>
      </dl>
    </section>
  );
}

export function Disclosure({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-sm font-medium text-foreground">{term}</dt>
      <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {children}
      </dd>
    </div>
  );
}

function Path({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-xs text-foreground">{children}</code>;
}
