// ENG-025 F3: two lanes over one intake.
//
// Every ⌘⇧F submission lands in the same `product_feedback` table. Lane
// membership is derived here, server-side, from the SUBMITTING ACCOUNT'S auth
// record — never from a client-supplied field — so a non-operator row cannot
// forge its way into the triage-to-canon queue.
//
//   operator lane    → promotes to canonical repo state (the F2 protocol)
//   suggestions lane → read and considered, never auto-promoted
//
// The operator allowlist is shared with `src/lib/auth/admin.ts` through
// `src/lib/auth/admin-emails.json`. This file is `.mjs` and that module is
// TypeScript, so the JSON is the one source of truth both read; do not
// re-type the addresses here.

import { readFileSync } from 'node:fs';

export const OPERATOR_LANE = 'operator';
export const SUGGESTIONS_LANE = 'suggestions';

const OPERATOR_EMAILS = new Set(
  JSON.parse(
    readFileSync(
      new URL('../../src/lib/auth/admin-emails.json', import.meta.url),
      'utf8'
    )
  ).map(email => String(email).trim().toLowerCase())
);

/** Mirrors `isAdminEmail` in `src/lib/auth/admin.ts` over the same list. */
export function isOperatorEmail(email) {
  return (
    typeof email === 'string' &&
    OPERATOR_EMAILS.has(email.trim().toLowerCase())
  );
}

export function laneForEmail(email) {
  return isOperatorEmail(email) ? OPERATOR_LANE : SUGGESTIONS_LANE;
}

/**
 * Split untriaged rows into the two lanes.
 *
 * `emailsByUserId` must come from the auth admin API (`listUsers`). The row is
 * only ever consulted for its `user_id`; taking the address from the auth
 * record rather than the row is what makes lane membership unforgeable.
 *
 * Rows whose account cannot be resolved (deleted user, missing address) fall
 * into the suggestions lane: unknown provenance never earns canon authority.
 *
 * Returns each row annotated with the resolved `user_email` and its `lane`.
 */
export function partitionFeedbackLanes(rows, emailsByUserId) {
  const operator = [];
  const suggestions = [];
  for (const row of rows ?? []) {
    const email = emailsByUserId?.get(row.user_id) ?? null;
    const lane = laneForEmail(email);
    const classified = { ...row, user_email: email, lane };
    if (lane === OPERATOR_LANE) operator.push(classified);
    else suggestions.push(classified);
  }
  return { operator, suggestions };
}
