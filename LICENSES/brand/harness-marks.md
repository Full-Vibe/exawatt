# Harness brand mark provenance

The agent-harness brand marks Exawatt draws are **third-party trademarks**. Each one identifies an
Agent Source Exawatt can drive. They are reproduced for **nominative use only**: to name the
third-party product a user is looking at, inside Exawatt's own UI, at 12 to 20px.

Full Vibe AI and Exawatt claim **no affiliation with, sponsorship by, or endorsement from** any of
the vendors listed below. Every mark remains the property of its owner, and any goodwill from its
use belongs to that owner.

## Where they ship

There are no brand image files in this repository. Every mark is INLINE SVG in
`src/components/workspace/harness-icons.tsx`, one component per mark, registered by Agent Source
id in `SOURCE_MARKS` and drawn through `SourceGlyph`, so nothing is fetched at runtime, nothing
needs an `id`, and the app and the marketing board draw the same geometry.
`src/components/site/harness-mark.tsx` is the adapter from an Agent Source's declared `adapterId`
to that registry.

| Component      | Harness     | Path data taken from                                                                                            |
| -------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| `ClaudeIcon`   | Claude Code | Simple Icons `claude`                                                                                           |
| `OpenAIIcon`   | Codex       | LobeHub Icons `openai` (the Blossom)                                                                            |
| `OpenCodeIcon` | OpenCode    | LobeHub Icons `opencode`, cross-checked against the vendor brand pack                                           |
| `GrokIcon`     | Grok Build  | LobeHub Icons `grok`                                                                                            |
| `OpenClawIcon` | OpenClaw    | The project's own pixel lobster, `openclaw/openclaw` (MIT), kept as authored colour because it is pixel artwork |

No mark has been redrawn. Path data is reproduced byte for byte from the origin recorded below.
The only changes applied are:

1. **Scaling.** The mark is sized from its `viewBox`; no `viewBox` was changed and no path
   coordinate was touched.
2. **Monochrome recolouring.** `fill="currentColor"`, so the mark takes the surrounding ink. On the
   marketing board that ink is one neutral label colour for every harness, which is the black or
   white rendition the vendors themselves supply. Inside the app, the Launch Configuration ribbon
   and Agent Sources settings tint the mark with the source's own identity colour.
3. **Sanitising.** Presentational `style` attributes, `<title>`, `role`, unused `<defs>` gradients
   and no-op `clip-path` wrappers were removed. No `id` attributes remain. No scripts, no external
   references.

