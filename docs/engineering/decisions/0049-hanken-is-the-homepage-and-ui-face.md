# 0049 Hanken is the homepage and UI face

Date: 2026-10-14
Status: accepted by the operator 2026-10-14; implemented in ENG-031 W15

**Use Hanken Grotesk for the fleet-story homepage and proportional application UI copy.** The operator selected it after comparing Geist, Manrope, and Hanken in `/hud-gallery/homepage-study`: "Let's go with Hanken."

## Context

The preceding brief asked for a slicker, recognizable, stylized face for the homepage h1/h2 and for app labels and modal copy. The operator also liked the face in app tabs. The study put three headline faces and three product-copy treatments over the real homepage, with a tab and approval-dialog proof. Geist Mono is the app tab face; using it for full modal sentences would lose the reading rhythm the proof kept in a proportional face.

The older public exhibition boundary fixed Geist to prevent app appearance changes from reflowing public pages (ENG-032 T5.3; incident `0004`). That stability requirement remains.

## Decision

1. `/` fixes Hanken for the fleet story's headlines and reading copy, independent of app theme and saved font preferences. The homepage study opens on Hanken for both roles and keeps the other candidates for comparison.
2. Classic, Air, and Night resolve `font-ui` and `font-display` to Hanken. The shared Label and Dialog content roots use `font-ui`, as do the custom close-confirm sentences. The shell/body families remain profile-specific; explicit System and Geist interface overrides remain available.
3. Tabs, metrics, shortcut hints, and deliberately monospace controls keep Geist Mono. Full dialog sentences use a proportional face.
4. Hanken moves to the root font bundle under its existing SIL OFL 1.1 provenance. Manrope stays in the study route. The existing fixed Geist boundary remains for `/architecture` and other public exhibition pages; `/` has its own fixed Hanken boundary.

The `font-ui` and `font-display` utilities must reference the runtime CSS
variables. During implementation, the root variable resolved to Hanken but
`.font-ui` still rendered Geist: Tailwind's `@theme inline` had substituted
the old default when it built the utility. Moving those two declarations to
`@theme` lets the appearance profiles and explicit overrides reach the text.

## Verification contract

Check the computed face on the homepage h1/h2 and body, a form label, a shared dialog, a close-confirm dialog, and the tab strip. Cycle app appearance preferences and navigate between `/` and `/architecture` under `eval:typography-stability`; neither public page may inherit the changing app font. Check phone headline wrapping and horizontal overflow. The font provenance test must cover the relocated Hanken binary and the root layout.
