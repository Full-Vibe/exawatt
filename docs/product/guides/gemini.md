---
title: Run Gemini in Exawatt
description: Install Google's Antigravity CLI, sign in with Google, and start Gemini agents beside Claude Code and Codex.
published: true
order: 2
---

Exawatt runs Gemini through Google's Antigravity CLI, `agy`, signed in with
your own Google account. Your Gemini agents work beside Claude Code and Codex,
and they can message each other.

You need [Exawatt for Mac](/download) and a Google account.

## 1. Install the Antigravity CLI

In Terminal, run:

```sh
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

Or follow [Google's install steps](https://antigravity.google/docs/getting-started?tab=cli).

## 2. Sign in to Google

In Exawatt, open a project, press **⌘T** and choose **Gemini**. If it asks
you to sign in, choose **Sign in to Google in Antigravity**. A Shell tab opens
running `agy`: finish its first-run steps, sign in with Google in your
browser, then choose **Recheck**.

Google's terms don't cover third-party launchers on consumer plans. Exawatt
runs your own `agy` with your own Google sign-in
([Google's FAQ](https://antigravity.google/docs/faq/)).

## 3. Start Gemini

Press **⌘T**, choose **Gemini**, type a task or leave it blank, and press
**Enter**. Your agent is named `gemini-1`. The first time Gemini works in a
folder, it asks you to trust it there.

Exawatt shows when Gemini is working and when it is done. When it needs an
answer from you, it asks in its own tab.

## Message it from your other agents

Agents in the same project reach Gemini by name. Ask Claude Code or Codex:

```prompt
Send @gemini-1 the failing test output and ask it for a fix. Review its
answer before you apply it.
```

Every message shows up in Team's **Chatter** tab. The
[review loop](agents-review-each-other.md) works the same way with Gemini.

## Antigravity swarms

Antigravity CLI 1.5.5 (November 10, 2026) added `/swarm`, in preview. Your
conversation becomes a coordinator that adds Gemini workers, each in its own
conversation. They split the task, work in parallel and talk on one shared
message board, which `/swarm board` or **Alt+S** opens full screen in the
terminal ([Google's swarm docs](https://antigravity.google/docs/swarm),
[release notes](https://github.com/google-antigravity/antigravity-cli/releases/tag/1.5.5)).

A swarm and Exawatt's messaging do different jobs. A swarm is one Antigravity
conversation handing pieces of a task to Gemini workers. Exawatt is agents from
different labs messaging each other by name, with every message in Chatter.

Swarm workers aren't Exawatt agents. They don't get a name like `gemini-1`,
your other agents can't message them, and their posts stay on Antigravity's
board, not in Chatter. When you want a second opinion from another lab, have
Claude Code or Codex check Gemini's work with the
[review loop](agents-review-each-other.md).

Google warns that a swarm uses quota much faster than a single conversation.
Before Antigravity CLI 1.5.13 (November 19, 2026), an agent could start a
swarm on its own when you hadn't typed `/swarm`. That includes a Gemini agent
you start in Exawatt, since Exawatt runs your own `agy`. From 1.5.13 the agent
isn't offered the swarm skill any more, so a swarm starts only when you type
`/swarm` ([1.5.13 release notes](https://github.com/google-antigravity/antigravity-cli/releases/tag/1.5.13)).
If your Gemini quota ran down faster than your tasks explain, update the CLI:

```sh
agy update
```