The homepage's fleet story (`src/components/site/fleet-story/visuals/crust-marks.ts`) draws the
same path data as 3D geometry on its agent tiles. There Claude's mark is tinted Anthropic's own
terracotta (#D97757, the colour Anthropic itself draws the mark in) and OpenClaw's lobster keeps the
artwork's own pixel colours; the three marks supplied in black and white only take the surrounding
ink, as everywhere else. Recorded 2026-10-13.
(Updated the same day: for OpenClaw the study now draws the project's mascot rather than the pixel
lobster; see the OpenClaw entry below.)

**Three of these vendors forbid altering their mark, recolouring included.** They are called out
per mark below. Rendering them in one neutral ink is the closest available reading of "as
provided" on a dark surface; tinting them with a per-source identity colour, which the app's own
chrome does, is a deviation. Recorded rather than silently carried: replacing those three with
vendor-supplied fixed-colour assets, or obtaining permission, is the remedy.

The per-mark records below name the file each mark was fetched as, at the time it was fetched.

Every URL below was fetched on **2026-08-18**.

---

## Claude, `ClaudeIcon` (fetched as `claude.svg`)

- **Vendor / product:** Anthropic, PBC. Claude, and by extension the Claude Code harness. This is
  the Claude "sunburst" / asterisk glyph.
- **Origin URL:** `https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/claude.svg`
  (Simple Icons slug `claude`; Simple Icons records the brand source as `https://claude.ai`).
- **Licence of the path data:** Simple Icons is released under CC0 1.0 Universal
  (`https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md`). Its disclaimer
  (`https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md`) states: "Simple Icons
  is released under CC0 - though that doesn't mean to imply that all icons within the project are
  also CC0" and "Simple Icons cannot be held responsible for any legal activity raised by a brand,
  or users of the package. We ask that our users seek the correct permissions to use the icons
  relevant to their project."
- **Trademark terms:** Anthropic Trademark Guidelines,
  `https://www.anthropic.com/legal/trademark-guidelines`. Operative sentences: "You may only use
  our trademarks as specifically permitted by us and only in materials we approve beforehand." and
  "We will supply an image (or images) of the trademark(s) for your use and specific requirements
  regarding size, pixels, spacing, and the like. **No alterations of our trademarks (changes to
  color, font, proportion, or otherwise) are permitted.**"
- **Recolouring permitted?** **No.** Anthropic's guidelines forbid colour changes and require prior
  approval for any use. The component recolours to `currentColor`. Flagged.
- **Date fetched:** 2026-08-18.
- **Use here:** Nominative use to identify a third-party product inside a product UI, rendered at
  16 to 20px.

---

## Codex, `OpenAIIcon` (fetched as `codex.svg`)

- **Vendor / product:** OpenAI. Codex, the OpenAI coding agent. The glyph is the OpenAI "Blossom"
  logomark (the knot), which is OpenAI's symbol mark rather than a Codex-specific mark. OpenAI does
  also ship a distinct Codex product glyph; the Blossom was chosen here because it is the mark users
  recognise at icon size.
- **Origin URL:** `https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/openai.svg`
- **Licence of the path data:** LobeHub Icons is MIT licensed, "Copyright (c) 2023 LobeHub"
  (`https://github.com/lobehub/lobe-icons/blob/master/LICENSE`).
- **Trademark terms:** OpenAI Brand guidelines, `https://openai.com/brand/`. That page returns HTTP
  403 to automated fetches; its text was read on 2026-08-18 via the `r.jina.ai` text-extraction
  proxy of the same URL. Operative sentences: "The 'OpenAI' name, the OpenAI logo, the 'ChatGPT'
  and 'GPT' brands, and other OpenAI trademarks, are property of OpenAI."; under Dos: "Use the logo
  only when it directly relates to OpenAI services." and "Use the logo exactly as provided and
  acknowledge that it belongs to OpenAI."; under Don'ts: "Place the logo on tangible merchandise,
  promotional items, **or modify it in any way**." and, specifically for this glyph, "**DON'T add
  any colors to the Blossom**" and "DON'T use the Blossom as the primary branding".
- **Recolouring permitted?** **No.** OpenAI explicitly forbids adding colour to the Blossom and
  forbids modifying the logo. The component recolours to `currentColor`. Flagged. The mark is
  never used as primary branding here; it appears only beside Exawatt's own UI chrome.
- **Date fetched:** 2026-08-18.
- **Use here:** Nominative use to identify a third-party product inside a product UI, rendered at
  16 to 20px.

---

## OpenCode, `OpenCodeIcon` (fetched as `opencode.svg`)

- **Vendor / product:** Anomaly (GitHub org `anomalyco`). opencode, the open source coding agent
  CLI at `https://opencode.ai`.
- **Origin URL:** `https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/opencode.svg`
- **Verified against the vendor's own assets:** the official brand pack file
  `https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/console/app/src/asset/brand/opencode-logo-dark.svg`
  (`viewBox="0 0 240 300"`, primary path `M180 60H60V240H180V60ZM240 300H0V0H240V300Z`) and the site
  favicon `https://opencode.ai/favicon.svg`. The proportions match exactly: the counter is 0.5 of the
  outer width and 0.6 of the outer height, offset 0.25 and 0.2. The file here is that same geometry
  normalised into a 24x24 box so it sits optically with the other marks.
- **Licence of the path data:** LobeHub Icons, MIT. The upstream project is MIT licensed
  (`https://github.com/anomalyco/opencode/blob/dev/LICENSE`), and the brand assets are committed
  inside that MIT-licensed repository.
- **Trademark terms:** No brand guidelines or trademark policy document was found in the repository
  or on opencode.ai as of 2026-08-18. The vendor ships the mark in both light and dark single-colour
  variants (`opencode-logo-light.svg` / `opencode-logo-dark.svg`), so monochrome rendering is plainly
  contemplated by the brand pack itself.
- **Recolouring permitted?** No prohibition found, and the vendor's own pack is monochrome per theme.
- **Note on fidelity:** the vendor's asset carries a secondary mid-grey rectangle inside the counter.
  It is omitted here because filling it with `currentColor` would close the counter and destroy the
  mark. Both Simple Icons and LobeHub omit it for the same reason.
- **Date fetched:** 2026-08-18.
- **Use here:** Nominative use to identify a third-party product inside a product UI, rendered at
  16 to 20px.

---

## Grok Build, `GrokIcon` (fetched as `grok.svg`)

- **Vendor / product:** xAI. Grok, and the Grok Build harness. This is the Grok glyph, not the xAI
  "X" wordmark.
- **Origin URL:** `https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/grok.svg`
- **Licence of the path data:** LobeHub Icons, MIT.
- **Trademark terms:** xAI Brand Guidelines, `https://x.ai/legal/brand-guidelines`, dated
  February 14, 2025. That page returns HTTP 403 to automated fetches; its text was read on
  2026-08-18 via the `r.jina.ai` text-extraction proxy of the same URL. Operative sentences: "xAI,
  the developer of Grok, owns trademark rights, intellectual property rights, and branding rights in
  'xAI' and 'Grok', combinations of those terms, and logos."; under Do: "**Use our Marks only to
  accurately refer to us or our services.**"; under Don't: "Use our Marks in any way that is
  unrelated to us or that could misrepresent your relationship with xAI, mislead, or imply our
  endorsement, approval, or sponsorship of you or your goods or services."; and under Logos: "By
  using our logos, you agree to the Usage Terms above and further agree to **only use our logos
  exactly as provided at the download link below, without any alteration or adjustment**."
- **Recolouring permitted?** **No.** xAI requires the logo be used exactly as provided, without
  alteration or adjustment. The component recolours to `currentColor`. Flagged. Note that xAI's
  guidelines do expressly permit the nominative use this file is put to ("only to accurately refer
  to us or our services").
- **Date fetched:** 2026-08-18.
- **Use here:** Nominative use to identify a third-party product inside a product UI, rendered at
  16 to 20px.

---

## OpenClaw, `OpenClawIcon` (fetched as `openclaw.svg`)

- **Vendor / product:** OpenClaw Foundation. OpenClaw (`https://openclaw.ai`,
  `https://docs.openclaw.ai`). The glyph is the OpenClaw lobster mascot mark.
- **Origin URL (what ships):** the project's own pixel lobster,
  `https://github.com/openclaw/openclaw/blob/main/docs/assets/pixel-lobster.svg`, kept in its
  authored colours because it is pixel artwork rather than a monochrome glyph. This is the one mark
  in the set that is NOT recoloured.
- **Also evaluated:** `https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/openclaw.svg`,
  a single-path monochrome rendition of the same figure, MIT. Not used: the official pixel artwork
  is the vendor's own and reads correctly at tray size.
- **Cross-checked against the project's own marks:** `https://openclaw.ai/favicon.svg` (the gradient
  lobster) and `https://raw.githubusercontent.com/openclaw/openclaw/main/apps/linux/src-tauri/icons/tray-template.svg`,
  a single-colour silhouette of the same critter that the project ships for menu bar use. The
  LobeHub rendition is the same figure: round body, two antennae, two claw nubs, two legs, two eyes.
  The project's own template file was not used directly because it is built from an SVG `<mask>`,
  which requires an `id` and would risk collisions when inlined.
- **Licence of the path data:** LobeHub Icons, MIT. The OpenClaw project itself is MIT licensed,
  "Copyright (c) 2026 OpenClaw Foundation"
  (`https://github.com/openclaw/openclaw/blob/main/LICENSE`).
- **Trademark terms:** No trademark policy or brand guidelines document was found in the OpenClaw
  repository or on its sites as of 2026-08-18, so there is no vendor statement to quote.
- **Recolouring permitted?** No prohibition found. The project itself ships a monochrome silhouette
  rendition of this mark for system tray use, so single-colour rendering is contemplated upstream.
- **Date fetched:** 2026-08-18.
- **Use here:** Nominative use to identify a third-party product inside a product UI, rendered at
  16 to 20px.
- **Homepage study, the mascot (2026-10-13):** the homepage's fleet story
  (`src/components/site/fleet-story/`) draws the project's mascot, "molty", and not the pixel
  lobster above, as a flat glyph in its panels and as 3D geometry on its agent tiles. Origin:
  `https://github.com/openclaw/openclaw/blob/main/apps/macos/Icon.icon/Assets/molty.svg`, the
  character on the project's own macOS app icon. Licence: MIT, "Copyright (c) 2026 OpenClaw
  Foundation" (the repository's `LICENSE`). Path data is reproduced from the SVG: the body with its
  feet and the two claws as written, the eyes and their glints (circles in the SVG) written as arcs,
  and the two antennae kept as the vendor's stroked centrelines (stroke width 3) and given that
  width when extruded. It is drawn in the vendor's own tones, its coral gradient (`#ff4d4d` to
  `#e43d36`) flattened to `#ff4d4d`, the claws a shade deeper, near-black eyes with the teal glint
  (`#00e5cc`). The geometry is in `HARNESS_MARK_PATHS` (`src/components/workspace/harness-icons.tsx`)
  and the paint is resolved in `fleet-story/mark-tones.ts`. The product's own chrome icon
  (`OpenClawIcon`: the launcher, the ribbons, Agent Sources settings, the hero board) is unchanged and
  is still the pixel lobster described above. The trademark position recorded above is unchanged.

