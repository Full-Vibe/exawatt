# 0032 Restore Project-scoped Session recovery through one scope control

Date: 2026-08-03
Status: accepted

## Context

ENG-016 D36 intentionally reduced relaunch recovery from three visible actions
to two: one count-named workspace action and one per-Agent action. The Project
action was redundant when all saved work belonged to one Project, and three
separate Resume buttons competed in the same narrow recovery bar.

Daily use now spans several concurrently open Projects. After relaunch, the
operator needs to resume every eligible Agent in one work context while leaving
unrelated Projects paused. Agent-only recovery is repetitive; all-Projects
recovery crosses the intended boundary.

## Decision

Restore Agent / Project / all-Projects recovery as three **scopes of one
control**, not three competing controls.

- The selected Project is the recovery bar's one-click default whenever it has
  eligible stopped Agents.
- A single attached scope menu exposes the selected Agent when that scope is
  distinct and all Projects when other Projects have eligible stopped Agents.
- Every scope is count-named in visible or accessible copy and uses the same
  sequential `resumeTab` path.
- Project recovery selects tabs only from the durable Project group. Other
  Projects remain stopped and the recovery bar remains available for them.
- Shells and identity-missing Sessions are never admitted to a batch. They keep
  **Start New Shell** and **Reconnect needed** as separate explicit paths.
- If the selected Project has no eligible stopped Agent, the bar offers the
  remaining all-Projects action; selecting another paused Project restores the
  Project default.

## Consequences

- D36's two-scope **presentation** is superseded. Its reliability substance is
  unchanged: no silent revival, exact provider identity only, sequential
  agents-only batches, and localized failures.
- The common relaunch act is safer: the smallest useful work-context boundary
  is one click, while the broadest action requires opening the scope menu.
- The UI stays compact and keyboard-complete by reusing the standard Button,
  DropdownMenu, semantic chrome roles, and ENG-036 named type/spacing rungs.
- The bar may remain after a successful Project batch because that is truthful:
  other Projects are still paused. Dismissal remains an explicit operator
  choice.
