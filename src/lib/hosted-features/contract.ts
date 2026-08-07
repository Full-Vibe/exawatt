/**
 * ENG-030 OS1.5 — the outbound-behavior controls, in one place.
 *
 * Decision `0031` requires every Exawatt-hosted feature to carry "an
 * independent user control that prevents hosted feature calls", disclosed
 * separately from product analytics. Before this module the product had four
 * outbound behaviors and no coherent home for any of them:
 *
 *   - conversation summaries — a switch buried under *Notifications*
 *   - goal visuals          — a toggle on the exposé overlay, not in Settings
 *   - context labels        — NO control at all, while sending the most
 *   - product analytics     — a runtime opt-out with no UI
 *
 * This is the single source of truth for what each one sends, what it costs to
 * turn off, and which persisted key owns it. The Settings surface renders from
 * it and the enforcement points read from it, so a control cannot drift from
 * the sentence describing it — `docs/engineering/outbound-data.md` is the
 * published manifest and a test pins the two together.
 *
 * Adding an outbound behavior means adding it HERE, which is deliberately the
 * same edit that gives it a user-visible switch and a disclosure line.
 */

export const HOSTED_FEATURE_IDS = [
  'contextLabels',
  'conversationSummaries',
  'goalVisuals',
] as const;

export type HostedFeatureId = (typeof HOSTED_FEATURE_IDS)[number];

/** Every switch on the privacy surface, including the analytics one. */
export const OUTBOUND_CONTROL_IDS = [
  ...HOSTED_FEATURE_IDS,
  'productAnalytics',
] as const;

export type OutboundControlId = (typeof OUTBOUND_CONTROL_IDS)[number];

export interface OutboundControl {
  id: OutboundControlId;
  /** Sentence-case, product voice. Never the internal identifier. */
  label: string;
  /** What the feature gives the operator. One line. */
  purpose: string;
  /**
   * What actually leaves the device, stated concretely enough to be checked
   * against the code. Vague disclosure is worse than none — principle 4.
   */
  sends: string;
  /** Where it goes, named. */
  destination: string;
  /** What the operator loses by switching it off. Never "nothing". */
  cost: string;
  /** Default-on per decision `0031`; all of these are disclosed, not hidden. */
  defaultEnabled: boolean;
}

export const OUTBOUND_CONTROLS: Record<OutboundControlId, OutboundControl> = {
  contextLabels: {
    id: 'contextLabels',
    label: 'Session context labels',
    purpose: 'Answers "why does this Session exist?" above each Agent.',
    sends:
      'The Project name and short excerpts of recent turns from the Session being labeled, secret-redacted before they leave.',
    destination: 'Exawatt, then Anthropic',
    // Corrected 2026-08-07: there is no harness-title fallback — the local
    // provisional label from the launch task is what remains. Suppressing that
    // too would collapse every default tab to "New agent" and flip turn facts,
    // which OS0 forbids, so the local path deliberately survives.
    cost: 'New Sessions keep the label from the task you typed and stop being refined; existing labels stay.',
    defaultEnabled: true,
  },
  conversationSummaries: {
    id: 'conversationSummaries',
    label: 'Conversation summaries',
    purpose: 'Names and summarizes past conversations in the browser.',
    sends:
      'Short excerpts of the conversation being summarized, keyed by an opaque identifier. No Project or file names.',
    destination: 'Exawatt, then Anthropic',
    cost: 'Recent conversations show their raw harness titles instead.',
    defaultEnabled: true,
  },
  goalVisuals: {
    id: 'goalVisuals',
    // "Agent tile backgrounds" is the operator's chosen name for this control
    // (ENG-015 S4), shortened to "Backgrounds" in Team's chrome. "Goal visuals"
    // is roadmap vocabulary and must not reach a user-facing string; the id
    // stays internal.
    label: 'Agent tile backgrounds',
    purpose: 'Generates the ambient imagery behind Team tiles.',
    sends:
      'No text you wrote. A prompt assembled from a fixed word list in Exawatt’s source, chosen by a one-way hash of the goal.',
    destination: 'Exawatt, then fal.ai',
    cost: 'Tiles use a plain background; images already generated stay.',
    defaultEnabled: true,
  },
  productAnalytics: {
    id: 'productAnalytics',
    label: 'Product analytics',
    purpose: 'Tells us the app launched, and when something failed.',
    sends:
      'A fixed list of four events — launch, sign-in outcome, hosted-call failure, crash — against an anonymous installation id. Never content.',
    destination: 'Exawatt, then PostHog',
    cost: 'Failures affecting you become invisible to us until you report them.',
    defaultEnabled: true,
  },
};

/**
 * Persisted shape. Absent means default — never rewrite a user's settings file
 * just to record a default, and never treat "missing" as "off".
 */
export interface HostedFeaturePreferences {
  contextLabels?: { hosted: boolean };
  conversationSummaries?: { hosted: boolean };
  goalVisuals?: { enabled: boolean };
}

export function isHostedFeatureEnabled(
  preferences: HostedFeaturePreferences | null | undefined,
  id: HostedFeatureId
): boolean {
  if (!preferences) return OUTBOUND_CONTROLS[id].defaultEnabled;
  switch (id) {
    case 'contextLabels':
      return preferences.contextLabels?.hosted !== false;
    case 'conversationSummaries':
      return preferences.conversationSummaries?.hosted !== false;
    case 'goalVisuals':
      return preferences.goalVisuals?.enabled !== false;
  }
}
