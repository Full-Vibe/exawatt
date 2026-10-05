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
 *
 * 2026-08-07: a THIRD category joined hosted features and analytics — outbound
 * behavior under the operator's OWN credentials. The re-entry recap pipes raw
 * terminal scrollback to the operator's local `claude` CLI, which reaches
 * Anthropic under their Claude Code sign-in and never touches Exawatt.
 * Nothing about it is "hosted by Exawatt", so it gets its own group on the
 * Privacy surface rather than borrowing either existing one — the same
 * structural-separation reasoning decision `0031` applied to analytics.
 *
 * 2026-08-10: a FOURTH category — public sharing. The operator profile is the
 * only control here that makes data PUBLIC, and the only one that defaults
 * OFF: publishing is opt-in under decision `0029`, and turning the switch on
 * is the consent act. It is not a hosted feature (those improve the app for
 * you privately), not your-own-accounts traffic, and not analytics, so it
 * borrows none of those groups.
 */

export const HOSTED_FEATURE_IDS = [
  'contextLabels',
  'conversationSummaries',
  'goalVisuals',
] as const;

export type HostedFeatureId = (typeof HOSTED_FEATURE_IDS)[number];

/** Outbound behaviors that run through the operator's own local sign-ins;
 *  Exawatt's servers are never on the path. */
export const OWN_ACCOUNT_FEATURE_IDS = [
  'reentryRecap',
  'claudePlanWindows',
  'codexPlanWindows',
  'googlePlanWindows',
] as const;

export type OwnAccountFeatureId = (typeof OWN_ACCOUNT_FEATURE_IDS)[number];

/** Outbound behaviors that publish data for anyone to read. Off by default —
 *  the opposite of everything else here (decision `0029`). */
export const PUBLIC_SHARING_FEATURE_IDS = ['operatorProfile'] as const;

export type PublicSharingFeatureId =
  (typeof PUBLIC_SHARING_FEATURE_IDS)[number];

