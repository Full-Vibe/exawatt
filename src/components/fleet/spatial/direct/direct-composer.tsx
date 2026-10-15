'use client';

import { useState, type Ref } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SourceGlyph } from '@/components/workspace/harness-icons';
import type { DirectAvailability, RecipientNote } from './direct-model';

/**
 * Direct (ENG-004 V4.2): one field and Send, inside the selection panel.
 * Starcraft grammar (operator, 2026-10-15): select a group, type a quick
 * command. No persistent broadcast mode, no hidden recipients: the recipient
 * list beside it is the selection itself.
 *
 * Escape clears the text first; on an empty field it hands Escape back to the
 * board, which releases the selection.
 */
export function DirectComposer({
  count,
  availability,
  sending,
  onSend,
  onEscapeEmpty,
  inputRef,
  shortcutLabel,
}: {
  count: number;
  availability: DirectAvailability;
  sending: boolean;
  /** resolves true when the message went out, so the field can clear */
  onSend: (text: string) => Promise<boolean>;
  onEscapeEmpty: () => void;
  inputRef?: Ref<HTMLTextAreaElement>;
  /** the chord that focuses this field, shown as its hint */
  shortcutLabel?: string | null;
}) {
  const [text, setText] = useState('');
  const canSend =
    availability.kind === 'ready' && text.trim() !== '' && !sending;
  const submit = async () => {
    if (!canSend) return;
    if (await onSend(text)) setText('');
  };
  const label = `Direct ${count} ${count === 1 ? 'Agent' : 'Agents'}`;
  return (
    <form
      data-direct-composer
      className="flex flex-col gap-2"
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="flex items-baseline justify-between gap-2 text-chrome-label font-semibold text-muted-foreground">
        {label}
        {shortcutLabel && (
          <kbd className="font-mono text-chrome-micro font-normal">
            {shortcutLabel}
          </kbd>
        )}
      </label>
      <Textarea
        ref={inputRef}
        value={text}
        rows={2}
        aria-label={label}
        placeholder="Type a command for every selected Agent"
        data-direct-input
        className="min-h-0 resize-none text-sm"
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (text !== '') setText('');
            else {
              event.currentTarget.blur();
              onEscapeEmpty();
            }
          }
        }}
      />
      <div className="flex items-center justify-between gap-2">
        {/* Where nothing can be sent, every recipient row already says why;
            the footnote stays the queue rule rather than a fourth copy. */}
        <p className="min-w-0 text-chrome-micro text-muted-foreground">
          {availability.kind === 'ready'
            ? 'Busy Agents receive it when their turn ends.'
            : null}
        </p>
        <Button
          type="submit"
          size="sm"
          disabled={!canSend}
          data-direct-send
          aria-keyshortcuts="Meta+Enter"
        >
          {sending ? 'Sending…' : 'Send'}
          <kbd className="ml-1.5 font-mono text-chrome-micro opacity-70">
            ⌘↩
          </kbd>
        </Button>
      </div>
    </form>
  );
}

/** A recipient's harness mark, or nothing when its source did not say. */
export function RecipientMark({ harness }: { harness: string | null }) {
  if (!harness) return null;
  return (
    <span className="inline-flex shrink-0" title={harness} aria-hidden="true">
      <SourceGlyph source={harness} size={12} />
    </span>
  );
}

/** What Send will do, or did, for one recipient. */
export function RecipientNoteLine({
  note,
  agentId,
}: {
  note: RecipientNote;
  agentId: string;
}) {
  return (
    <span
      data-direct-result={agentId}
      data-direct-tone={note.tone}
      title={note.title}
      className={`line-clamp-2 block break-words font-mono text-chrome-micro ${
        note.tone === 'fault' ? 'text-foreground' : 'text-muted-foreground'
      }`}
    >
      {note.text}
    </span>
  );
}
