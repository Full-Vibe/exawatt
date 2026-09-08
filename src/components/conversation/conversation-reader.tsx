'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Presentation contract for D71's gallery. Source normalization remains separate.
 * All payloads render as React text: no HTML, URLs, images or local resources.
 */
export type ReadingBlock =
  | { id: string; kind: 'prose' | 'heading'; text: string }
  | { id: string; kind: 'list'; items: string[] }
  | { id: string; kind: 'code'; language: string; text: string }
  | {
      id: string;
      kind: 'table';
      caption: string;
      columns: string[];
      rows: string[][];
    }
  | { id: string; kind: 'tool'; name: string; summary: string; output: string };

export interface ReadingRecord {
  id: string;
  role: 'user' | 'assistant';
  blocks: ReadingBlock[];
}

export interface ConversationReading {
  sessionId: string;
  source: string;
  project: string;
  title: string;
  history: 'complete' | 'partial' | 'loading' | 'error' | 'empty';
  records: ReadingRecord[];
}

function CodeBlock({ language, text }: { language: string; text: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>(
    'idle'
  );
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-3 py-1">
        <span className="font-mono text-chrome-label text-muted-foreground">
          {language}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Copy code"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopyState('copied');
            } catch {
              setCopyState('error');
            }
          }}
        >
          {copyState === 'copied' ? (
            <Check aria-hidden="true" />
          ) : (
            <Copy aria-hidden="true" />
          )}
          {copyState === 'copied' ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre
        tabIndex={0}
        aria-label={`${language} code`}
        className="overflow-x-auto p-4 font-mono text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-ring"
      >
        <code>{text}</code>
      </pre>
      <span
        role="status"
        className={
          copyState === 'error'
            ? 'block px-4 pb-3 text-sm text-muted-foreground'
            : 'sr-only'
        }
      >
        {copyState === 'error'
          ? 'Clipboard unavailable. Select the code to copy it.'
          : copyState === 'copied'
            ? 'Code copied.'
            : ''}
      </span>
    </div>
  );
}

function Block({ block }: { block: ReadingBlock }) {
  switch (block.kind) {
    case 'heading':
      return (
        <h3 className="text-lg font-semibold leading-snug">{block.text}</h3>
      );
    case 'prose':
      return (
        <p className="whitespace-pre-wrap break-words text-reading leading-relaxed">
          {block.text}
        </p>
      );
    case 'list':
      return (
        <ul className="list-disc space-y-2 pl-5 text-reading leading-relaxed">
          {block.items.map((item, index) => (
            <li key={index} className="break-words">
              {item}
            </li>
          ))}
        </ul>
      );
    case 'code':
      return (
        <CodeBlock
          key={block.text}
          language={block.language}
          text={block.text}
        />
      );
    case 'table':
      return (
        <div
          tabIndex={0}
          role="region"
          aria-label={block.caption}
          className="min-w-0 overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-ring"
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{block.caption}</caption>
            <thead className="bg-muted/40">
              <tr>
                {block.columns.map((column, index) => (
                  <th key={index} scope="col" className="px-4 py-3 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index} className="border-t border-border">
                  {row.map((cell, column) => (
                    <td key={column} className="min-w-32 px-4 py-3 align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'tool': {
      const limit = 4000;
      return (
        <details className="min-w-0 rounded-lg border border-border px-4 py-3">
          <summary className="cursor-pointer text-sm focus-visible:outline-2 focus-visible:outline-ring">
            <span className="font-medium">{block.name}</span>
            <span className="ml-2 text-muted-foreground">{block.summary}</span>
          </summary>
          <pre
            tabIndex={0}
            aria-label={`${block.name} output`}
            className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-ring"
          >
            {block.output.slice(0, limit)}
          </pre>
          {block.output.length > limit && (
            <p className="mt-2 text-chrome-label text-muted-foreground">
              Output preview truncated.
            </p>
          )}
        </details>
      );
    }
  }
}

const HISTORY_COPY = {
  partial: 'Earlier messages are unavailable. Showing retained history.',
  loading: 'Loading conversation…',
  error: 'Conversation could not be loaded. Your terminal is still available.',
  empty: 'No readable messages recorded for this Session.',
} as const;

/** Read-only: never owns an execution process, provider credentials or commands. */
export function ConversationReader({
  conversation,
}: {
  conversation: ConversationReading;
}) {
  return (
    <section
      aria-label="Conversation"
      className="min-w-0 bg-background font-ui text-foreground"
    >
      <header className="flex flex-col gap-2 border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-chrome-label text-muted-foreground">
          <span>{conversation.project}</span>
          <span>{conversation.source}</span>
        </div>
        <h2 className="text-base font-semibold">{conversation.title}</h2>
        <details className="text-chrome-meta text-muted-foreground">
          <summary className="w-fit cursor-pointer focus-visible:outline-2 focus-visible:outline-ring">
            Session details
          </summary>
          <p className="mt-2 break-all font-mono">{conversation.sessionId}</p>
        </details>
      </header>
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-6 sm:px-8">
        {conversation.history !== 'complete' && (
          <p
            role="status"
            className="rounded border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
          >
            {HISTORY_COPY[conversation.history]}
          </p>
        )}
        {conversation.records.map(record => (
          <article
            key={record.id}
            aria-label={
              record.role === 'user' ? 'Your message' : 'Agent message'
            }
            className="min-w-0 space-y-4"
          >
            <p className="text-chrome-label font-medium text-muted-foreground">
              {record.role === 'user' ? 'You' : conversation.source}
            </p>
            {record.blocks.map(block => (
              <Block key={block.id} block={block} />
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}
