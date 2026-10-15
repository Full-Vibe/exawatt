# 0048 Homepage copy editing belongs in a bounded admin surface

Date: 2026-10-14
Status: accepted; deployed in ENG-031 W22, authenticated publication verification pending

**Two authorized editors may draft, preview, and publish homepage copy from `/admin/homepage` without an approval step.**

## Context

The homepage already has five scenes with line-addressable headline and body
copy in `src/components/site/fleet-story/stages.ts`, plus two code-defined copy
sets in the homepage study. A collaborator needs to see the live words without
copying them out of the site, try several alternatives, and write into them.
The operator chose a custom page under a broader `/admin` layout and limited
the first pass to copy, including button labels.

The existing private `isAdminEmail` allowlist also authorizes download invites
and classifies feedback into the operator lane. Adding a copy collaborator to
that list would grant unrelated authority. Official hosted service code and
private identities belong in the company overlay (decision `0036`).

## Decision

- Establish an authenticated `/admin` shell with capabilities per tool. The
  homepage editor has its own server-owned `site-editor` grant, initially for
  the operator and one collaborator. Signed-in alone grants nothing. The
  existing invite and feedback authority is unchanged.
- `/admin/homepage` is a line-by-line editor populated from the current
  published homepage. Editors can save named alternatives, open a real-page
  preview, and deliberately publish any saved alternative. Either authorized
  editor can publish; there is no approval queue. Every publication records
  who published it and retains a restorable previous version.
- The first content boundary is the five story scenes' kicker/headline/body
  lines and homepage button/link *labels*. Destination URLs, visual/story
  controls, shared site navigation and footer, legal text, and product data
  stay code-owned. The public page reads only the published version. The study
  remains a visual workbench, not a second copy authority.
- The hosted content store and membership checks stay behind the private
  company service boundary. Community builds keep the checked-in copy and
  expose no publishing capability. The published page's HTML and metadata
  derive from the same version; its social image must not freeze old words.

## Consequences

The editor is a small content workflow, not a general page builder or a new
CMS vendor. A later proposal to edit stage order, interaction, or story
settings requires its own bounded schema and review; this decision does not
turn arbitrary stage configuration into writable content.

ENG-031 W22 owns the delivery sequence and acceptance criteria. Actual account
identifiers are private configuration, never public documentation or client
state.
