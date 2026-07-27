/**
 * Quick-capture feedback bus (ENG-025 F1). The ⌘K verbs, the global
 * shortcut, and the workspace key layer all request the capture bar through
 * one window event so none of them needs the feedback provider in scope —
 * the same decoupling the workspace verbs use in session-jump.ts.
 */

export type QuickFeedbackKind = 'general' | 'bug' | 'idea';

export const OPEN_QUICK_FEEDBACK_EVENT = 'exawatt:open-quick-feedback';

export interface QuickFeedbackDetail {
  kind?: QuickFeedbackKind;
}

export function requestQuickFeedback(kind?: QuickFeedbackKind): void {
  window.dispatchEvent(
    new CustomEvent<QuickFeedbackDetail>(OPEN_QUICK_FEEDBACK_EVENT, {
      detail: { kind },
    })
  );
}

/** The surface that owns operator attention may register richer attribution
 * (active Project, durable Session) so a quick submission can say where it
 * came from without the provider knowing any workspace state. */
export interface QuickFeedbackAttribution {
  projectName: string | null;
  durableSessionId: string | null;
}

let attributionSupplier: (() => QuickFeedbackAttribution) | null = null;

export function setQuickFeedbackAttribution(
  supplier: (() => QuickFeedbackAttribution) | null
): void {
  attributionSupplier = supplier;
}

export function sampleQuickFeedbackAttribution(): QuickFeedbackAttribution | null {
  try {
    return attributionSupplier?.() ?? null;
  } catch {
    return null;
  }
}
