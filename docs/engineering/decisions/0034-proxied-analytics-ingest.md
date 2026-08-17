<!-- Generated for the public repository by the "public-document-set" recipe. -->
# 0034 Analytics ingest reaches PostHog only through an Exawatt-owned proxy

Date: 2026-08-06
Status: accepted — implemented in ENG-030 OS1.1; community isolation is OS4

## Context

Decision `0031` accepted default-on PostHog for official production
distributions and OSS production builds, over a public content-excluding event
allowlist, with a real off switch and a configurable host and project key. It
assumed the ordinary integration shape: the client initializes PostHog against
a PostHog host, which a distributor may redirect.

That shape is correct for a website. It is wrong for this desktop app, for a
reason the web-only projects in the same portfolio do not have.

Exawatt ships as a signed macOS application that spawns unsandboxed local agent
processes. Its users run identity-based firewall tooling — that is not
hypothetical, it is the operator's own setup, and ENG-016 D17 exists solely to
keep Exawatt's code identity stable so Little Snitch rules survive a rebuild
(incident `0002` records the diagnostic cost when that identity moved). A new
third-party hostname appearing in the app's outbound connections would surface
as a firewall prompt on a user's machine, attached to an app whose `/download`
page makes a deliberate point of stating plainly what it does on that machine.
An analytics vendor's domain appearing there — unannounced, in a tool the user
was invited to trust — is a trust cost out of all proportion to the telemetry's
value.

The operator's framing (2026-08-06): the client should look like it is talking
to a heartbeat endpoint, using the same proxy pattern already used elsewhere in
the portfolio.

## Decision

The client reaches PostHog **only** through an Exawatt-owned reverse proxy. The
desktop application's sole analytics destination is `exawatt.ai`.

- The proxy is a rewrite from an Exawatt-owned path to the PostHog ingest and
  asset hosts. This is the same mechanism the sibling Full Vibe projects use;
  Exawatt differs only in that the desktop renderer is served from a
  package-local origin, so its ingest path must resolve to the hosted origin
  rather than to the loopback server.
- The client is never configured with a PostHog hostname in ordinary builds.
- Decision `0031`'s requirements survive **unchanged in substance**: one
  public versioned event allowlist; no autocapture, session replay, prompt or
  response capture, terminal content, source code, repository or Project names,
  paths, filenames, diffs, task text, credentials, environment values, or raw
  source/Session identifiers; a documented runtime opt-out and build switch
  that suppresses initialization and emission rather than merely dashboard
  ingestion; anonymous installation identity kept distinct from account
  identity; and a repository-carried outbound-data manifest.
- **The configurable sink survives.** A downstream or self-hosting distributor
  can still disable, redirect, or self-host analytics without patching product
  code. Only the *default* changes: it becomes Exawatt's own proxy instead of
  a PostHog host.

## Consequences

- The outbound-data manifest must describe the proxy explicitly. Proxying is
  not concealment: the rewrite is in open-source configuration, the destination
  is named in the manifest, and the Privacy page states that analytics are
  relayed to PostHog through Exawatt. A reader of the source can see exactly
  where events go. What the proxy buys is a stable, single outbound identity on
  the user's machine — not deniability.
- Analytics availability is now coupled to `exawatt.ai`. This is acceptable
  because emission is already required to be non-blocking; a proxy outage
  costs telemetry, never product behavior.
- Ad-blocker and firewall breakage of first-party ingest drops substantially,
  which will make early volume look higher than a direct integration would.
  Do not read that as growth.
- The Privacy page's current claim that Exawatt does "not use advertising or
  third-party analytics cookies" becomes false the moment this ships, and must
  change in the same release (ENG-030 OS1.4). Principle 4 makes that a blocker,
  not a follow-up.
