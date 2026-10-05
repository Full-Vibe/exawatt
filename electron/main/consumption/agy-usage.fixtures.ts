/**
 * Real `agy -p "/usage" --output-format json` output, captured 2026-10-05 on
 * Antigravity CLI 1.2.17 (`agy --version`) against the operator's signed-in
 * account. Nothing was edited.
 *
 * These are the format evidence the parser is pinned to. They are captured,
 * not authored: when Antigravity changes the report, capture a new one and
 * add it beside these rather than editing them, so a format change stays a
 * visible event in the history.
 */

/** Monday morning: the Gemini group at 0.1% remaining until Thursday, the
 *  Claude and GPT group untouched. The answer costs no agent turn. */
export const SIGNED_IN_NEARLY_SPENT = {
  conversation_id: '',
  status: 'SUCCESS',
  response:
    'Gemini Models\tWeekly Limit Remaining\t0%\t2026-10-09T00:56:53Z\nClaude and GPT models\tWeekly Limit Remaining\t100%\t2026-10-12T19:14:14Z\n',
  duration_seconds: 0,
  num_turns: 0,
  usage: {
    input_tokens: 0,
    output_tokens: 0,
    thinking_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 0,
  },
  command: {
    name: 'usage',
    data: {
      description:
        'Within each group, models share a weekly limit. Quota is consumed proportionally to the cost of the tokens. Thus, limits will last longer with shorter tasks or using more cost-effective models. Your weekly limit is tied directly to your individual tier.',
      groups: [
        {
          name: 'Gemini Models',
          description: 'Models within this group: Gemini Flash, Gemini Pro',
          buckets: [
            {
              id: 'gemini-weekly',
              name: 'Weekly Limit Remaining',
              description:
                'You have used some of your weekly limit, it will fully refresh in 3 days, 5 hours.',
              window: 'weekly',
              remaining_fraction: 0.0010104,
              reset_time: '2026-10-09T00:56:53Z',
            },
          ],
        },
        {
          name: 'Claude and GPT models',
          description:
            'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS',
          buckets: [
            {
              id: '3p-weekly',
              name: 'Weekly Limit Remaining',
              window: 'weekly',
              remaining_fraction: 1,
              reset_time: '2026-10-12T19:14:14Z',
            },
          ],
        },
      ],
    },
  },
};

/** Later the same day: the Gemini group spent outright. The bucket's
 *  description changes wording with its state; only the numbers are read. */
export const SIGNED_IN_SPENT = {
  conversation_id: '',
  status: 'SUCCESS',
  response:
    'Gemini Models\tWeekly Limit Remaining\t0%\t2026-10-09T00:56:53Z\nClaude and GPT models\tWeekly Limit Remaining\t100%\t2026-10-12T19:16:28Z\n',
  duration_seconds: 0,
  num_turns: 0,
  usage: {
    input_tokens: 0,
    output_tokens: 0,
    thinking_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 0,
  },
  command: {
    name: 'usage',
    data: {
      description:
        'Within each group, models share a weekly limit. Quota is consumed proportionally to the cost of the tokens. Thus, limits will last longer with shorter tasks or using more cost-effective models. Your weekly limit is tied directly to your individual tier.',
      groups: [
        {
          name: 'Gemini Models',
          description: 'Models within this group: Gemini Flash, Gemini Pro',
          buckets: [
            {
              id: 'gemini-weekly',
              name: 'Weekly Limit Remaining',
              description:
                'You have hit your weekly limit, it refreshes in 3 days, 5 hours. If on a supported paid plan, you can use AI credits in the interim or upgrade to a higher tier.',
              window: 'weekly',
              remaining_fraction: 0,
              reset_time: '2026-10-09T00:56:53Z',
            },
          ],
        },
        {
          name: 'Claude and GPT models',
          description:
            'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS',
          buckets: [
            {
              id: '3p-weekly',
              name: 'Weekly Limit Remaining',
              window: 'weekly',
              remaining_fraction: 1,
              reset_time: '2026-10-12T19:16:28Z',
            },
          ],
        },
      ],
    },
  },
};
