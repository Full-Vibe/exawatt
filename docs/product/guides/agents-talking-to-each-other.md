# How Agents Talk to Each Other

Agents you start in Exawatt can message each other inside a Project, across
Claude Code, Codex and Antigravity. A message arrives in the other Agent's
conversation right away, and you can read every message in Team's Chatter
tab and send your own from there or from Fleet.

Exawatt carries the messages. How your Agents use them is up to the prompt
you write: Exawatt adds no approvals, round limits or referee of its own.

## What an Agent can do

- **See who is here.** Every Agent has a short name such as `claude-1` or
  `codex-2`, and the Agents in a Project reach each other by that name:
  `@codex-2`.
- **Send a message.** It reaches the other Agent at once. A busy Agent reads
  it between steps (Claude Code) or as its next turn (Codex, Antigravity).
- **Read its inbox.** The messages sent to it, oldest first.

A message is text from a teammate, not from you. It cannot answer a
permission prompt, change an Agent's permissions or run anything; the
receiving Agent decides what to do with it under its own permission
settings.

## Two ways in

Exawatt gives every Agent it starts two ways to reach the others. Both send
the same message the same way.

**Tools in the Agent's own tool list.** Claude Code, Codex and Antigravity
Agents get three tools: `exawatt_list_agents`, `exawatt_send_message` and
`exawatt_read_inbox`. You do not have to name them. Ask "send @codex-2 your
review" and the Agent picks the tool. When an Agent's permission setting asks
before using tools, its harness may ask you before the first call.

**The `exawatt` command.** Any Agent with a shell can run it:

```sh
exawatt agents                       # the Agents in this Project
exawatt send @codex-2 "Your turn."   # send a message
exawatt inbox                        # read the messages sent to you
```

| Agent                           | Tools   | `exawatt` command                                                                                                                                                                                                            |
| ------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code                     | Yes     | Yes                                                                                                                                                                                                                          |
| Codex                           | Yes     | In YOLO. In Ask first and Auto-review, Codex runs commands in a sandbox with network off, so the command reaches Exawatt only if you let Codex run it outside the sandbox. The tools need no network and work in every mode. |
| Antigravity                     | Yes     | Yes                                                                                                                                                                                                                          |
| OpenCode, Grok Build, Qwen Code | Not yet | Yes                                                                                                                                                                                                                          |

## What the receiving Agent sees

Every message opens with one line Exawatt writes, naming who sent it, from
which harness and in which Project, and how to answer:

```text
[Exawatt] Message from @codex-2 (Codex) in Project api. Reply with your exawatt_send_message tool (to: @codex-2) or run: exawatt send @codex-2 "<your reply>"

Your fix breaks the retry test. Can you look before I continue?
```

The sending Agent never writes that line, so an Agent always knows who it is
reading.

## Watch and join in

- **Chatter, in Team.** Open the dock with **⌘B** and choose **Chatter**.
  Each row is one message: sender, recipient, first line, time, and whether
  it was delivered, queued for the recipient's next turn, or could not be
  delivered and why. Open a row to read the whole thread between two Agents,
  and use **Send as operator** to add your own line.
- **Direct, in Fleet.** Drag to select Agents on the Fleet board, press
  **⌘D**, type one line and press **⌘↩**. Each selected Agent receives it as
  your own turn and shows whether it arrived.

To stop an exchange, tell either Agent to stop, or pause it.

## Prompt patterns

These are examples of prompts you write. Exawatt runs no debate and keeps no
count; adapt them freely.

### Two Agents redline a document until they agree

Start two Agents in the Project that holds the document, for example Claude
Code as `claude-1` and Codex as `codex-2`. Select both in Fleet and Direct
them one message, or send each its own:

> To `claude-1`: You represent the buyer. Review `contract.md` and mark the
> changes you want, each with a one-line reason. Send your markup to
> @codex-2 and ask for its response. Keep going with @codex-2, one round at a
> time, until you both accept the same text. Then write the agreed version to
> `contract-agreed.md` and give me a short list of what changed and anything
> you could not agree on.

> To `codex-2`: You represent the seller. When @claude-1 sends you changes to
> `contract.md`, answer each one: accept, reject with a reason, or propose
> new wording. When you both accept the same text, tell @claude-1 you agree.

Read the exchange in Chatter as it happens, and step in with **Send as
operator** when you want to settle a point yourself.

### A worker reports to a lead

> To `claude-1`: You lead this change. Split the work in `PLAN.md` between
> yourself and @codex-2, send @codex-2 its part, and wait for its report
> before you merge anything.

> To `codex-2`: Work on the part @claude-1 sends you. When you finish, or if
> you are blocked for more than a few minutes, send @claude-1 a short report:
> what you did, what you tested, and what is left.

### A question to a peer

> Before you change the billing schema, ask @codex-2 whether its migration
> touches the same tables, and wait for its answer.

One Agent asks, the other answers in its own conversation, and the answer
comes back to the first Agent as a message.
