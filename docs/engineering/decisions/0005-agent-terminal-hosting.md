# 0005 — Host agent terminals with node-pty + xterm.js in Electron

Date: 2026-07-02
Status: accepted

## Context

ENG-002 (Agent Terminal Workspace) needs interactive terminal sessions for
coding-agent harnesses (Claude Code, Codex) and plain shells inside the
Electron app. The operator talks to harness TUIs directly — a "tmux-like
view" — but the product gesture is agent-first ("launch an agent" of a given
harness type in a worktree), not generic terminal multiplexing.

Options considered:

1. **node-pty + xterm.js** (the VS Code terminal stack): one PTY per session
   owned by the Electron main process, xterm.js rendering in the renderer,
   IPC streaming, `@electron/rebuild` for the native module.
2. **tmux as the session backend**: spawn sessions inside tmux and attach via
   control mode. Sessions survive app restarts, but it adds a hard external
   dependency, control-mode protocol parsing, and fights a custom UI.
3. **Background daemon owning PTYs** with the UI as a client. Maximum
   robustness (sessions survive UI crashes), maximum build cost.

## Decision

Option 1 for v0. The session manager is an explicit boundary
(spawn / attach / write / resize / kill / serialize) so a detachable backend
(option 2 or 3) can replace the in-process PTY owner later without UI
changes — architect ten miles ahead, build one mile.

## Consequences

- v0 restart persistence covers layout, names, worktrees, and working dirs;
  running processes do NOT survive an app restart. Acceptable for daily
  dogfood — agents are cheaply re-launchable; a detachable backend is the
  designated upgrade path when that stops being acceptable.
- A native-module rebuild step joins the Electron build.
- The existing headless runner (`electron/main/agents/claude-code-agent.ts`,
  `claude -p` JSON stream) remains for autonomous sessions. Interactive PTY
  sessions are a sibling; both normalize into FleetState via ENG-003
  adapters.
- Terminal text and controls stay DOM (xterm.js), consistent with decision
  `0003`'s hybrid rule: crisp accessible text in DOM, the scalable world in
  WebGL. The spatial surface navigates and summarizes sessions; it does not
  render terminal text.