---

## Qwen Code, no mark shipped

- **Vendor / product:** Alibaba Group. Qwen Code, the Qwen terminal harness.
- **Why no mark:** Qwen's Terms of Service (`https://qwen.ai/termsservice`,
  read on 2026-09-24) state: "Under no circumstances shall you use, without
  authorization, any of the Company's trademarks, service marks, trade names,
  domain names, website names, or other distinctive brand features
  (collectively referred to as "Marks"), including "Qwen" and "Alibaba".
  Without the Company's prior written consent, you may not display or use the
  foregoing marks". Unlike the vendors above, whose terms permit nominative
  use and restrict alteration, this bars display outright without consent.
- **What ships instead:** `SOURCE_MARKS.qwen` is `null`, so every surface
  draws its own fallback beside the plain-text product name, and the source's
  identity colour does the rest.
- **Remedy:** obtain written consent from Alibaba, then add the mark with its
  provenance here. A monochrome rendition exists in LobeHub Icons
  (`packages/static-svg/icons/qwen.svg`, MIT); it was evaluated and not used.

---

## Antigravity, no mark shipped

- **Vendor / product:** Google LLC. Antigravity, and the Antigravity CLI
  (`agy`) harness.
- **Why no mark:** Google's trademark guidelines for proper usage
  (`https://partnermarketinghub.withgoogle.com/brands/google/trademarks-and-terms/trademark-guidelines-for-proper-usage/`,
  the page `https://about.google/brand-resource-center/rules/` redirects to,
  read on 2026-10-05) state: "DO Use only Google-approved artwork when using
  Google's logos." and "Don't remove, distort, or alter any element of a
  Google Brand Feature." The Brand Resource Center's permissions guidance
  (`https://about.google/brand-resource-center/guidance/`, read the same day)
  requires a request first for most uses of Google brand elements, permits
  referencing Google "in plain text in books, articles, websites, etc., as
  long as you follow our Trademark Rules", and forbids imitating "Google's
  logo or visual identity (distinctive color combinations, graphic designs,
  product icons, or imagery associated with Google)". Every mark in this
  registry is recoloured to the surrounding ink, which is an alteration, and
  no Google-approved artwork was obtained.
