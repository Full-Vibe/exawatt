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
// The operator allowlist is private deployment configuration. The browser's
// temporary JSON seam remains separate until WP1b can replace it with a
// server-derived capability alongside the nullable Supabase client work.

export const OPERATOR_LANE = 'operator';
export const SUGGESTIONS_LANE = 'suggestions';

export function parseOperatorEmails(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isOperatorEmail(email, operatorEmails) {
  return (
    typeof email === 'string' &&
    operatorEmails?.has(email.trim().toLowerCase()) === true
  );
}

export function laneForEmail(email, operatorEmails) {
  return isOperatorEmail(email, operatorEmails)
    ? OPERATOR_LANE
    : SUGGESTIONS_LANE;
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
export function partitionFeedbackLanes(rows, emailsByUserId, operatorEmails) {
  const operator = [];
  const suggestions = [];
  for (const row of rows ?? []) {
    const email = emailsByUserId?.get(row.user_id) ?? null;
    const lane = laneForEmail(email, operatorEmails);
    const classified = { ...row, user_email: email, lane };
    if (lane === OPERATOR_LANE) operator.push(classified);
    else suggestions.push(classified);
  }
  return { operator, suggestions };
}
