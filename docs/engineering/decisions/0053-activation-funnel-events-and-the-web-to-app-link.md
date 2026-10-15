# 0053 Activation funnel events, and one anonymous web-to-app link

Date: 2026-10-14
Status: accepted — operator decision; execution is ENG-047; amends decisions `0031` and `0036`

## Context

Decision `0031` made PostHog default-on in official distributions behind one
public, versioned event allowlist, with no DOM autocapture, no session replay,
and the rule that "anonymous installation identity stays distinct from account
identity unless a later, disclosed decision explicitly joins them". ENG-030 R9
and decision `0036` chose no additional telemetry for the first month. The
allowlist holds four events; nothing records a page view, a download, a first
Project or a first Agent, and a website visitor and an app install are never
linked.

On 2026-10-14 the operator said he is "having a lot of conversations with a
lot of people this week promising some features and I want to see what their
behavior is and where they get stuck", and chose, from four options, the
funnel with a web-to-app link and without session replay.

## Decision

1. **The allowlist grows by a bounded activation set**, each event with
   named properties and nothing else:
   - `page_viewed` (web): `path`, `referrer_host` (hostname only), nothing
     from the query string; UTM and click ids stay stripped.
   - `download_requested` (web, server side on `/download/artifact`):
     `platform`, `arch`.
   - `project_opened` (desktop): `source` (`suggested`, `browse`, `import`,
     `recent`, `connect`), `harness_hint` (which harness's store suggested it,
     if any), `bound` (folder or folderless). Never a name or path.
   - `agent_launched` (desktop): `harness`, `placement`, `permission_mode`,
     `first_for_install` (boolean). Never a task, model string outside the
     catalog id, or Project.
   - `agent_directed` (desktop): `recipients` (count), `delivered` (count).
   - `return_day` is derived in PostHog from `app_launched`, not sent.
   First launch is the first desktop `app_launched` per installation id;
   BUG-171 (the opt-out and the id must live in the Electron settings store so
   a fallback-port launch does not mint a new id) is a prerequisite, not an
   option.
2. **One anonymous join, by the user's own click.** After a download, the
   download page offers "Open Exawatt" as `exawatt://welcome?w=<web distinct
   id>`; when the installed app receives it, it records a PostHog alias from
   the web id to the installation id. No download token rides the DMG, nothing
   is read from the clipboard, and nothing joins without that click. The
   account identity (Supabase user) stays unjoined, as `0031` requires.
3. **What stays out:** session replay on either surface, autocapture,
   heatmaps, feature flags, names, paths, task text, model strings outside
   catalog ids, and any event in a community build.
4. **Disclosure moves with the code, by construction.** The outbound-data
   manifest, the Privacy page and their tests change in the same landing as
   `events.ts` and `redact.ts`; the deep link is disclosed on the download
   page beside the button.
5. **A dashboard is part of the deliverable.** PostHog carries one funnel
   (visit, download, first launch, first Project, first Agent, day-2 return)
   and one "stuck" view (installs with a launch and no Project; Projects with
   no Agent; Agents launched and no second launch), so the operator reads
   behavior rather than events.

## Consequences

- `0031`'s controls, proxy and allowlist mechanics stand; its event set and
  the identity-join sentence are amended by this record.
- `0036`'s "no additional telemetry" for the first month is amended for this
  bounded set.
- ENG-047 owns execution; ENG-046's on-ramp emits `project_opened` and
  `agent_launched` from its first landing so the funnel reads the cohort the
  operator is talking to this week.
