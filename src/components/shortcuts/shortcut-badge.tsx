'use client';

import { cn } from '@/lib/utils';
import { formatShortcutKeys, formatShortcutKeysAccessible } from '@/lib/shortcuts';
import type { ShortcutKeys } from '@/types/shortcuts';

interface ShortcutBadgeProps {
  keys: ShortcutKeys;
  className?: string;
  size?: 'sm' | 'md';
}

export function ShortcutBadge({ keys, className, size = 'sm' }: ShortcutBadgeProps) {
  const formatted = formatShortcutKeys(keys);
  const accessible = formatShortcutKeysAccessible(keys);

  return (
    <kbd
      className={cn(
        'inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono font-medium text-muted-foreground',
        size === 'sm' ? 'text-[10px] py-0.5' : 'text-xs py-1',
        className
      )}
      aria-label={accessible}
    >
      {formatted}
    </kbd>
  );
}
