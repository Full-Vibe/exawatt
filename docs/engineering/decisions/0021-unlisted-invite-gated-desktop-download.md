<!-- Generated for the public repository by the "public-document-set" recipe. -->
# 0021 Distribute the desktop app through an unlisted invite-gated page

Date: 2026-07-24
Status: superseded in part — the gate is retired (2026-08-14); the trust surface continues

## Amendment (2026-08-14): the page is public now

Operator decision, pulled forward from the launch moment: `/download` is
**public**. Anyone with the URL takes the build, with no code and no wall. The
trigger was ordinary support: an external user needed a working build and the
only link that existed cost an invite slot to hand out.

## Context

Decision `0009`: `electron-updater` reads the update feed anonymously from
every installed Mac. The macOS artifacts are therefore already anonymously
fetchable by anyone who knows the object URL.

## Decision

- The gate is an invite code, not an account. Invitees have no Exawatt account
  yet, and sending them to `/sign-in` would break the flow. `/download` is
  therefore a public prefix in `src/proxy.ts`.
- **Be explicit about the security property.** The gate controls *discovery and
  attribution*: who is handed a working link, and who is recorded as having
  taken the build. It is **not** access control over the binary. The redemption
  endpoint redirects to the same public object the updater reads, so
  anyone with that URL can still fetch it without a code. Copy on the download
  page and the operator view must not imply otherwise.
- The advertised version, release date, and size are read from the same
  `latest-mac.yml` the installed app updates from, so the page can never
  advertise a build the updater would not also see. The page links the DMG a
  person installs, not the updater's ZIP.
- The page is a trust surface, not a conversion surface. It states plainly that
  Exawatt spawns unsandboxed local agent processes running as the user, reads
  harness transcripts under `~/.claude/projects` and `~/.codex/sessions`,
  triggers macOS folder-access prompts attributed to Exawatt, and forwards
  short Session excerpts for Session labels when that hosted capability is
  configured and enabled. CORRECTED 2026-08-18: this bullet said "with no
  opt-out yet", which OS1.5 made false when it gave context labels their own
  switch on the Privacy surface. A stale privacy claim is worse published than
  unpublished, and this document is public-bound, so it is fixed at the source
  rather than in the rendered variant. The page adds no tracking pixel and no
  third-party script. CORRECTED 2026-08-18: it also said "No analytics", which
  decision `0034` made false for the hosted site the moment the proxied ingest
  shipped. `/download` is an ordinary page of `www.exawatt.ai`, so
  `instrumentation-client.ts` initializes the same content-excluding four-event
  stream there as everywhere else, relayed through `exawatt.ai/ingest`. What
  the page still does not add is anything of its own.
