# Harness brand mark provenance

The agent-harness brand marks Exawatt draws are **third-party trademarks**. Each one identifies an
Agent Source Exawatt can drive. They are reproduced for **nominative use only**: to name the
third-party product a user is looking at, inside Exawatt's own UI, at 12 to 20px.

Full Vibe AI and Exawatt claim **no affiliation with, sponsorship by, or endorsement from** any of
the vendors listed below. Every mark remains the property of its owner, and any goodwill from its
use belongs to that owner.

## Where they ship

There are no brand image files in this repository. Every mark is INLINE SVG in
`src/components/workspace/harness-icons.tsx`, one exported component per mark, so nothing is
fetched at runtime, nothing needs an `id`, and the app and the marketing board draw the same
geometry. `src/components/site/harness-mark.tsx` is the adapter from an Agent Source's declared
`adapterId` to the component.

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

---

## If a vendor objects

Delete the component and fall back to the text label beside it. Nothing in the UI depends on a
mark being present: `harnessMarkExists` gates every render site, and the label stands alone.

Each vendor publishes a contact for logo permission questions on the page quoted above. They are
deliberately not reproduced here: this repository's public-content scanner refuses real addresses,
and an address copied into a file goes stale faster than the page that owns it. Read the contact
off `anthropic.com/legal/trademark-guidelines`, `openai.com/brand/`, or
`x.ai/legal/brand-guidelines` at the time you need it.
