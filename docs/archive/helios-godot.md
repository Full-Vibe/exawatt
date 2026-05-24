# Archived: Exawatt Project Helios / Godot V2 Vision

Status: retired as active architecture.

This document preserves historical thinking from the former Helios/Godot direction. The current product direction is Exawatt as an Electron desktop app and future hosted interface layer for agents from any compatible source.

See `docs/engineering/decisions/0001-retire-godot-helios.md`.

---

# Exawatt — Project Helios (V2 Vision)

**Codename: Helios** — the next-gen game-engine UI. Distinguishes from V1 (the Electron/Next.js kanban, still active as a stopgap).

## The Two Tracks

- **V1 (Electron Kanban):** Stays as a functional stopgap for managing OC work queue today. Next.js + Supabase + Electron. Ship improvements here for immediate use.
- **Helios (V2):** Game-engine-powered command center. The real product. Built in Godot 4. This is what ships to customers.

---

## Core Vision

**Minority Report meets Grand Admiral Thrawn's command dashboard.** Not over the top, but futuristic and incredibly effective at managing agent fleets. A game development approach to communicating with and commanding AI agents.

The user wakes up, looks at a large display, and instantly sees: what their agents accomplished overnight, which are blocked, which need tasking. They unblock, redirect, and go about their day. When they need to work closely with one agent, they zoom in and collaborate deeply.

## Design Principles

1. **Sci-fi aesthetic, professional function.** Futuristic UI that earns its complexity through usefulness, not decoration.
2. **Two paradigms, one interface.** Must handle both: (a) deep collaboration with a single agent, and (b) fleet command of 1,000+ agents.
3. **Agents are individuals.** Each "Agent" is a single unit doing economically productive work. Not a session, not a process — an individual with identity.
4. **Hide the plumbing.** No "channels," "instances," "sessions." Users get jobs done and see progress.
5. **GPU-accelerated, native-feel.** Game dev stack, not web.

## Target Users

Professionals operating or working in their own companies. Not DevOps people managing infra — business operators who want work done.

---

## Stack

### Engine: Godot 4
- Open source (MIT license), zero licensing risk
- Rich 2D system with shaders, particles, parallax for depth effects
- GDScript (Python-like) + C# support
- Exports to macOS (.app/.dmg), Windows (.exe), Linux, and web (fallback)
- Growing ecosystem for tool/productivity UIs
- Lighter than Unity/Unreal, which are overkill for 2D-with-depth

### Backend: OpenClaw Gateway
- WebSocket JSON-RPC on localhost:1337
- Available methods: `chat.send`, `chat.history`, `chat.abort`, `chat.inject`, `chat.subscribe`
- Agent methods: `agent.heartbeat`, `agent.model`, `agent.request`, `agent.wait`, `agent.workspace`
- Cron: `cron.list`, `cron.add`, `cron.run`, `cron.update`, `cron.remove`, `cron.status`, `cron.runs`
- Session: `session.reset`, `session.state`
- Tools: `tools.catalog`, `tools.allow`
- Events pushed from gateway: `chat`, `agent`, `presence`, `tick`, `health`
- Auth: token-based (`gateway.auth.token`)

### Distribution
- Mac App Store (.app) and/or direct download (.dmg)
- Windows installer (future)
- "Powered by OpenClaw" — user never sees OC directly

### Cloud Vision (Future)
- Exawatt can provision cloud-hosted OC agents (not just local)
- Not multi-machine gateway, but multi-agent in hosted infrastructure
- User clicks "add 100 agents" and Exawatt provisions them

---

## Key UX Problems to Solve

1. **Accessibility:** No more localhost:1337. Download an app, it works.
2. **Setup friction:** Zero config for non-technical users. App finds local OC or provisions cloud agents.
3. **Concept overload:** No channels, instances, sessions. Just "agents" and "work."
4. **Visibility:** Crystal clear what's running, what's blocked, what's done.
5. **Morning workflow:** Glanceable dashboard. See overnight results. Unblock. Go.

## The Two Paradigms

### Fleet View (1,000 agents)
High-level overview. Agents grouped by project/goal. Status at a glance. Batch operations. Anomaly detection (which agent is stuck? burning tokens? idle?).

Potential visualizations:
- **Command grid:** Dense tile grid where each tile = one agent. Color = status. Size = activity level. Click to expand.
- **Mission board:** Horizontal swimlanes by project/goal. Agents flow left-to-right through stages. Like an airport departures board but for work.
- **Heatmap:** Time-based grid showing agent activity over 24h. Bright = active, dim = idle, red = blocked.

### Focus View (1 agent)
Deep collaboration. See the agent's live output stream. Give it direction. Review its work. Chat interface but richer — see files changed, screenshots, cost, timeline.

### Transition
Smooth zoom from fleet → focus. Click an agent tile and it expands into the focus view with an animated transition. Esc zooms back out.

---

## Visual Direction

- 2D with depth (parallax, glow, spatial cues — not full 3D navigation)
- Dark theme, high contrast
- Subtle particle effects for activity indicators
- Clean typography, information-dense but not cluttered
- Reference comps to be collected in `docs/references/`

## What Helios Replaces

The OpenClaw web UI. User downloads Exawatt, never knows about OC. "Powered by OpenClaw" under the hood.

## Voice Interaction

Not yet. Future consideration.

---

## Open Questions

1. ~~Which game engine?~~ → Godot 4
2. What's the minimum viable "wow" demo for Helios?
3. Mac App Store vs direct distribution vs both?
4. Pricing: per-seat? per-agent? usage-based?
5. How to handle auth in the Godot app (Supabase OAuth in embedded browser? Native?)
6. Should Helios prototype start with fleet view or focus view first?
7. Cloud provisioning architecture (future): how does "add 100 agents" work?

---

*Created: 2026-03-15*
*Status: Vision & Planning*
*Codename: Helios*
