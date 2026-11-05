# 0054 Background work never opens an app or a browser tab

Date: 2026-11-04
Status: accepted (operator decision); execution is BUG-335

## Context

Incident `0042`: Exawatt's Google plan read runs `agy -p "/usage"` in the
background. When `agy` could not refresh its token (a dark wake with no
network, or a signed-out CLI), its print mode opened a Google sign-in in the
operator's default browser and waited. Between 2026-10-20 and 2026-11-04 that
put 188 sign-in tabs in the operator's browser, up to 56 in a day. The first
fix (no read while the Mac sleeps or is locked, and a backoff after timeouts)
reduced the tabs but still allowed one now and then. On 2026-11-04 the
operator said: "No I never want it to open a browser tab surreptitiously on
the user's computer."

Any command-line tool can do this: a sign-in fallback, an update notice, a
shell startup file. Exawatt cannot vet every harness version, so the rule
has to hold whatever the tool does.

## Decision

1. **Nothing Exawatt runs in the background opens an app, a document or a
   URL.** Exawatt itself opens a browser page, an app or System Settings only
   from an operator's click (sign-in, a terminal link, an install guide, a
   settings button).
2. **Enforced by the OS, not by trusting the tool.** On macOS, every
   login-shell command that runs outside a visible Session (plan reads,
   probes, catalogs, recaps, the Codex app-server, bus source commands) is
   planned by `planUnattendedLaunch` and runs under
   `/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny lsopen)'`.
   Everything else is allowed; asking Launch Services to open anything is
   refused, and every child process inherits the refusal.
3. **Fail closed.** If the sandbox cannot start, the command does not run;
   the work reports a failure. There is no unsandboxed fallback.
4. **A sign-in the tool asks for is reported, not opened.** When a
   background read meets a harness's sign-in prompt, it stops there and the
   card says the app isn't signed in. The operator signs in from the
   harness's own terminal.
5. **Visible Sessions are not sandboxed.** A Session the operator started
   and is watching keeps the plain login shell, so a harness's own sign-in or
   `open` works there as it does in any terminal.

## Consequences

- A test pins that only the visible Session launch (`session-manager.ts`)
  still uses `planLoginShell` directly; a new background launch that skips
  the sandbox fails it.
- Fixed read-only system tools Exawatt runs by absolute path or with fixed
  arguments (`git`, `ps`, `plutil`, `pgrep`, `ssh` for tunnels) are outside
  this record: none has a path to opening an app.
- Exawatt ships only for macOS. Elsewhere (CI on Linux) the shell runs
  directly; a future Windows or Linux build needs its own enforcement before
  it ships.
- This is not the harness wrapping decision `0044` rules out: `0044` forbids
  killing, wrapping or patching a harness's power process to simulate
  control. The sandbox changes no harness behavior except refusing an OS
  capability the operator never granted to background work.
