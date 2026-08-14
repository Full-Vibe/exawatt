import { MAX_FEEDBACK_CONTEXT_BYTES } from '@/lib/feedback/contract';
import type { DiagnosticsReport } from '@/types/electron';
import type { QuickFeedbackKind } from './quick-feedback-events';

/**
 * What actually rides along with a quick-capture submission (ENG-025 F5).
 *
 * This is policy, not rendering, so it lives outside the provider: both rules
 * below are invariants a reviewer should be able to check in one place, and
 * neither is testable while it is inlined in a React callback.
 */

/**
 * Diagnostics attach only when the chip that announces them is on screen.
 *
 * The bar renders that chip on `kind === 'bug'` alone, while the toggle is
 * separate state that survives a kind change. Reading the toggle by itself
 * therefore sent the bundle on a General report with no affordance visible.
 * Nothing leaves the machine while its indicator is hidden, so this predicate
 * has to match the bar's render condition exactly.
 */
export function resolveQuickDiagnostics(
  kind: QuickFeedbackKind,
  attach: boolean,
  report: DiagnosticsReport | null
): DiagnosticsReport | null {
  if (kind !== 'bug' || !attach) return null;
  return report;
}

/**
 * Attach diagnostics only if the result still fits the intake's context cap.
 *
 * The report's own ceiling lives in the main process and this cap lives in
 * `@/lib/feedback/contract`; nothing structurally ties them together. They fit
 * today with room to spare, but if that ever stops being true the intake
 * rejects the WHOLE submission and the operator sees only "Send failed, draft
 * kept" with no hint that an optional attachment caused it. A bug report
 * without diagnostics beats no bug report.
 */
export function withDiagnostics(
  base: Record<string, unknown>,
  diagnostics: DiagnosticsReport | null
): Record<string, unknown> {
  if (!diagnostics) return base;
  const candidate = { ...base, diagnostics };
  const bytes = new TextEncoder().encode(JSON.stringify(candidate)).byteLength;
  return bytes <= MAX_FEEDBACK_CONTEXT_BYTES ? candidate : base;
}
