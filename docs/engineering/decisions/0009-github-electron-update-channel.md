<!-- Generated for the public repository by the "public-document-set" recipe. -->
# 0009 Deliver signed desktop updates through a public artifact channel

Date: 2026-07-10
Status: accepted; amended 2026-07-20

## Context

Decision `0008` made the renderer part of the installed desktop artifact and
named `electron-updater` as the successor to the local dogfood copy command.
Product delivery now needs a concrete signing, notarization, feed, rollout, and
restart contract. The app still owns local PTY processes, so an updater must
never silently restart it while sessions are live.

## Decision

- Direct macOS distribution uses a Developer ID Application certificate,
  hardened runtime, Apple notarization, and stapling. Release CI fails if code
  signing is unavailable. Tag releases default to a pinned macOS 15 runner so
  GitHub's moving `macos-latest` alias cannot silently change the codesign
  toolchain. Manual recovery may select the pinned macOS 26 runner when Apple's
  timestamp service is unreachable from the default runner image.
  CI retries a clean release build at most three times when Apple's timestamp
  or notarization service is transiently unavailable; it never drops secure
  timestamps or notarization to make a release pass.
- If Apple timestamp requests fail from every hosted runner but succeed on the
  release operator's Mac, the manual workflow may consume a private GitHub
  Release asset containing the locally Developer-ID-signed app. CI verifies the
  app and hidden renderer signatures and timestamps, notarizes and staples the
  app, rebuilds the distribution containers, runs the normal release checks,
  publishes, and deletes the temporary private asset.
- The private `Full-Vibe/exawatt` GitHub Release remains the source-linked CI
  archive. It cannot be the installed app's feed: anonymous clients receive
  `404`, while a private GitHub updater would require a reusable repository
  token on every Mac.
- A public Supabase Storage bucket is the initial product update host.
  `electron-builder` produces the arm64 DMG, update ZIP, blockmaps, and
  `latest-mac.yml`; CI uploads immutable artifacts first and mutable metadata
  last. `electron-updater` uses the generated generic HTTPS provider config.
  The app never receives a Supabase service-role key.
- App Store Connect API-key credentials are preferred for CI notarization.
  CI receives certificates and Apple credentials only through GitHub Actions
  secrets.
- The standalone renderer remains a content-addressed archive. Release builds
  open that archive after the CI certificate is imported, Developer-ID-sign
  and verify every native `.node` and `.dylib` with a secure timestamp, then
  reseal the archive and hash before the enclosing app is signed. A native
  binary hidden from the signing pass fails the release.
- Update metadata may carry `stagingPercentage`. The release workflow edits
  YAML through a parser and validates the result before publishing.
- The app downloads an eligible update but sets `autoInstallOnAppQuit` false.
  Applying it requires the explicit **Restart when convenient** command, which
  states how many live sessions will stop. Update failure leaves the current
  app launchable.
- The agent-closeout installer remains a development escape hatch and never
  becomes the customer update feed. AMENDED 2026-07-19: D17 replaces its
  identity-null/ad-hoc app with a stable, verifiable Exawatt signing identity so
  identity-based local policy survives clean-`master` refreshes. The local path
  need not become a notarized distribution channel, but it must fail explicitly
  rather than silently install an identity-unstable fallback. Private signing
  material stays outside the repository and logs. The noninteractive local
  source is a valid Developer ID Application identity in the macOS Keychain.
  The public Exawatt Team Identifier is pinned in the delivery policy; only a
  Developer ID Application identity from that Team is eligible. Exactly one
  eligible identity is selected automatically; multiple eligible identities
  require an exact SHA-1 fingerprint through a process environment override.
  A certificate for another Team is never accepted merely because it is the
  only Developer ID identity available. The transaction resolves the eligible
  identity once and pins its fingerprint into the detached build, so a Keychain
  change cannot switch signers mid-delivery. The build signs archived native
  renderer code before electron-builder signs nested helpers and the enclosing
  app. A strict identity evaluator requires the program and Team identifiers,
  code-directory hash, secure timestamp, hardened runtime, nested code, and
  archived native code before smoke testing or installation.
- AMENDED 2026-07-20: local dogfood delivery is one recoverable transaction,
  not a build followed by unrelated copy commands. It captures one clean
  committed source SHA, builds it in a detached immutable git worktree, embeds
  that SHA, and rechecks the source checkout before installation. A
  repository-scoped lock coordinates `agent:land` with manual installers so
  the shared `master` checkout and remote integration cannot advance during an
  active delivery; a target-scoped lock also protects the global installed app
  from separate clones. Existing installs are replaced with macOS's atomic
  same-volume `RENAME_SWAP`, leaving the previous bundle at the transaction
  path until the new installed bundle passes strict verification. Startup
  recovery deterministically keeps, restores, or completes the one verified
  bundle after interruption. Unsigned legacy apps may migrate once, but an
  uninspectable app or stable signer mismatch is left untouched.
- The first release target is arm64, matching the operator's current Mac and
  the project's build-one-mile rule. Intel/universal artifacts are added before
  supporting Intel customers rather than blocking current dogfood activation.
- macOS update delivery requires an Electron line containing Squirrel.Mac's
  launchd helper-activation fix (Electron 42 or later; Exawatt activated on
  Electron 43). Older lines can leave ShipIt registered but unstarted on macOS
  26 while a system update is pending. Exawatt does not add a LaunchAgent or a
  product-level `launchctl` workaround.
- `electron-builder` resolves the exact Electron runtime into its managed cache.
  Release configuration does not point `electronDist` at pnpm's optional
  `node_modules/electron/dist` directory because a clean CI install may not
  materialize that directory.

## Activation evidence

Repository administrators provided the required release secrets:

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_API_KEY_P8`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `SUPABASE_SERVICE_ROLE_KEY`

The gate is satisfied. `v0.1.2` and `v0.1.3` passed Developer ID signing, secure
timestamps, Apple notarization, deep codesign, Gatekeeper assessment, and
stapler validation. An independently downloaded `v0.1.2` discovered, downloaded,
verified, and installed `v0.1.3`, warned that one live PTY would stop, and
relaunched automatically without manual helper activation. Failure-state tests
keep the current installed app launchable and expose retry instead of replacing
the bundle.

## Consequences

- Release versions are real SemVer product state; a tag must exactly match
  `package.json`.
- Supabase Storage availability and public CDN egress are part of initial
  update delivery. CI keeps only the latest three artifact versions while the
  private GitHub Release remains the source-linked archive.
- Normal update checks never require a secret on the user's machine.
- Local dogfood refreshes preserve one Exawatt code identity for tools such as
  Little Snitch without importing, weakening, or modifying user firewall rules.
  Harness executables retain their own identities and policy boundaries.
- Concurrent agent closeout cannot mix source revisions or mutate the shared
  checkout under a running build. A failed build, signature check, swap, or
  post-swap verification retains a verified prior app or a recoverable rollback
  object; it never installs a partially copied bundle.
- ENG-018 coordinates explicit checkpoint, process stop, update install, and
  logical Session rehydration. PTYs remain inside the app process (decision
  `0012`).
