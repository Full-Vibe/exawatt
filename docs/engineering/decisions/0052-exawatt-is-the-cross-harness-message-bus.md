# 0052 Exawatt is the cross-harness message bus: realtime, no authority, no policing, fully logged

Date: 2026-10-14
Status: accepted — operator decision; execution is ENG-029 C4 and the live C1 viewer

## Context

ENG-029 (2026-08-02) decided that the repo is the blackboard and ENG-023's
harness event channel is the bus, and set a least-chatty ladder: assignments
first, directed notes later, a queryable room later and gated. On 2026-09-23
the operator asked for collaboration "regardless of what species they are",
and the agent recommendation recorded then, not decided, was that a
cross-harness message is drafted by the agent and sent by the operator until
ENG-006 Approvals exist.

On 2026-10-14 the operator asked for realtime agent-to-agent messaging across
Claude Code, Codex and Gemini (Antigravity), visible in the product, with the
July 2026 OpenAI–Hugging Face incident as the cautionary example of agents
improvising a board. Measured the same night: no standard carries a message
between the three harnesses (A2A is spoken only by Gemini CLI; ACP routes
editor to agent; MCP is pull-only but shared by all three). Claude Code
documents third-party injection into its per-session socket and `claude agents
--json` as the supported outside read; Codex offers `codex queue --thread` and
its app-server; Antigravity offers `--input-format stream-json` for owned runs
and only the PTY for interactive tabs. The incident evidence says: push never
poll, addressing and sender identity are bus guarantees, messages carry no
authority, the full log is the human's view, never inject by keystroke.

The operator's answers: realtime delivery with "fewer approvals", leaning to
no holds at all because he sees little risk; and, explicitly, **no
productized debate, no round counter, no policing of agent communication**:
"It's up to the user how they want their agents to interact or what prompt
they give them ... we'll likely just be wrong most of the time."

## Decision

1. **Exawatt is the bus.** One Exawatt-owned message path carries a directed
   message from any launched Session to any other Session the operator can
   see, across harnesses. The transport is the ENG-023 channel's second
   consumer for inbound events and a per-harness delivery adapter for
   outbound; no second event channel is created.
2. **Delivery is realtime and unconditional on Exawatt's side.** Exawatt
   delivers every message immediately through the harness's own inbound path.
   A harness's own inbound rule still applies (Claude Code's
   `crossSessionInbound` may hold a message in an Ask-first permission mode;
   that is the harness's dialog, not Exawatt's). Exawatt adds no approval,
   quota, counter, round cap, convergence rule or loop detector. The
   2026-09-23 courier recommendation is withdrawn.
3. **A message carries no authority.** It is text with provenance. It cannot
   answer a permission prompt, change a launch policy, or run a command; what
   the receiving Agent does with it is governed by that Agent's own policy and
   prompt, exactly as a message typed by the operator would be.
4. **Addressing and sender identity are Exawatt's guarantees.** Every Session
   has a stable address (its Exawatt Session id and a display name); a send to
   an unknown or ended address fails at the sender with a named reason; the
   envelope the receiver sees names the sender Session, its harness and the
   Project, stamped by Exawatt, never by the sending model.
5. **Every message is logged and visible to the operator**, per Project, in
   the product (the live C1 viewer: a Chatter sidebar first), with the full text,
   both endpoints, the time and the delivery result. The ledger is
   machine-local Exawatt state, not a repo file; ENG-029's repo blackboard
   remains the durable, deliberately curated store (handoffs, decisions), and
   a later export of a thread into `.exawatt/` is allowed, never automatic.
   Amended 2026-10-15 (operator): chatter is ephemeral by default and the
   store and transport sit behind one seam, because "we may in fact just plug
   in some other information architecture system, or communication, or agent
   hierarchy system, for which Exawatt remains the user interface." The
   machine-local ledger is the first implementation, not the design; a
   "save this thread to the project" operator verb is a possible later mile.
6. **How Agents use the bus is the user's prompt.** Exawatt documents the
   tools it offers (list the Agents it can reach, send a message, say when it
   is blocked) and shows examples in guides. "You two argue and come back when
   you agree" is a prompt the user writes; Exawatt ships no debate, judge,
   round or consensus feature and keeps no count.
7. **Degraded paths are named, never hidden.** Where a harness has no inbound
   API for an interactive tab, delivery falls back to the terminal with a
   bracketed paste when the Session is idle, and the ledger marks that message
   `delivered: terminal`; a harness with no inbound path at all shows
   `undeliverable` and the reason. The keystroke path is the floor, not the
   design.

## Consequences

- ENG-029's milestones are reshaped: C4 cross-harness messages is the first
  built rung, with the live C1 viewer beside it; C2 assignments stay gated on
  the recorded collision evidence; C5 stays gated.
- ENG-004 V4.2 "Direct N Agents" sends the operator's prompt to a selection;
  it is the human end of the same bus (an operator-stamped sender).
- ENG-006 Approvals, when built, may add a hold as an operator-chosen Policy;
  nothing here presumes it.
- The safety posture is visibility, provenance and the operator's stop, not
  interception. A future enterprise policy (ENG-044) may add interception as a
  default-off control.
- ENG-013's lead agent reads the same ledger it would otherwise have had to
  invent.

## Amendments, 2026-10-15

- **Harness-side holds mirror the launch policy, transparently.** For Claude
  Code, which decides itself whether a peer message is delivered or held
  (`crossSessionInbound`), Exawatt sets the per-launch value from the
  Project's launch policy: YOLO and Auto-review launches accept, Ask-first
  launches keep Claude's own hold dialog. The operator: "1 but make it
  transparent and clear." So the composer's source detail and the Session
  header state what that launch does with peer messages ("Peer messages:
  delivered instantly" or "held for your approval, five minutes"), and the
  Chatter sidebar shows `held` and `expired` as delivery states. This is
  the user's own policy applied to one more input, not an Exawatt rule.
- **Provider-hosted Agents are reachable through their provider's door.**
  A Claude Code cloud session takes a follow-up through
  `claude -p "<text>" --cloud <session-id>`; that is the delivery adapter
  for a provider-hosted Claude Agent when ENG-033 H5 lands. How a message
  crosses between a local Agent and a cloud Agent of another species is an
  open question the operator named and deferred; the bus's store and
  transport seam exists so that answer can be plugged in.
