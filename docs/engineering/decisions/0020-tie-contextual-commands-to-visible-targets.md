# Decision 0020: Tie contextual commands to visible targets

- Status: accepted
- Date: 2026-07-24

## Context

Exawatt exposed workspace commands through four discovery/execution surfaces:
keyboard shortcuts, the persistent key legend, the command palette, and the
native macOS Session menu. Each surface inferred applicability separately.
That drift made commands look live when no Project, Session, split target,
recovery entry, or attention target existed.

The sharpest symptom was `⌘J`: when no Session carried the visible amber
needs-you marker, a hidden roadmap-starvation fallback moved the operator from
Terminal to Sessions. The behavior was internally intentional but contradicted
the command's label and the state visible to the operator.

Project and Session context menus had a related split: once open they supported
keyboard navigation, but only a pointer could open them and dismissing one did
not return focus to its invoker.

Follow-up review found three subtler forms of drift: independent attention
sources used last-writer semantics, a renderer reload could leave native menu
booleans stale, and the Recently-closed count was a renderer snapshot even
though main can reap entries on its own schedule.

## Decision

Contextual workspace commands require a visible, actionable target.

- `⌘J` walks only Sessions carrying the visible needs-you state. An empty
  roadmap queue remains roadmap state and is reached explicitly with `⌘B`; it
  is not an invisible attention target. A quiet turn-end is Result state, not
  an operator gate; only an explicit bell, roadmap block, or conservative
  legacy attention signal joins the needs-you queue.
- Independent attention producers merge by semantic precedence before both
  rendering and navigation. Human gates outrank turn-end results for the same
  Session; the oldest winning signal determines queue order.
- One renderer-owned availability snapshot derives applicability and a short
  unavailable reason from current Project, Session, split, recovery-ledger,
  and attention state.
- Workspace shortcuts consult that state before acting. Passive hints hide
  inapplicable commands. The command palette keeps useful discovery rows but
  disables them with the reason. Electron main receives the same boolean
  projection and disables native Session-menu items.
- Because the native Session menu is application-global, workspace-local
  rename, split, close, and attention verbs are disabled while Spatial or
  another route owns the renderer. Route-safe commands with explicit pending
  navigation paths, such as shell launch and reopen, remain available when
  their data target exists.
- Project and Session action menus open with right-click, `Shift+F10`, or the
  Context Menu key. They use one roving tab stop, Arrow/Home/End navigation,
  Tab/Shift-Tab exit, and command-aware focus restoration. A menu closes if its
  Project or Session target disappears while it is open.
- Electron resets renderer-owned availability when document loading or
  main-frame navigation starts, or the renderer process exits. Main-process
  archive, reopen, and expiry/reap
  operations publish authoritative Recently-closed counts; the renderer
  subscribes before hydration and uses pending closes only to preserve immediate
  recovery availability.
- Project name/color editing is a Project command, not an alias for Session
  rename.

The model describes UI applicability only. Electron main remains authoritative
for PTY lifecycle, the workspace remains authoritative for selection, and the
individual action still validates its target at execution time.

## Consequences

- A visible command no longer appears actionable and then silently fails.
- Attention navigation becomes predictable from the same marker used in the
  strip, Sessions overview, and command palette.
- Native menu truth now requires a small validated renderer-to-main state
  projection in addition to accelerator synchronization.
- Reloads briefly and deliberately disable contextual native commands until the
  restored workspace republishes truth; stale commands are never preferable to
  this conservative interval.
- The last known data-target snapshot remains useful while moving between
  Terminal, Sessions, and Spatial, but route ownership is an additional native
  menu prerequisite for workspace-local verbs. A cold renderer starts
  conservatively with contextual commands disabled until restoration publishes
  truth.
- Future contextual commands must join this shared model instead of creating a
  surface-local prerequisite check.
