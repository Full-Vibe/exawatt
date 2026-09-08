'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ConversationReader,
  type ConversationReading,
} from '@/components/conversation/conversation-reader';
import { Button } from '@/components/ui/button';
import { READING_FIXTURE, READING_STATES } from './fixtures';

export default function NativeConversationStudyPage() {
  const [history, setHistory] =
    useState<ConversationReading['history']>('complete');
  const [narrow, setNarrow] = useState(false);
  const conversation = {
    ...READING_FIXTURE,
    history,
    records:
      history === 'empty' || history === 'loading' || history === 'error'
        ? []
        : READING_FIXTURE.records,
  };
  return (
    <main className="min-h-screen bg-muted/20 px-4 py-6 font-ui text-foreground sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <Link
              href="/hud-gallery"
              className="text-chrome-label text-muted-foreground underline underline-offset-4"
            >
              HUD gallery
            </Link>
            <h1 className="text-surface-title font-semibold">
              Conversation reading
            </h1>
            <p className="text-chrome-meta text-muted-foreground">
              Review candidate · Representative data
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={narrow}
            onClick={() => setNarrow(!narrow)}
          >
            Narrow pane
          </Button>
        </header>
        <div
          role="group"
          aria-label="History scenario"
          className="flex flex-wrap gap-2"
        >
          {READING_STATES.map(state => (
            <Button
              key={state}
              variant={history === state ? 'default' : 'outline'}
              size="sm"
              aria-pressed={history === state}
              onClick={() => setHistory(state)}
            >
              {state.charAt(0).toUpperCase() + state.slice(1)}
            </Button>
          ))}
        </div>
        <div
          className={`w-full overflow-hidden rounded-lg border border-border ${narrow ? 'max-w-sm' : ''}`}
        >
          <ConversationReader key={history} conversation={conversation} />
        </div>
      </div>
    </main>
  );
}
