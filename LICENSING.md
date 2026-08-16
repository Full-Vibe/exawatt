# Exawatt licensing

Exawatt uses a narrow, path-based license boundary.

## Default: application and implementation

Except for the paths listed below and third-party material identified in
`THIRD_PARTY_NOTICES.md`, this repository is licensed under
**GNU Affero General Public License v3.0 or later**
(`AGPL-3.0-or-later`). The complete unmodified version 3 text is in
`LICENSE`.

This default includes the desktop and web application, Electron main process,
reusable implementation packages, tests, evaluation harnesses, build tooling,
and generated implementation bindings. Generated files inherit the license of
their target implementation unless their generated header says otherwise.

## Apache-2.0 compatibility material

The following compatibility material is licensed under the
**Apache License 2.0** instead:

- `docs/product/reference/roadmap-convention.md`
- `contracts/**`
- `schemas/**`
- `examples/compatibility/**`
- `fixtures/conformance/**`

The complete unmodified text is in `LICENSES/Apache-2.0.txt`. A directory
that does not yet exist is reserved here so future compatibility material
lands under the intended license without widening the grant to ordinary test
fixtures or application code. In particular, `**/fixtures/**` and
`src/**/contract.ts` are **not** blanket Apache carve-outs.

JSON cannot carry comments, so files under `contracts/**` rely on this
path-level declaration. Markdown specifications carry an SPDX header where
their format permits it.

## Standard-text provenance

The license texts are unmodified primary-source copies:

- `LICENSE`: <https://www.gnu.org/licenses/agpl-3.0.txt>,
  SHA-256 `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`
- `LICENSES/Apache-2.0.txt`:
  <https://www.apache.org/licenses/LICENSE-2.0.txt>,
  SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`

The `-or-later` choice is the SPDX expression applied to Exawatt's work; the
version 3 license text itself is reproduced verbatim.

## Third-party material

Dependencies, patched upstream code, fonts, and generated distribution
components remain under their own licenses. See `THIRD_PARTY_NOTICES.md` and
`LICENSES/third-party/`. Run `pnpm licenses:check` after dependency changes;
it fails on missing or unreviewed license expressions and on stale notices.

This document describes repository licensing; it does not grant rights in
Exawatt trademarks or designate an unofficial binary as an official build.
