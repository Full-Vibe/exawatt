# 0047 The fleet story becomes the homepage

Date: 2026-10-14
Status: accepted 2026-10-14; implemented in ENG-031 W15m; amended 2026-10-21 (W31: `/old` deleted)

**The homepage study's fleet story replaces the band stack on `/`.** The
story at `/hud-gallery/homepage-study` (ENG-031 W15 to W15l) is one pinned 3D
world told in five scenes: ten agents, one agent, the ten that need you, a
hundred, then the whole fleet with the download over it. It becomes the
homepage. The band stack that `/` and `/v2` render today moves to `/old`.

## Context

The study was commissioned to launch. The operator's 2026-10-08 brief asked
for options he could "check on a web page, refine together, and launch".
Eleven refinement passes later (W15b to W15l) he called it: "okay now I feel
like I'm ready to promote this to the actual homepage... ask me a couple
questions ahead of putting this up onto / . (We should keep existing for a
while on /old or somethnig)."

A research pass covering the market, the people the page speaks to, the
homepage copy of more than twenty adjacent products, and the repo's own
homepage canon fed four questions. He answered them on 2026-10-14. The answers
are below.

Promoting the study is not a copy swap. The homepage canon was written for
the band stack: five of its rules describe a different page, and one record
withheld promotion. Each is named under "What this reverses".

## Decision

1. **`/` renders the fleet story.** The band stack moves to `/old`. It stays
   reachable and stays out of search: noindex and out of the sitemap. `/v2` is
   deleted, not redirected (burn bridges). The study page stays as the place
   the operator tunes the story. W15m moves the experience into production code
   and keeps the study as a control bar over that same component, so the two
   cannot drift.
2. **Scroll is Page mode: one scene per gesture.** A wheel gesture inside the
   story is taken and turned into one move to the next scene. Arrow, page and
   space keys page the same way. On a touch screen, each scene is a mandatory
   snap point that a flick cannot skip, and the footer is one more. Everything
   else is left alone (W15g): pinch zoom, horizontal swipes, anything under the
   pointer that scrolls itself, and keys typed into a field. Asked to choose
   between Page, a native scroll that settles on the nearest scene, and plain
   native scroll, the operator answered: "I think 1; can I test 2 in the
   study?" Soft mode is that second option. It stays in the study for him to
   compare and may replace Page later.
3. **The material is Gummy**, "but I may switch to acrylic if gummy is too
   distracting / cute". The study keeps every material so the switch costs a
   default.
4. **The copy leads with scale, and speaks first to someone who already runs
   several agents and wants more** (marketing canon, working ICPs,
   2026-10-14).
   - Landing title: "Control 500 agents like you control 5."
   - Landing line: "Every agent, every harness, every project in one Mac app.
     See what each one is doing, which ones need you, and what it spends."
   - Close: "Ten today. Ten thousand tomorrow." Beside the button: "Free and
     open source. Works with the plans you already pay for."
   - Buttons: Download for Mac, with the requirement line under it. Add your
     harness links to CONTRIBUTING's adapter lane.
   - The three middle scenes keep the study's canon copy.
   - Amended on his later rounds the same day (W15o, W15p): the landing title
     is "Scale your agent fleet." over "Exawatt is the command surface for
     every agent you run."; the close is "Fleet command for thousands of
     agents." over the reassurance line; the buttons are Download for Mac and
     View on GitHub side by side, with no requirement line and no Add your
     harness. Project doc `website-overhaul.md` → "W15o", "W15p".
