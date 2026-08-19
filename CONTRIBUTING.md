# Contributing to Exawatt

**TL;DR: Start from an accepted roadmap outcome, keep the change cohesive, and prove it works in the affected runtime.**

Thank you for helping improve Exawatt. The project welcomes focused
contributions that advance an accepted product outcome without weakening Demo
Mode, local Agent operation, or the community/official distribution boundary.

## Good first contribution lanes

The day-one lanes are:

- Agent Source and harness adapters;
- the roadmap parser, roadmap convention, diagnostics, and conformance
  fixtures;
- Demo Mode and test or evaluation infrastructure;
- roadmap-approved defects, performance work, documentation, and guides.

For a small defect or documentation correction, open or claim an issue. For a
new capability, behavioral change, or broad refactor, begin with a public issue
or Discussion and wait for the outcome to be accepted into the roadmap. This
keeps proposals cheap and implementation focused.

## Product and design locks

Exawatt is operator-led. Information architecture, design-system primitives,
canonical product vocabulary, and major product surfaces are design-locked.
A contribution may propose a change to one of those areas only after a public
design issue is accepted.

Before changing a product surface, read
[`docs/engineering/design-system.md`](docs/engineering/design-system.md). New or
materially changed cross-surface visual states are prototyped in `/hud-gallery`
before production wiring. Before editing anything rendered under a React Three
Fiber `<Canvas>`, also read
[`docs/engineering/r3f-authoring-guide.md`](docs/engineering/r3f-authoring-guide.md).

The canonical product vocabulary is in
[`docs/product/concepts.md`](docs/product/concepts.md). Architecture changes
must keep [`docs/engineering/architecture.md`](docs/engineering/architecture.md)
and `src/lib/architecture/manifest.ts` aligned.

## Development setup

Exawatt supports macOS for its first public release.

1. Install the Node.js version declared by the repository and enable Corepack.
2. Run `pnpm install`.
3. For Electron work, run `pnpm electron:rebuild` once, then
   `pnpm electron:compile`.
4. Run the web app with `pnpm dev` or Electron with `pnpm electron:dev`.

A community checkout must build and run Demo Mode and local Agent Sources
without an Exawatt account, private repository, or Exawatt service variables.
Do not copy credentials or environment files from another checkout.

## Make a contribution

External contributors use pull requests. The Project Lead and authorized
maintainer agents may land directly through the repository delivery queue.

1. Fork the repository and branch from current `master`.
2. Link the accepted issue or roadmap item in the pull request.
3. Keep code, tests, public architecture, and roadmap state consistent.
4. Add the smallest test that would have caught the defect or proves the new
   contract.
5. Run the checks proportional to the change and record the exact evidence.
6. Complete the Contributor License Agreement check.

The ordinary verification floor is:

```sh
pnpm type-check
pnpm test:run
pnpm electron:compile
pnpm community:check
```

Run targeted runtime evaluations for the surface you changed. UI changes need
before/after visual evidence and keyboard/accessibility checks. Distribution,
auth, analytics, update, or hosted-boundary changes must demonstrate both the
community contract and the configured-distributor contract. R3F changes must
run `pnpm eval:r3f` and a screenshot self-check.

## AI-assisted contributions

AI-assisted work is welcome, but the human contributor remains responsible for
its correctness, licensing, provenance, security, and review.

In the pull request:

- name the AI tools used and summarize what they produced or changed;
- disclose any generated code, tests, documentation, images, or other assets;
- confirm that you reviewed the complete diff and can explain it;
- identify sources or prompts needed to establish asset and code provenance;
- never submit secrets, private conversations, proprietary code, personal
  data, or output copied from a source you cannot redistribute.

AI disclosure is evidence, not a substitute for tests or understanding.

## Licensing and provenance

Application contributions are accepted under the repository's
AGPL-3.0-or-later terms. Compatibility specifications, schemas, examples, and
conformance fixtures identify their Apache-2.0 scope in the repository's
license notices. See `LICENSE`, `LICENSES/`, and
[`CLA.md`](CLA.md) before contributing.

Contributors retain copyright in their work. The CLA grants Full Vibe AI the
rights needed to keep the contribution open source and offer alternative
commercial licenses; it is not a copyright assignment.

**How to accept it.** Open a pull request that adds your GitHub login to
`.github/cla-signatures.json`, and say in the description that you have read
and accept `CLA.md` at the version recorded there. A maintainer merges it, and
the CLA check passes on your next push. There is no bot and no third-party
service: your acceptance lives in this repository's history, where it survives
any service going away, and no external application holds write access to the
organization.

Do not add a dependency or asset without recording its source, author,
license, modification status, and distribution basis. Do not paste code from
another project without preserving all notices and proving compatibility.

## Review and acceptance

Maintainers judge a change against the accepted outcome, architecture,
security and privacy boundaries, user experience, tests, runtime evidence,
maintenance cost, and license/provenance record. Passing CI is necessary but
does not require acceptance. Maintainers may ask that an oversized pull request
be split or that a proposal return to design discussion.

Be respectful and follow the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Use
[`SUPPORT.md`](SUPPORT.md) to choose the right public channel and
[`SECURITY.md`](SECURITY.md) for private vulnerability reporting.
