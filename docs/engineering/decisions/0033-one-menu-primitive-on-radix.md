# 0033 — Stay on Radix, and own one menu primitive

- Status: accepted
- Date: 2026-08-04
- Context: ENG-016 D49 (New Agent launcher redraw)
- Supersedes: nothing. First recorded decision about the component library.

## The question the operator asked

While reviewing the D49 launcher bench: *"I don't seem to be able to use
keyboard entry to navigate the model drop down. Just like native macOS menus I
want to be able to tap a letter or start typing a word and it'll automatically
move around to that word, like S for sonnet. Yeah it looks like we're not using
very good menus or input system at all. I can't use arrows to navigate up and
down."*

And the strategic form of it: *"Should we be using a particular UI system? …
whether it's shadcn or even something a little bit more industrial or
extensible for our use case, I'm not sure. I don't really want to get into yak
shaving here. Indeed it should feel native or better than native."*

## What was actually wrong

Not the library. The launcher's first cut built its axis controls out of cmdk's
`Command` inside a Radix `Popover`, and mounted cmdk's `CommandInput` only when
a list had more than ten options. cmdk's keyboard handling lives on that input.
Short lists therefore had no focused element at all, which is why arrows did
nothing and type-ahead did nothing. A ten-option menu was strictly worse than
an HTML `<select>`.

That is a misuse, and it was not the only one. Radix `Select` — already a
dependency, already used elsewhere in the composer — has arrow navigation,
Home/End, and type-ahead built in. The launcher reached past it for a
search-first component because one axis (OpenCode's model list) has hundreds of
entries, and then applied that choice to every axis.

## Decision

**Stay on Radix primitives via shadcn.** Switching component libraries would
not have fixed this bug, because the bug was a component chosen wrongly rather
than a library lacking a feature. The existing stack already carries correct
focus management, portalling, dismissal, and ARIA, and the app has ~20
components built on it.

**Own one menu primitive on top of it.** `src/components/ui/option-menu.tsx` is
a Radix `Popover` hosting a real roving-focus listbox, with the keyboard model
extracted to `option-menu-keyboard.ts` and unit tested without a DOM:

- arrows with wrap, Home/End, PageUp/PageDown, disabled options never landed on
- macOS type-ahead: a multi-character prefix buffer that expires after ~1s, and
  a repeated letter that CYCLES matches (`S`, `S` walks Sonnet 4.6 → Sonnet 5)
  rather than searching for `"ss"` — the behaviour macOS menus have and most
  web menus do not
- an optional search field for long catalogs that never steals the arrows
- grouped options, per-option marks, descriptions, unavailable reasons
- a footer slot for real actions inside the same surface, which is why this is
  a listbox in a popover rather than a `Select`: the engine menu needs a route
  to Settings, and `Select` has no home for one

Neither `Select` nor `Command` alone covers "type-ahead AND search AND a
footer action AND per-option marks", and splitting axes across two components
would reintroduce exactly the inconsistency the operator noticed.

## Adoption

The launcher adopts it now. The rest of the app — the composer's remaining
`Select`s, the settings selects, the standalone model picker — migrates in a
follow-up rather than in the same change, so this round stays reviewable.
`Command`/cmdk keeps one legitimate home: the ⌘K command palette, which is
genuinely search-first and has its own ranking layer (D48).

## Consequences

- One keyboard grammar across every dropdown, testable without a browser.
- A small amount of owned code where a library component would otherwise sit.
  Accepted: the behaviour is specified, tested, and the alternative was three
  different behaviours across three axes in one panel.
- If a future component library is ever adopted, `option-menu.tsx` is the one
  file that has to be reimplemented, not every call site.