- **What ships instead:** `SOURCE_MARKS.antigravity` is `null`, so every
  surface draws its own fallback beside the plain-text product name, which
  the guidelines permit, and the source's identity colour does the rest.
- **Remedy:** obtain Google-approved artwork and permission through the Brand
  Resource Center, then add the mark with its provenance here.

---

## Concept marks on the homepage (Grok Bot, Muse, Instinct, dots)

The homepage's fleet story also draws four agents Exawatt does not run yet, so the fleet reads as
every kind of agent in one place. Their marks live in
`src/components/site/fleet-story/concept-marks.ts`, in the same shape as the product's registry but
outside it: no product chrome draws them, and `HARNESS_MARK_PATHS` gains a mark only when Exawatt
ships an adapter for that harness, at which point the concept entry is deleted. They are drawn as a
flat glyph in the story's agent card and as 3D geometry on its agent tiles, and the agents wearing
them are labelled synthetic on the page ("Demo workspace · synthetic fleet").

**Operator decision, 2026-10-14 (accepted risk).** Told that Exawatt can launch none of the four
today, and that their vendors' terms forbid altered marks and implied endorsement, the operator
chose to show all four as concepts: "that's fine, it's on the roadmap. Homepage is aspirational and
illustrative and I'll add support for them soon." Accepted: drawing these four marks, as recorded
below (traced, recoloured to the surrounding ink or one brand colour, extruded), on the homepage's
synthetic fleet. The path data also ships in the public source, as the five marks above do, on the
same nominative footing; the remedy if a vendor objects is the one at the end of this file. Not
decided here: drawing them in the product's own chrome, which waits for each adapter.

