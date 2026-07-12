# 0005 — Host agent terminals with node-pty + xterm.js in Electron

Date: 2026-07-02
Status: accepted

The designated-detachable-upgrade assumption below was superseded by decision
`0012`; Electron-main PTY ownership remains accepted.

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
(spawn / attach / write / resize / kill / serialize). Decision `0012` later
kept that ownership and chose deterministic rehydration instead of replacing it
with options 2 or 3.

## Consequences

- Restart persistence covers layout, names, worktrees, and working dirs;
  running processes do not survive an app restart. ENG-018 makes their logical
  Sessions deterministic to rehydrate (decision `0012`).
- A native-module rebuild step joins the Electron build.
- The existing headless runner (`electron/main/agents/claude-code-agent.ts`,
  `claude -p` JSON stream) remains for autonomous sessions. Interactive PTY
  sessions are a sibling; both normalize into FleetState via ENG-003
  adapters.
- Terminal text and controls stay DOM (xterm.js), consistent with decision
  `0003`'s hybrid rule: crisp accessible text in DOM, the scalable world in
  WebGL. The spatial surface navigates and summarizes sessions; it does not
  render terminal text.
