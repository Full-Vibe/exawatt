import type { ProductFeedbackRequest } from './contract';

/** Shape of `app:get-build-info` (see `ExawattBuildInfo`); partial so a
 *  renderer running against an older main process still enriches what it can. */
export interface FeedbackBuildInfo {
  sha?: string | null;
  branch?: string | null;
  delivery?: string | null;
  version?: string | null;
}

type FeedbackDraft = Omit<ProductFeedbackRequest, 'idempotencyKey'>;

/**
 * ENG-025: every intake row — quick capture, Help modal, context-label votes —
 * carries the identifying build metadata, so a report from an installed build
 * is attributable without SHA archaeology. `app_version` and `build_sha` are
 * intake columns; branch and delivery channel ride in the `context` jsonb.
 * Caller-provided values always win, and missing build info degrades to the
 * unenriched draft (metadata is context, never a condition of feedback).
 */
export function applyBuildMetadata(
  draft: FeedbackDraft,
  build: FeedbackBuildInfo | null
): FeedbackDraft {
  if (!build) return draft;
  const context: Record<string, unknown> = { ...draft.context };
  if (build.branch && context.buildBranch === undefined) {
    context.buildBranch = build.branch;
  }
  if (build.delivery && context.buildDelivery === undefined) {
    context.buildDelivery = build.delivery;
  }
  return {
    ...draft,
    buildSha: draft.buildSha ?? build.sha ?? null,
    appVersion: draft.appVersion ?? build.version ?? null,
    context,
  };
}