Every source below was retrieved on **2026-10-14**.

### Grok Bot

- **Vendor / product:** xAI (SpaceXAI). Grok Bot, always-on agents with their own cloud computers,
  in beta since 2026-08-11 (`https://x.ai/news/introducing-grok-bot`).
- **Origin:** the app's 1024 px App Store icon, found through Apple's lookup API
  (`https://itunes.apple.com/lookup?id=6794501026`). No vector mark was found: `https://x.ai/bot`
  refuses automated fetches.
- **What was drawn:** a trace, not the vendor's bytes. The face is a circle: fitted to the icon's
  visible edge, it holds to a quarter of a pixel at 1024. The two eyes are capsules fitted to their
  cut-outs. The icon crops the face with its tile, so the circle is drawn whole and the eyes keep
  their place on it, in a 100 box, eyes cut out (`fillRule: evenodd`). The icon's grey face and
  bevel are flattened to the surrounding ink.
- **Trademark terms:** the xAI Brand Guidelines quoted under Grok Build apply: marks "only to
  accurately refer to us or our services", logos "exactly as provided... without any alteration or
  adjustment". Tracing and recolouring are alterations, covered by the decision above.

### Muse

- **Vendor / product:** Meta. Muse, Meta's personal agent, launched in the US on 2026-09-08
  (`https://muse.ai`).
- **Origin URL:** `https://muse.ai/images/hatch/muse-logo.svg`, the single-path scribbled "M" in the
  site's own assets.
- **What was drawn:** the path, byte for byte, in its own 100 box. Meta draws it in a gradient
  (`#0082FB`, `#0064E0`, `#0040DC`); the story paints the middle stop, `#0064E0`, as Anthropic's
  terracotta is painted for Claude (`fleet-story/mark-tones.ts`).
- **Trademark terms:** no Muse-specific guidelines were found. Meta's trademark page
  (`https://www.meta.com/brand/resources/meta/our-trademarks/`): "You may only use our trademarks
  with our permission, including as authorized by any brand guidelines we may publish." Muse is not
  listed there; the page says a name's absence does not waive Meta's rights. Covered by the decision
  above.

