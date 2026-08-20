import { Heart, MessageCircle, Repeat2 } from 'lucide-react';
import type { Tweet } from '@/lib/world/schemas';
import { cn } from '@/lib/utils';

const AVATAR_PALETTE = [
  'bg-sky-500/15 text-sky-500',
  'bg-violet-500/15 text-violet-500',
  'bg-emerald-500/15 text-emerald-500',
  'bg-amber-500/15 text-amber-500',
  'bg-rose-500/15 text-rose-500',
  'bg-cyan-500/15 text-cyan-500',
  'bg-fuchsia-500/15 text-fuchsia-500',
];

function paletteFor(handle: string): string {
  let hash = 0;
  for (let i = 0; i < handle.length; i++) hash = (hash * 31 + handle.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('');
}

function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

interface TweetCardProps {
  tweet: Tweet;
  replyingToHandle?: string;
}

export function TweetCard({ tweet, replyingToHandle }: TweetCardProps) {
  return (
    <article
      className={cn(
        'flex gap-3 border-b border-border px-4 py-3',
        tweet.isSeed && 'bg-primary/5'
      )}
    >
      <div
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
          paletteFor(tweet.authorHandle)
        )}
      >
        {initials(tweet.authorName)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
          <span className="font-semibold text-foreground">{tweet.authorName}</span>
          <span className="text-muted-foreground">@{tweet.authorHandle}</span>
          {tweet.isSeed && (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
              seed
            </span>
          )}
        </div>
        {tweet.kind !== 'post' && replyingToHandle && (
          <p className="text-xs text-muted-foreground">
            {tweet.kind === 'reply' ? 'Replying to' : 'Quoting'} @{replyingToHandle}
          </p>
        )}
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">
          {tweet.text}
        </p>
        <div className="mt-2 flex items-center gap-5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MessageCircle className="h-3.5 w-3.5" />
          </span>
          <span className="flex items-center gap-1">
            <Repeat2 className="h-3.5 w-3.5" />
            {compactCount(tweet.reposts)}
          </span>
          <span className="flex items-center gap-1">
            <Heart className="h-3.5 w-3.5" />
            {compactCount(tweet.likes)}
          </span>
        </div>
      </div>
    </article>
  );
}