/** Every switch on the privacy surface, including the analytics one. */
export const OUTBOUND_CONTROL_IDS = [
  ...HOSTED_FEATURE_IDS,
  ...OWN_ACCOUNT_FEATURE_IDS,
  ...PUBLIC_SHARING_FEATURE_IDS,
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
  /** Default-on per decision `0031` for hosted/own-account/analytics rows;
   *  public sharing is default-OFF per decision `0029`. Disclosed either way. */
  defaultEnabled: boolean;
  /** Null only for traffic no distribution capability gates — outbound that
   * leaves through a separate program with its own network identity. Anything
   * else names the capability, and the Privacy surface renders an honest "not
   * configured in this build" state instead of a dead switch. */
  requiresDistributionCapability:
    | 'enrichment.contextLabels'
    | 'enrichment.conversationSummaries'
    | 'enrichment.goalVisuals'
    | 'services.operatorStats'
    | 'analytics'
    | null;
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
    requiresDistributionCapability: 'enrichment.contextLabels',
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
    requiresDistributionCapability: 'enrichment.conversationSummaries',
  },
  goalVisuals: {
    id: 'goalVisuals',
    // "Agent tile backgrounds" is the operator's chosen name for this control
    // (ENG-015 S4), shortened to "Backgrounds" in Team's chrome. "Goal visuals"
    // is roadmap vocabulary and must not reach a user-facing string; the id
    // stays internal.
    label: 'Agent tile backgrounds',
    purpose: 'Generates the ambient imagery behind Team tiles.',
    // RESTORED 2026-08-19 (BUG-091), and the detour is worth recording. This
    // sentence was weakened the same week because it was false: the request
    // carried `{ schemaVersion, projectKey, label }`, and that label is the
    // accepted Session label, which an operator correction may have typed. The
    // weaker sentence was a holding position for a payload that should not
    // have existed, not a decision. The request now carries `{ schemaVersion,
    // identityKey }` — one opaque digest computed in `context-summarizer.ts`
    // and nothing else — so the stronger claim is true of Exawatt and not only
    // of fal.ai. It may be weakened again only if the payload widens again.
    sends:
      'No text you wrote. A prompt assembled from a fixed word list in Exawatt’s source, chosen by a one-way hash of the goal.',
    destination: 'Exawatt, then fal.ai',
    cost: 'Tiles use a plain background; images already generated stay.',
    defaultEnabled: true,
    requiresDistributionCapability: 'enrichment.goalVisuals',
  },
  reentryRecap: {
    id: 'reentryRecap',
    // "since you left" is the label the recap line itself carries in the
    // context bar (ENG-016 D18); the control is named after what the operator
    // has seen on screen, not after "re-entry recap", which is roadmap
    // vocabulary and must not reach a user-facing string.
    label: 'Since-you-left recaps',
    purpose:
      'Answers "what changed while you were away?" when you return to a Session.',
    sends:
      'Up to 6,000 characters of recent terminal output from the Session you return to, exactly as it appeared on screen and not redacted.',
    // Unlike everything above, this never touches Exawatt: the recap runs the
    // claude CLI already signed in on this machine, so the request is the
    // operator's own API traffic.
    destination:
      'Anthropic, through your own Claude Code sign-in, never Exawatt',
    cost: 'Coming back to a Session shows no "since you left" line; you catch up by reading the terminal.',
    defaultEnabled: true,
    // Genuinely null: the recap shells out to the operator's own `claude`
    // CLI, a separate program with its own firewall identity. Nothing here
    // travels under Exawatt's signature, so no distribution declaration gates
    // it (incident `0011`, "Current remedy").
    requiresDistributionCapability: null,
  },
  claudePlanWindows: {
    id: 'claudePlanWindows',
    // ENG-038: named after what the operator sees — the Claude rows in the
    // Usage meter and page. "Plan windows" is claude.ai's own vocabulary
    // (session and weekly limits).
    label: 'Claude plan usage',
    purpose:
      'Shows your Claude session and weekly limits in the Usage meter and page.',
    sends:
      'Nothing from Exawatt. Your own claude app asks your Claude account for its usage, under the sign-in Claude Code already keeps. Exawatt never reads that sign-in.',
    destination:
      'Anthropic, through your own Claude Code sign-in, never Exawatt',
    cost: 'Claude shows no plan windows here; local token counts stay.',
    defaultEnabled: true,
    // Genuinely null since ENG-038 slice 3 (2026-10-04): the request is made
    // by the operator's own `claude` binary under its own firewall identity,
    // never under Exawatt's signature, so no distribution declaration gates
    // it. Before slice 3 it left through Exawatt's own Chromium stack with a
    // Keychain token and was gated on a distribution declaration (BUG-060).
    requiresDistributionCapability: null,
  },
  codexPlanWindows: {
    id: 'codexPlanWindows',
    label: 'Codex plan usage',
    purpose:
      'Shows your Codex limits, credits, and free resets in the Usage meter and page.',
    sends:
      'Nothing from Exawatt. Your own codex app asks your ChatGPT account for its usage, under the sign-in Codex already keeps. Exawatt never reads that sign-in.',
    destination: 'OpenAI, through your own Codex sign-in, never Exawatt',
    cost: 'Codex limits update only when a Codex Agent runs, and free resets are not shown.',
    defaultEnabled: true,
    // Genuinely null, like the recap: the request is made by the operator's
    // own `codex` binary under its own firewall identity, never under
    // Exawatt's signature, so no distribution declaration gates it.
    requiresDistributionCapability: null,
  },
  googlePlanWindows: {
    id: 'googlePlanWindows',
    // ENG-038 slice 4: the Google account Antigravity draws on. "Weekly
    // limits" per model group is Antigravity's own vocabulary.
    label: 'Google plan usage',
    purpose:
      'Shows your Google weekly limits for Gemini and for Claude and GPT models in the Usage meter and page.',
    sends:
      'Nothing from Exawatt. Your own Antigravity app asks your Google account for its usage, under the sign-in Antigravity already keeps. Exawatt never reads that sign-in or your Antigravity conversations.',
    destination:
      'Google, through your own Antigravity sign-in, never Exawatt',
    cost: 'Google shows no plan limits here.',
    defaultEnabled: true,
    // Genuinely null, like the Claude and Codex reads: the request is made
    // by the operator's own `agy` binary under its own firewall identity.
    requiresDistributionCapability: null,
  },
  operatorProfile: {
    id: 'operatorProfile',
    // "Publishing" is the word the leaderboard panel's switch carries; this
    // row names the thing being published. Decision `0029` owns the exact
    // upload allowlist the `sends` sentence summarizes.
    label: 'Public operator profile',
    purpose: 'Keeps your profile on the public leaderboard up to date.',
    sends:
      'Aggregate daily totals and Run records (agent hours, fleet size, durations, and token counts) with your GitHub-seeded handle, name, and avatar. Never prompts, responses, code, Project names, paths, or transcripts.',
    destination: 'Exawatt’s public leaderboard',
    cost: 'Your public profile stops updating; it stays visible until you remove it.',
    defaultEnabled: false,
    requiresDistributionCapability: 'services.operatorStats',
  },
  productAnalytics: {
    id: 'productAnalytics',
    label: 'Product analytics',
    purpose: 'Tells us the app launched, and when something failed.',
    sends:
      'Four fixed events (launch, sign-in outcome, hosted-call failure, crash) against an anonymous installation id. Never content.',
    destination: 'Exawatt, then PostHog',
    cost: 'Failures affecting you become invisible to us until you report them.',
    defaultEnabled: true,
    requiresDistributionCapability: 'analytics',
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
  reentryRecap?: { enabled: boolean };
  claudePlanWindows?: { enabled: boolean };
  codexPlanWindows?: { enabled: boolean };
  googlePlanWindows?: { enabled: boolean };
  operatorProfile?: { autoPublish: boolean };
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

export function isReentryRecapEnabled(
  preferences: HostedFeaturePreferences | null | undefined
): boolean {
  if (!preferences) return OUTBOUND_CONTROLS.reentryRecap.defaultEnabled;
  return preferences.reentryRecap?.enabled !== false;
}

export function isClaudePlanWindowsEnabled(
  preferences: HostedFeaturePreferences | null | undefined
): boolean {
  if (!preferences) return OUTBOUND_CONTROLS.claudePlanWindows.defaultEnabled;
  return preferences.claudePlanWindows?.enabled !== false;
}

export function isCodexPlanWindowsEnabled(
  preferences: HostedFeaturePreferences | null | undefined
): boolean {
  if (!preferences) return OUTBOUND_CONTROLS.codexPlanWindows.defaultEnabled;
  return preferences.codexPlanWindows?.enabled !== false;
}

export function isGooglePlanWindowsEnabled(
  preferences: HostedFeaturePreferences | null | undefined
): boolean {
  if (!preferences) return OUTBOUND_CONTROLS.googlePlanWindows.defaultEnabled;
  return preferences.googlePlanWindows?.enabled !== false;
}

/**
 * Deliberately `=== true`, never `!== false`: publishing is opt-in (decision
 * `0029`), so absent, malformed, or missing settings all mean OFF. This is the
 * one accessor in this module with that polarity.
 */
export function isOperatorAutoPublishEnabled(
  preferences: HostedFeaturePreferences | null | undefined
): boolean {
  return preferences?.operatorProfile?.autoPublish === true;
}