### Instinct

- **Vendor / product:** Spear Street Technology, Inc. Instinct, a personal agent reached by text
  and call, invite-only since 2026-08 (`https://instinct.com`).
- **Origin URL:** `https://instinct.com/favicon.svg`, a flared serif "I" on a white card.
- **What was drawn:** the "I" path, byte for byte, in the 40 box the favicon draws it in (the
  favicon scales that box onto its card). The white card is dropped and the glyph takes the
  surrounding ink. The site's hand-drawn header figure was not used.
- **Trademark terms:** no brand guidelines or press kit were found. Terms of Service
  (`https://instinct.com/terms`, section 7): "The Company's name, the Company's logo and all related
  names, logos, product and service names, designs and slogans are trademarks of the Company or its
  affiliates or licensors." Covered by the decision above. For a future adapter, not the mark: the
  same terms bar driving the service with "automation software (bots)".

### dots

- **Vendor / product:** OpenAI. dots, always-on agents in ChatGPT, announced 2026-09-29
  (`https://openai.com/index/introducing-dots/`).
- **Origin:** none. OpenAI publishes no mark for dots, and each dot is a character its user
  customises. The only logo file found, a glowing "dots" wordmark on the Product Hunt listing
  (`https://www.producthunt.com/products/dots-by-openai`), was uploaded by whoever posted the
  listing and reads poorly at tile size; it was not used.
- **What was drawn:** Exawatt's own drawing, three dots of three sizes in a 24 box, in the
  surrounding ink. It is not OpenAI's artwork and does not imitate OpenAI's logo; it stands beside
  the product's name, "dots", which is OpenAI's.
- **Trademark terms:** OpenAI's brand guidelines (`https://openai.com/brand/`) govern OpenAI's own
  logos ("Use the logo exactly as provided"); none of them is drawn here.

---

## If a vendor objects

Delete the component and fall back to the text label beside it. Nothing in the UI depends on a
mark being present: `harnessMarkExists` gates every render site, and the label stands alone. For a
concept mark, delete its entry in `concept-marks.ts`; the type checker then leads to its id in
`fleet-story/mark-tones.ts`, and its agents fall back to no mark.

Each vendor publishes a contact for logo permission questions on the page quoted above. They are
deliberately not reproduced here: this repository's public-content scanner refuses real addresses,
and an address copied into a file goes stale faster than the page that owns it. Read the contact
off `anthropic.com/legal/trademark-guidelines`, `openai.com/brand/`, or
`x.ai/legal/brand-guidelines` at the time you need it.

---

## GitHub, `GitHubMark` (fetched as `GitHub_Invertocat_White.svg`)

Not a harness: the homepage's close links to the repository with GitHub's mark beside the words
(ENG-031 W15o, 2026-10-14), in `src/components/site/github-mark.tsx`.

- **Vendor / product:** GitHub, Inc. The Invertocat, GitHub's primary logo.
- **Origin URL:** `https://brand.github.com/GitHub_Logos.zip`, linked from
  `https://github.com/logos`; the file `GitHub Logos/SVG/GitHub_Invertocat_White.svg`.
- **Changes:** none to the path or its colour. The path is reproduced byte for byte in the white it
  is supplied in. The file's `clip-path`, a rectangle the size of the `viewBox`, is a no-op and was
  removed with its `id`.
- **Trademark terms:** `https://github.com/logos`. Operative sentences: "Use the Invertocat logo as a
  social button to link to your GitHub profile or project." and "Do not modify the permitted GitHub
  logos, including changing the color, dimensions, or combining with other words or design
  elements."
- **Recolouring permitted?** **No**, and it is not recoloured: it is drawn in the supplied white on
  the page's dark ground.
- **Date fetched:** 2026-10-14.
- **Use here:** a link to the project's own repository, the use GitHub names.
