export interface ContextLabelGoldCase {
  id: string;
  currentLabel: string | null;
  instructions: string[];
  expectedLabel: string;
  expectedRelationship: 'same_context' | 'new_context';
  note: string;
}

/** Sanitized, production-derived regressions plus calibration cases. */
export const CONTEXT_LABEL_GOLD_CASES: ContextLabelGoldCase[] = [
  {
    id: 'dogfood-stale-reopen-tabs',
    currentLabel: 'Implement cmd+shift+t to reopen tabs',
    instructions: [
      'Also where do we stand with our agent title summarization system? It has been pretty bad. Do some research and ask me questions.',
      'I need the label to explain why this session exists and page in the overall context.',
      'Yes, proceed. Improve the summarization and feedback system.',
    ],
    expectedLabel: 'Improve agent context summaries',
    expectedRelationship: 'new_context',
    note: 'Primary stale-label screenshot regression.',
  },
  {
    id: 'dogfood-image-only-launch',
    currentLabel: null,
    instructions: ['/var/folders/example/T/exawatt-clipboard/example.png'],
    expectedLabel: 'New agent',
    expectedRelationship: 'new_context',
    note: 'Attachment paths must never become visible context.',
  },
  {
    id: 'dogfood-project-ribbon-to-agent-sources',
    currentLabel: 'Close projects with animation',
    instructions: [
      'Productionize the accepted Agent Sources design with careful validation and polished UI.',
      'Reconcile the source registry, Settings, and agent composer with the live provider catalogs.',
    ],
    expectedLabel: 'Trustworthy agent sources and launch UX',
    expectedRelationship: 'new_context',
    note: 'A later multi-turn implementation initiative must replace an older product-area label.',
  },
  {
    id: 'widget-related-subtask',
    currentLabel: 'MVP of Widget Checkout',
    instructions: [
      'Build the MVP of Widget Checkout.',
      'Fix the postal-code validation in the checkout form.',
    ],
    expectedLabel: 'MVP of Widget Checkout',
    expectedRelationship: 'same_context',
    note: 'Mechanical subtasks should not churn the work-world cue.',
  },
  {
    id: 'company-listing-pivot',
    currentLabel: 'Fix auth redirect loop',
    instructions: [
      'Investigate Northstar Health for inclusion in our company listing.',
    ],
    expectedLabel: 'Investigate Northstar Health for listing',
    expectedRelationship: 'new_context',
    note: 'A genuine unrelated instruction must replace stale context.',
  },
  {
    id: 'patty-flowsheet',
    currentLabel: null,
    instructions: [
      'Get the flowsheet scraper working for Patty so she can review patient records.',
    ],
    expectedLabel: 'Flowsheet scraping for Patty',
    expectedRelationship: 'new_context',
    note: 'Preserve the person and domain anchor that aid recall.',
  },
];
