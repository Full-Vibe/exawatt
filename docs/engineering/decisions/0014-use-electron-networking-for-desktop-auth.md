# 0014 Use Electron-native networking for desktop authentication

Date: 2026-07-12
Status: accepted

## Context

Exawatt's system-browser OAuth flow is owned by Electron main so the renderer
never receives the PKCE verifier, authorization code, or session tokens. The
first main-process implementation allowed Supabase to use Node's global
`fetch`, which is backed by Undici. In the packaged macOS app, the real PKCE
token exchange failed before any HTTP response with `TypeError: fetch failed`;
the recursively inspected cause was an `AggregateError` with `EBADF`.

That evidence did **not** isolate the root cause to Node. After switching to
Electron `net.fetch`, the same real exchange failed as
`net::ERR_INVALID_HANDLE`, while controlled invalid and successful token
requests worked through both transports. The persistent lifecycle trace showed
that Google authorization, the custom-protocol callback, PKCE state, and
request construction were all correct. The operator then found a blocking
Little Snitch rule; allowing the request made the unchanged installed build's
Google sign-in succeed. The observed outage was therefore a local network-filter
policy, with different low-level error surfaces from the two HTTP stacks.

Electron provides `net.fetch` specifically for main-process HTTP through
Chromium's network stack. It follows Electron session behavior and is distinct
from Node's HTTP stack. Desktop auth is a native-shell concern, so this is the
framework-owned transport boundary rather than a lower-level workaround.

The packaged app also lacked durable diagnostics. Console output disappeared
with the process, and the renderer intentionally received only a safe generic
error. That made repeated production-path failures difficult to distinguish.

## Decision

- All Electron-main Supabase auth clients receive an explicit fetch
  implementation; the coordinator has no implicit global-fetch fallback.
- Production uses Electron `net.fetch`, wrapped without changing request or
  response semantics. Tests may inject a deterministic fetch implementation.
- The app writes a bounded, rotating `logs/auth.jsonl` file under Electron's
  machine-local `userData` directory.
- Diagnostics correlate OAuth lifecycle phases and record transport name,
  method, host/path, query and header names, body type/length, response
  status/timing, cookie read/mutation counts, and recursively nested error
  name/code/errno/syscall/cause information.
- Diagnostics never record authorization-code values, verifier values, token
  values, request bodies, or header values. Text fields are length-bounded and
  redact credential-shaped keys, bearer values, JWTs, and long opaque values.
- The packaged auth evaluation must use the same coordinator, cookie adapter,
  and Electron-native transport as production and verify the installed app
  after dogfood integration.

## Consequences

- Desktop auth uses the network stack Electron documents for its main process
  as an explicit native-shell boundary. This is an architectural consistency
  choice, not the fix for the observed Little Snitch outage.
- A future transport substitution is explicit and testable at the coordinator
  boundary instead of being selected accidentally by the JavaScript runtime.
- Production failures leave enough durable evidence to identify the failing
  phase and nested platform error without weakening the renderer IPC boundary
  or persisting credentials.
- `EBADF`, `ERR_INVALID_HANDLE`, and similar transport errors are not sufficient
  by themselves to assign root cause to Node, Electron, Supabase, or Google.
  Triage must also check local firewall, privacy, VPN, proxy, and DNS policy.
- Synthetic endpoint probes validate request compatibility and service reachability
  but cannot prove that an operator-specific network filter will allow the real
  OAuth exchange.
- The log adds small synchronous writes only during rare authentication events;
  it rotates at one megabyte and retains one prior file.
