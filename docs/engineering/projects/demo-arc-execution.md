# Demo arc — execution packets

**This document holds no scope of its own.** Every packet points at a roadmap item that owns its scope, exit criteria, and boundaries. This is a sequencing and ownership surface for running 4–6 agents in parallel without collisions — not a competing plan. If a packet disagrees with its owning item, the item wins.

Created 2026-08-02 from the grooming session. Sized to the operator's stated parallelism: 4–6 agents now, 10+ aspirationally.

## What the demo must survive

The operator named three risks (2026-08-02). Reliability was explicitly **not** among them — the daily driver is solid, so do not spend this arc's slack on hardening.

| Risk | Answering work |
| --- | --- |
| "It looks unpolished up close" | P1 design kernel, then P8 polish on the surfaces actually shown |
| "The story doesn't land" | P6 readiness grammar and surface map; the four user questions answered on screen |
| "Nothing to show at scale" | P4 demo fleet content, P5 demo-scale rendering |

## Collision map

Two files are contention points. Respect these or agents will conflict:

- **`src/components/nav/surfaces.ts`** — touched by the rename (P2) and the readiness manifest (P6). P2 owns it first; P6 waits.
- **The spatial surface** — touched by demo-scale rendering (P5) and the altitude handoff (P7). P5 owns it first; P7 waits.

Everything else in wave 1 is file-disjoint by construction.

## Wave 1 — start in parallel, no shared files

### P1 · Design kernel

- **Owns:** ENG-036 G0
- **Scope:** extract the type scale, spacing steps, color roles, and status iconography the app already uses correctly into one citable reference. Include the amend-when-you-deliberately-improve rule. Audit `/hud-gallery` and record what merges vs retires (G1 executes the merge; G0 only decides).
- **Files:** new doc under `docs/engineering/`; read-only everywhere else.
- **Do not touch:** any component. G0 writes down what is true; it does not refactor toward it.
- **Acceptance:** an agent can pick a font size, muted color, and card padding for a new page by citing one document. The 17 measured pixel sizes are reduced to a named scale with an explicit note about which existing usages are off-scale.
- **Blocks:** P6, P8.

### P2 · Rename sweep and legacy retirement

- **Owns:** decision `0023`
- **Scope:** Terminal→**Agent**, Sessions→**Team**, Spatial→**Fleet**, in one holistic sweep. Retire `/fleet`, `/dashboard`, `/board` and their demo machinery. Reconcile `docs/product/demo-mode.md`, which still documents the trio as the current primary demo implementation.
- **Files:** `src/components/nav/surfaces.ts` (owner), `command-altitude.ts`, shortcut and menu labels, window titles, `⌘K` and cheat-sheet copy, `AGENTS.md`, product and engineering docs.
- **Do not touch:** route paths (`/workspace`, `/fleet/spatial` keep their URLs), the readiness field (P6 adds it).
- **Acceptance:** no user-visible string says Terminal, Sessions, or Spatial as an altitude name; `grep -ri "fleet command"` returns nothing user-facing; the app builds and the three altitude shortcuts still work.
- **Blocks:** P6.

### P3 · Workspace scope

- **Owns:** ENG-027 W1
- **Scope:** Workspace identity, the account-menu switcher, Workspace-scoped view state. Personal only; Demo appears as `Coming soon` until P4/W2.
- **Files:** new tenancy module, account menu, workspace shell state.
- **Do not touch:** PTY lifecycle, session persistence.
- **Acceptance:** switching Workspaces leaves every live local Session running and exactly where it was — this is the item's most important property and must be demonstrated, not assumed.

### P4 · Demo fleet content

- **Owns:** ENG-027 W3 and W4 (data)
- **Scope:** author the demo Workspace as versioned, resettable data — one plausible multi-function startup, majority coding, 6–12 Projects with roadmaps that parse under the published convention, Agents spread across the five-signal status protocol including delegation, readable Sessions, plausible consumption history. W4 adds the entity count the Fleet moment needs, with honest structure rather than cloned filler.
- **Files:** new data/fixture files only.
- **Do not touch:** rendering. P5 owns pixels; this packet owns data.
- **Acceptance:** the demo roadmaps parse with zero warnings; non-coding Agents render as `preview` content and never imply shipped capability.

### P5 · Demo-scale rendering

- **Owns:** ENG-004 V3.1
- **Scope:** instancing, culling, label budgets, and measured frame cost against P4's fleet. Unparks V2.1's rendering half only.
- **Files:** spatial surface (owner during wave 1).
- **Do not touch:** V2.1's truth half — no Initiative-level aggregation, no aggregate Project drill. Read `docs/engineering/r3f-authoring-guide.md` before any change under `<Canvas>`.
- **Acceptance:** the demo fleet renders at frame budget with numbers recorded; `pnpm eval:r3f` passes.

## Wave 2 — after their dependencies land

### P6 · Readiness grammar and surface map

- **Owns:** ENG-026 N0 and N1
- **Depends on:** P1 (vocabulary), P2 (owns `surfaces.ts` first)
- **Scope:** the `live` / `preview` / `announced` readiness field in the navigation manifest, the shared marker and affordance components prototyped in `/hud-gallery` for operator review, and the vision surfaces registered with their entry points. Fold ENG-008 E4's local `Unbuilt` treatment into the shared grammar — it is the ancestor, and two vocabularies must not survive. Register `/consumption` with a readiness state (an open N2 obligation).
- **Acceptance:** shipping a capability is a one-line manifest change plus a source swap; nothing in the spine links into a broken state.

### P7 · Altitude handoff

- **Owns:** ENG-004 V3.0, decision `0023`
- **Depends on:** P5 (owns spatial first), P3 (Team-altitude layout stable)
- **Scope:** the board's entry pose, position handoff from cards to nodes, camera pull-back. Identity and position carry; content never does.
- **Acceptance:** the fallback cut fires correctly under reduced motion, low power, and a missed frame budget — the fallback is the feature that makes the handoff safe. Transitions never block input.

### P8 · Polish pass

- **Owns:** ENG-036 G3 (partial)
- **Depends on:** P1
- **Scope:** apply the kernel to exactly the surfaces the demo will show. Not an app-wide refactor.
- **Acceptance:** screenshot evidence for every surface touched, per the standing visual-verification rule.

### P9 · Preview surfaces

- **Owns:** ENG-026 N3, N4, N5 — with ENG-028 T1 and ENG-029 C1 supplying content
- **Depends on:** P6
- **Scope:** Organization and Cloud previews, the `announced` *Push to cloud* affordance, the Coordination preview (broad strokes), and the Agent Type chip and surface.
- **Acceptance:** each of the four recurring user questions can be answered on screen without leaving the app.

## Standing rules for every packet

- Work in a dedicated `agent/<slug>` worktree bootstrapped with `pnpm worktree:setup`; land with `pnpm agent:land -- --verify <checks>` per `AGENTS.md`.
- Name the owning roadmap item in the first commit. This is how the operator sees who is on what, and it is why an assignment mechanism is not being built (ENG-029's recorded correction).
- UI work is not done without visual evidence. Compiling is not looking right.
- If a packet's scope disagrees with its roadmap item, stop and reconcile the item — do not silently diverge.
