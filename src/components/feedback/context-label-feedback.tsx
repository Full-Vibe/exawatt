'use client';

import { useEffect, useState } from 'react';
import { Check, LoaderCircle, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export interface ContextLabelFeedbackProps {
  label: string;
  enabled: boolean;
  alwaysVisible?: boolean;
  onRate: (sentiment: -1 | 1, betterLabel?: string | null) => Promise<boolean>;
}

export function ContextLabelFeedback({
  label,
  enabled,
  alwaysVisible = false,
  onRate,
}: ContextLabelFeedbackProps) {
  const [open, setOpen] = useState(false);
  const [betterLabel, setBetterLabel] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle'
  );

  useEffect(() => {
    setState('idle');
    setBetterLabel('');
    setOpen(false);
  }, [label]);

  if (!enabled) return null;

  const send = async (sentiment: -1 | 1, correction?: string | null) => {
    if (state === 'sending') return;
    setState('sending');
    const accepted = await onRate(sentiment, correction);
    setState(accepted ? 'sent' : 'error');
    if (accepted) setOpen(false);
  };

  const icon =
    state === 'sending' ? (
      <LoaderCircle className="size-3 animate-spin" />
    ) : state === 'sent' ? (
      <Check className="size-3" />
    ) : null;

  return (
    <div
      data-context-label-feedback
      data-state={state}
      className={`flex shrink-0 items-center gap-0.5 transition-opacity duration-100 ${
        alwaysVisible
          ? 'opacity-100'
          : 'opacity-0 group-hover/tab:opacity-100 group-focus-within/tab:opacity-100'
      }`}
    >
      {icon ?? (
        <button
          type="button"
          aria-label={`Good context label: ${label}`}
          title="This context label is right"
          className="rounded p-1 text-muted-foreground outline-none transition-colors hover:bg-emerald-400/10 hover:text-emerald-300 focus-visible:ring-1 focus-visible:ring-hud-cyan"
          onClick={event => {
            event.stopPropagation();
            void send(1);
          }}
        >
          <ThumbsUp className="size-3" />
        </button>
      )}
      {state !== 'sent' && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Improve context label: ${label}`}
              title="This context label needs work"
              className="rounded p-1 text-muted-foreground outline-none transition-colors hover:bg-rose-400/10 hover:text-rose-300 focus-visible:ring-1 focus-visible:ring-hud-cyan"
              onClick={event => event.stopPropagation()}
            >
              <ThumbsDown className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-80 border-[color:var(--hud-line)] bg-[color:var(--hud-panel)] p-4"
            onClick={event => event.stopPropagation()}
          >
            <form
              className="grid gap-3"
              onSubmit={event => {
                event.preventDefault();
                const correction = betterLabel.replace(/\s+/g, ' ').trim();
                if (correction) void send(-1, correction);
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="better-context-label">Better context</Label>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  What label would page this Session back into memory?
                </p>
              </div>
              <Input
                id="better-context-label"
                autoFocus
                value={betterLabel}
                maxLength={72}
                onChange={event => setBetterLabel(event.target.value)}
                placeholder="Improve agent context summaries"
                className="bg-black/20"
              />
              {state === 'error' && (
                <p role="alert" className="text-xs text-destructive">
                  Could not save that feedback. Try again.
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={state === 'sending'}
                  onClick={() => void send(-1)}
                >
                  Just downvote
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!betterLabel.trim() || state === 'sending'}
                >
                  {state === 'sending' && (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  )}
                  Save correction
                </Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
