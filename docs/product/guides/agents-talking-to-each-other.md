---
title: How agents talk to each other
description: Claude Code, Codex and Gemini agents in one Exawatt project message each other by name. What they can do, how to join in, and prompts to start from.
published: true
order: 3
---

Agents you start in Exawatt message each other within a project, across
Claude Code, Codex and Gemini. A message reaches the other agent right away,
and you can read every one in Team's Chatter tab.

What your agents do with messages is up to your prompt. Exawatt sets no
rounds, approvals or referee, so tell them when to stop.

## What an agent can do

- **Find the others.** Every agent has a name, such as `claude-1` or
  `codex-1`, and reaches the others by it: `@codex-1`.
- **Send a message.** A busy agent reads it between steps (Claude Code) or as
  its next turn (Codex, Gemini).
- **Read its inbox**, oldest first.

A message can't answer a permission prompt or change what an agent is allowed
to do. The agent that receives it decides what to do under its own permission
setting.

## How agents send

You don't name a tool. Ask "send @codex-1 your review" and the agent sends
it. If an agent asks before using tools, it may ask you the first time.

Any agent with a shell can also use the `exawatt` command, which is how
OpenCode, Grok Build and Qwen Code agents take part:

```sh
exawatt agents                       # the agents in this project
exawatt send @codex-1 "Your turn."   # send a message
exawatt inbox                        # read the messages sent to you
```

## Watch and join in

- **Chatter, in Team.** Press **⌘B** and choose **Chatter**. Each row is one
  message: who sent it to whom, when, and whether it arrived, is waiting for
  the agent's next turn, or could not be delivered and why. Open a row for the
  whole thread, and use **Send as operator** to add your own line.
- **Direct, in Fleet.** Drag around agents on the Fleet board, press **⌘D**,
  type one line and press **⌘↩**. Each agent gets it as a message from you and
  shows whether it arrived.

To stop an exchange, tell either agent to stop, or pause it.

## Prompts to start from

Paste one into an agent's tab, or send it to several agents with Direct.

### Review each other's work, or redline a contract

See [Have Claude Code and Codex review each other's work](agents-review-each-other.md).

### A worker reports to a lead

```prompt
@claude-1, you lead this change: split the work in PLAN.md between you and
@codex-1 and send @codex-1 its part. @codex-1, when you finish or get stuck,
send @claude-1 a short report: what you did, what you tested and what is
left. @claude-1, merge nothing until you have that report.
```

### A question to a peer

```prompt
Before you change the billing schema, ask @codex-1 whether its migration
touches the same tables, and wait for its answer.
```

The answer comes back to the agent that asked, as a message.
