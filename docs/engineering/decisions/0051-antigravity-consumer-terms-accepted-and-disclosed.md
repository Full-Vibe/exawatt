# 0051 Antigravity's consumer-plan terms: accepted risk, disclosed in the source card

Date: 2026-10-14
Status: accepted — operator decision; execution is ENG-003 S5.3.1

## Context

ENG-003 S5.3 shipped Antigravity CLI (`agy`) as a launchable source on
2026-10-05: Exawatt starts the user's own `agy -i` in a real terminal, learns
the conversation id from the first hook, and reads `agy models` for the
catalog and `agy -p "/usage"` for the usage card. The landing recorded Google's
brand terms (no mark ships) but not the usage terms.

Read on 2026-10-14, Antigravity's FAQ says that "Using third-party software,
tools, or services to access Antigravity is a violation of our Terms of
Service" that "can result in suspension or termination of your account"; that
headless mode "is intended for direct scripting and CI workflows"; that
"Wrapping `agy` inside third-party coding agents or applications ... is not
supported under consumer plans"; and recommends a Gemini Enterprise or Google
AI Studio API key for third-party coding agents. OpenClaw closed its request
for an Antigravity backend as not planned on 2026-08-02 for this reason. No
Google staff statement on third-party desktop launchers was found.

Exawatt's posture differs from a wrapper: it launches the user's own binary
with the user's own sign-in in a terminal the user watches and types into, as
a terminal multiplexer would, and never injects credentials (decision `0027`).
The headless reads are two non-agent commands. Whether Google reads that as
"third-party software ... to access Antigravity" is unknown. The exposure is
the user's Google account, not Exawatt's.

Raised once with these facts (the standing rule for legal and compliance
exposure); the operator's answer: "Accept the risk and disclose."

## Decision

1. **Antigravity CLI stays a shipped source**, launched as today.
2. **The source card discloses the exposure in one plain line** in Settings and
   in the composer's source detail, in production voice: that Google's terms
   do not cover third-party launchers on consumer plans, that the launch uses
   the user's own `agy` and sign-in, and a link to the FAQ. No gate, no
   consent step, no re-raising.
3. **The public source reference states the same fact** beside the four
   Antigravity facts it already carries.
4. **Nothing Exawatt does makes the exposure larger than a terminal would**:
   no credential handling, no headless agent turns on the user's behalf, no
   spoofed client identity. Exawatt-owned headless turns (for example a future
   bus delivery through `--input-format stream-json`) are not covered by this
   decision and need their own.
5. **A change in the facts reopens the question**: a Google statement either
   way, a user report of enforcement, or Exawatt-hosted Gemini placement
   (ENG-033 H3 names a managed Gemini environment, which is Google's own API
   and outside this exposure).

## Consequences

- ENG-003 S5.3.1 carries the disclosure line and the reference update.
- Marketing may name Gemini and Antigravity as supported; it may not claim
  Google endorses the integration.
- Gemini CLI, which Google positions for API keys and enterprise, remains the
  terms-clean Google path and keeps its named trigger in ENG-003.
