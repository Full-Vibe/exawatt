import type { Metadata } from 'next';
import { COMMUNITY_DISTRIBUTION } from '@exawatt/core/distribution';
import { MachineDisclosures } from '@/components/download/machine-disclosures';
import { GITHUB_URL } from '@/components/site/site-links';

/**
 * `/download` for everyone who is not Exawatt's hosted site (ENG-030 WP3,
 * decision `0021`).
 *
 * WHY THIS ROUTE IS NOT `/download`. The company overlay supplies
 * `src/app/download/page.tsx` in an `official-web` composition, and the
 * composer is strictly ADD-ONLY: an overlay entry may only create a path the
 * public tree lacks. A public `page.tsx` at the same address would not shadow
 * the hosted one, it would make `pnpm build` fail outright, because
 * `applyCompanyOverlayInPlace` refuses any declared target the public tree
 * tracks. So the two pages take two addresses, and `distributionRewrites`
 * routes `/download` here whenever nothing else answers it. Next applies an
 * array of rewrites AFTER the filesystem, so the composed tree wins by
 * existing and the public tree wins by default. Nothing is conditional on an
 * environment variable, which is the property that matters: the filesystem is
 * the switch, and the filesystem is what composition changes.
 *
 * WHAT THIS PAGE IS. A trust surface, not a conversion surface (decision
 * `0021`, marketing canon "Public Distribution"). It cannot offer the official
 * signed build, because that is Exawatt's distribution under Exawatt's signing
 * identity, from Exawatt's feed. What it can do honestly is say how to build
 * this source, what that build is and is not, and the same plain account of
 * what the app does on your machine that `0021` requires of every download
 * surface. That account is `MachineDisclosures`, shared with the hosted page so
 * a claim cannot go stale on one and not the other.
 *
 * Every fact here is verified against the code, not remembered:
 * `page.test.tsx` pins the ones that decay.
 */
export const metadata: Metadata = {
  title: { absolute: 'Build Exawatt from source' },
  description:
    'Build the Exawatt desktop app from source, and what that build does on your machine.',
};

const LICENSING_URL = `${GITHUB_URL}/blob/master/LICENSING.md`;
const TRADEMARKS_URL = `${GITHUB_URL}/blob/master/TRADEMARKS.md`;

export default function CommunityDownloadPage() {
  return (
    <main className="min-h-screen px-6 pb-24 pt-14 sm:pt-20">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Build Exawatt from source
        </h1>
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
          Exawatt is a Mac app for running several coding agents at once and
          seeing what each one is doing, what it needs from you, and what it
          costs. The source is public. Build it and the app is yours to run,
          with no account and no Exawatt service behind it.
        </p>

        <section className="mt-10 rounded-lg border bg-card p-5">
          <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-foreground">
            <code>{'pnpm install\npnpm electron:build:dir'}</code>
          </pre>
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Fact label="Requires" value="macOS, Node 22" />
            <Fact label="Architecture" value="Apple silicon" />
            <Fact label="Output" value="release/mac-arm64" mono />
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            The build lands as{' '}
            <code className="font-mono text-foreground">
              Exawatt Community.app
            </code>
            . Drag it to Applications, or run it where it is. There is no Intel
            or universal build.
          </p>
        </section>

        <section className="mt-14">
          <h2 className="text-lg font-semibold tracking-tight">
            What a community build is
          </h2>
          <dl className="mt-6 space-y-6">
            <Point term="No Exawatt services">
              There is no account to sign in to, no project sync, no Session
              labels or summaries, no leaderboard, and no analytics. A community
              build declares none of those capabilities, so the code that would
              call them has nothing to call.
            </Point>
            <Point term="Demo Mode and your own agents">
              Demo Mode runs the whole interface against a synthetic workspace,
              with no agents and no network. Otherwise it runs the agent
              harnesses you already have installed, under your own logins.
            </Point>
            <Point term="Its own identity">
              The app is named Exawatt Community and keeps its own bundle id and
              its own settings, so it runs beside an official build rather than
              over it.
            </Point>
            <Point term="Not signed, not notarized">
              The build carries no Apple Developer ID signature, no Apple
              notarization, and no Exawatt release identity. Nothing about the
              binary is attested by Apple or by Exawatt. You built it, and the
              source it came from is what vouches for it.
            </Point>
          </dl>
        </section>

        <section className="mt-14">
          <h2 className="text-lg font-semibold tracking-tight">
            Official builds are a separate distribution
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Official signed builds come from exawatt.ai. They carry
            Exawatt&rsquo;s Developer ID signature and Apple notarization, read
            Exawatt&rsquo;s update feed, and reach Exawatt&rsquo;s hosted
            services. None of that travels with the source, which is the point
            of the split: a build anyone can compile can never be mistaken for
            one Exawatt signed.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            The license gives you the code. It does not designate your build an
            official release, and it grants no rights in the Exawatt name or
            mark. See <External href={LICENSING_URL}>LICENSING.md</External> for
            the license boundary and{' '}
            <External href={TRADEMARKS_URL}>TRADEMARKS.md</External> for the
            name.
          </p>
        </section>

        {/* The distribution is stated, not resolved: this page describes the
            build you compile from source, which is a community build even when
            an `official-web` composition is the tree serving the page. */}
        <MachineDisclosures distribution={COMMUNITY_DISTRIBUTION} />

        <footer className="mt-14 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-6 text-xs text-muted-foreground">
          <External href={GITHUB_URL}>Repository</External>
          <External href={LICENSING_URL}>Licensing</External>
          <External href={TRADEMARKS_URL}>Trademarks</External>
        </footer>
      </div>
    </main>
  );
}

function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-chrome-meta text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-sm text-foreground ${mono ? 'font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function Point({
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

function External({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2 hover:text-foreground"
    >
      {children}
    </a>
  );
}
