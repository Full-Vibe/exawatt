import type { ConversationReading } from '@/components/conversation/conversation-reader';

export const READING_FIXTURE: ConversationReading = {
  sessionId: 'demo-session-reading-review',
  source: 'Claude Code',
  project: 'Checkout',
  title: 'Make checkout recover gracefully',
  history: 'complete',
  records: [
    {
      id: 'question',
      role: 'user',
      blocks: [
        {
          id: 'request',
          kind: 'prose',
          text: 'Review the checkout retry behavior. Explain the tradeoffs and show the smallest safe change.',
        },
      ],
    },
    {
      id: 'answer',
      role: 'assistant',
      blocks: [
        {
          id: 'conclusion',
          kind: 'heading',
          text: 'Recover the view. Preserve the payment.',
        },
        {
          id: 'reason',
          kind: 'prose',
          text: 'A dropped connection leaves the outcome uncertain. Refresh the order status first, then offer a retry only when the server confirms that no payment was created.',
        },
        {
          id: 'tool',
          kind: 'tool',
          name: 'Read checkout.ts',
          summary: 'Retry handler · 42 lines',
          output:
            'async function recoverCheckout(orderId: string) {\n  const order = await readOrder(orderId);\n  return order.payment ? { kind: "receipt", order } : { kind: "retry", order };\n}',
        },
        {
          id: 'comparison',
          kind: 'table',
          caption: 'Recovery choices',
          columns: ['When this happens', 'What the user sees', 'Next action'],
          rows: [
            ['Payment confirmed', 'Receipt and order number', 'Continue'],
            ['Outcome unavailable', 'Payment status pending', 'Check status'],
            ['Payment not created', 'Checkout draft restored', 'Retry payment'],
          ],
        },
        { id: 'change', kind: 'heading', text: 'One recovery boundary' },
        {
          id: 'code',
          kind: 'code',
          language: 'TypeScript',
          text: 'const outcome = await checkout.readOutcome(orderId);\n\nif (outcome.kind === "unknown") {\n  return { view: "pending", draft };\n}\n\nreturn restoreCheckout(outcome, draft);\n',
        },
        {
          id: 'checks',
          kind: 'list',
          items: [
            'Preserve the draft and keyboard focus after reconnecting.',
            'Keep one payment owner, including after a window reload.',
            'Test an interrupted response and a repeated recovery event.',
          ],
        },
      ],
    },
  ],
};

export const READING_STATES = [
  'complete',
  'partial',
  'loading',
  'error',
  'empty',
] as const;