5. **Four concept harness marks join the synthetic fleet: Grok Bot, Muse,
   Instinct and dots.** Exawatt cannot run any of them today, and the
   vendors' brand terms do not grant the use. xAI and OpenAI forbid altered
   marks, and Meta and Instinct publish no permission. Both points were put to
   the operator once. He accepted both, 2026-10-14: "that's fine, it's on the
   roadmap. Homepage is aspirational and illustrative and I'll add support for
   them soon."
   - The fleet keeps its "Demo workspace · synthetic fleet" label, so the
     marks illustrate breadth inside a fleet the page already calls synthetic.
   - Adapter work is captured under ENG-003, unshaped pending a design pass.
   - Each mark's provenance is recorded in `LICENSES/brand/harness-marks.md`
     when the marks land.
   - Amended the same day: the label went in W15o ("useless, doesn't support
     any of our goals"), and in W15p two Grok Bots joined the first Project
     ("add in a couple of Grok Bot agents"), drawn in xAI's own mark from the
     Grok Bot page.

## What this reverses

Each rule below remained true of the band stack at `/old`, and stopped
governing `/`. Since `/old` was deleted (2026-10-21, amendment below), the
band-only rules govern nothing.

| Rule                                                                                            | Where it lives                                                                                                                                                                                                                                                                                   | What `/` does instead                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No scroll-jacking: native scroll, no wheel handler, no `preventDefault`, no `scrollTo`          | 16-site constraint, `projects/website-overhaul.md:62-63`, `docs/product/marketing.md:1084-1086`; W4 `website-overhaul.md:2031-2035` and `src/components/site/bands/pinned-board-sequence.test.tsx:189-203`; kept by W9 and W12 (`roadmap.md:9006`, `roadmap.md:9017`, `website-overhaul.md:680`) | Page mode, above. Native snap cannot give one scene per gesture on a Mac trackpad: the momentum belongs to the system, and the browser lets it carry the page past the next snap point (W15g). The study's own record called this "a study-only choice". This decision makes it the choice for `/`.                                                  |
| Mobile does not snap; reduced motion snaps nothing                                              | W9, `website-overhaul.md:1248-1253`                                                                                                                                                                                                                                                              | Touch snaps once per scene, mandatory, with `scroll-snap-stop: always` (amended the same day, W15o: the story pages a finger itself, because the native snap misbehaved on an iPhone). The 2026-08-17 reduced-motion path (no snap, a frozen poster) does not carry over by default. W15m defines and records the fleet story's reduced-motion path. |
| The zoom only goes one way                                                                      | W9, `website-overhaul.md:1154`                                                                                                                                                                                                                                                                   | The story goes in and back out on purpose: fleet, one agent, then ten, a hundred and the whole fleet. Operator, 2026-10-12: "zoom in and cut the count down to just one... zoom out and subsequently pop up 100".                                                                                                                                    |
| The phone stacks; it does not shrink                                                            | `docs/product/marketing.md:1331-1347`                                                                                                                                                                                                                                                            | One pinned experience on every screen (W15f, `website-overhaul.md:3131-3139`). The reading column sits at the foot of the stage or over its top, and the camera frames the subject clear of it.                                                                                                                                                      |
| Neither homepage study authorizes promotion                                                     | Amendment chain, `roadmap.md:8937`; W21, `website-overhaul.md:2972-2973`; the terrain study as the review hypothesis, `docs/product/marketing.md:7-27`                                                                                                                                           | The operator selected W15 for `/`. The terrain study (W16 to W21) stays a gallery study.                                                                                                                                                                                                                                                             |
| The hero budget: `frameloop="demand"`, `antialias: false`, a frozen poster under reduced motion | `website-overhaul.md:226-249`                                                                                                                                                                                                                                                                    | The world is alive on purpose: agents drift, wander and wave, so it renders every frame while on screen and nothing while off it. The DPR cap of 1.5 stays, as do DOM text as the first paint and a canvas that is never the LCP element.                                                                                                            |

## Consequences

- The band stack keeps its native-scroll test and its contract at `/old`
  until it is retired. Retiring `/old` is a later call, once nobody needs it
  for comparison.
- Every eval and test that loads `/` follows the new page. W15m owns that
  migration, including the footer link the paint and typography evals click.
- The homepage now carries a non-passive wheel listener inside the story.
  W15g keeps the wheel and key listeners in Page mode only, so the other modes
  keep the browser's off-thread scroll.
- W15m gives the homepage its own title, description and link-preview image,
  replacing the inherited "Power your AI agents".

## Not decided here

- Whether Soft replaces Page on `/`, and whether Acrylic replaces Gummy. Both
  are the operator's to call after living with the page.
- When `/old` is retired. Decided 2026-10-21; see the amendment below.
- Any change to pricing, the waitlist or the account question in front of the
  download. Those stay as marketing canon records them.

## Amendment (2026-10-21, ENG-031 W31)

**`/old` is deleted, with no redirect** (operator, 2026-10-21: "Delete
/old"). The band stack, the studies that existed only for it
(`/hud-gallery/fold-close` and `/hud-gallery/altitude-scroll`) and the band
components went with it. The proxy keeps `/old` outside the auth gate beside
the other retired addresses, so a signed-out visitor gets the 404 rather than
a sign-in page. The hero board stays: its own study and eval rig still render
it.
