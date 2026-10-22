---
title: Have Claude Code and Codex review each other's work
description: Let Claude Code write and Codex review, in one Exawatt project, until both approve. You read every message between them.
published: true
order: 1
---

One agent makes the change, an agent from another lab reviews it, and they
go back and forth until both approve. You read every message.

You need [Exawatt for Mac](/download), with Claude Code and Codex installed
and signed in.

## 1. Start two agents

Open your project from the Start screen. Press **⌘T**, choose Claude Code and
press **Enter**. Press **⌘T** again and start Codex the same way. Each tab
shows the agent's name, such as `claude-1` and `codex-1`.

## 2. Send both one line

Switch to **Fleet**, drag around both agents, press **⌘D** and paste:

```prompt
@claude-1, fix the failing test in checkout.test.ts. @codex-1, review
@claude-1's change and send it your notes. Go back and forth until you both
approve, or stop after three rounds, then tell me what you still disagree on.
```

Press **⌘↩**. Each agent shows whether it got the message.

## 3. Read along

Switch to **Team**, press **⌘B** and choose **Chatter**. Every message
between the two agents appears as it is sent. Open one to read the whole
thread, or use **Send as operator** to settle a point yourself.

To stop early, tell either agent to stop. Every round uses both your Claude
and your Codex plan, so keep the round limit in the prompt.

## The same loop on a contract

Two agents can redline a document until they agree. Open the folder that
holds the contract, start both agents, and send:

```prompt
@claude-1, you represent the buyer. @codex-1, you represent the seller.
Redline contract.md one round at a time, sending each other your changes and
your reasons, until you both accept the same text. Write it to
contract-agreed.md and tell me what you could not agree on.
```

More prompts are in [How agents talk to each other](agents-talking-to-each-other.md).
