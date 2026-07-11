<!-- Generated for the public repository by the "public-document-set" recipe. -->
# 0009 Deliver signed desktop updates through a public artifact channel

Date: 2026-07-10
Status: accepted

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
- The agent-closeout installer remains a development escape hatch and keeps
  forcing signing/notarization off. It never becomes the customer update feed.
- The first release target is arm64, matching the operator's current Mac and
  the project's build-one-mile rule. Intel/universal artifacts are added before
  supporting Intel customers rather than blocking current dogfood activation.

## Activation gate

The code and workflow are active only after repository administrators provide:

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_API_KEY_P8`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `SUPABASE_SERVICE_ROLE_KEY`

The first `v<package-version>` release must pass `codesign`, Gatekeeper
assessment, stapler validation, install/update from the previous signed build,
and failure rollback before D7 is fully landed.

## Consequences

- Release versions are real SemVer product state; a tag must exactly match
  `package.json`.
- Supabase Storage availability and public CDN egress are part of initial
  update delivery. CI keeps only the latest three artifact versions while the
  private GitHub Release remains the source-linked archive.
- Normal update checks never require a secret on the user's machine.
- Session-preserving background replacement remains ENG-018; explicit restart
  is truthful until PTYs live outside the app process.
