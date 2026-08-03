'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { ArrowRight, LoaderCircle, Search, Sparkles } from 'lucide-react';
import { HUD } from '@/components/hud';
import { createClient } from '@/lib/supabase/client';
import type { RecentConversation } from '@/types/electron';
import { AGENT_SOURCE_META } from './agent-sources';
import { HarnessGlyph } from './harness-icons';

const FILTER_THRESHOLD = 8;

export type ConversationOpenMode = 'resume' | 'fresh';

export interface RecentConversationsHandle {
  focusFirst(): boolean;
}

interface RecentConversationsProps {
  projectDir: string;
  active?: boolean;
  hidden?: boolean;
  disabled?: boolean;
  onOpen: (
    conversation: RecentConversation,
    mode: ConversationOpenMode
  ) => Promise<boolean>;
  onReturnToComposer: () => void;
}

function relativeTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'recently';
  const elapsed = Date.now() - timestamp;
  const minutes = Math.max(1, Math.round(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d` : new Date(timestamp).toLocaleDateString();
}

export const RecentConversations = forwardRef<
  RecentConversationsHandle,
  RecentConversationsProps
>(function RecentConversations(
  {
    projectDir,
    active = true,
    hidden = false,
    disabled = false,
    onOpen,
    onReturnToComposer,
  },
  forwardedRef
) {
  const [rows, setRows] = useState<RecentConversation[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading'
  );
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const primaryRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const enrichmentAttemptRef = useRef<string | null>(null);
  const sectionId = useId();

  useEffect(() => {
    if (!active || hidden) return;
    let cancelled = false;
    const api = window.electron?.pty;
    if (!api?.listRecentConversations) {
      setState('unavailable');
      return;
    }
    setState('loading');
    setRows([]);
    enrichmentAttemptRef.current = null;
    setQuery('');
    void api
      .listRecentConversations(projectDir)
      .then(localRows => {
        if (cancelled) return;
        setRows(localRows);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [active, hidden, projectDir]);

  // Native and cached titles render first. Missing labels are augmented in
  // the background only for signed-in users; offline/new-task flow is never
  // coupled to this request.
  useEffect(() => {
    if (
      state !== 'ready' ||
      !active ||
      hidden ||
      !rows.some(row => row.needsSummary) ||
      !window.electron?.pty?.enrichRecentConversations ||
      enrichmentAttemptRef.current === projectDir
    ) {
      return;
    }
    enrichmentAttemptRef.current = projectDir;
    let cancelled = false;
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    void window.electron?.settings
      ?.get()
      .then(settings => {
        if (settings.conversationSummaries?.hosted === false) return null;
        return supabase.auth.getSession();
      })
      .then(result => {
        const data = result?.data;
        const token = data?.session?.access_token;
        if (!token || cancelled) return null;
        return window.electron!.pty!.enrichRecentConversations(
          projectDir,
          token
        );
      })
      .then(enriched => {
        if (!cancelled && enriched) setRows(enriched);
      })
      .catch(() => {
        // Local fallback copy remains useful when auth or enrichment is down.
      });
    return () => {
      cancelled = true;
    };
  }, [active, hidden, projectDir, rows, state]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(row =>
      [
        row.title,
        row.description ?? '',
        row.id,
        row.harness,
        row.continuation.kind === 'exawatt-session' ? 'exawatt session' : '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [query, rows]);
  const visible = filtered;

  const focusAt = useCallback(
    (index: number) => {
      if (visible.length === 0) return false;
      const bounded = Math.max(0, Math.min(index, visible.length - 1));
      const target = primaryRefs.current[bounded];
      if (!target) return false;
      target.focus();
      target.scrollIntoView?.({ block: 'nearest' });
      return true;
    },
    [visible.length]
  );
  useImperativeHandle(forwardedRef, () => ({ focusFirst: () => focusAt(0) }), [
    focusAt,
  ]);

  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (event.key === 'ArrowUp' && index === 0) {
        event.preventDefault();
        onReturnToComposer();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        focusAt(index + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key === 'Home') {
        event.preventDefault();
        focusAt(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        focusAt(visible.length - 1);
      } else if (event.key === 'PageDown' || event.key === 'PageUp') {
        event.preventDefault();
        focusAt(index + (event.key === 'PageDown' ? 5 : -5));
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onReturnToComposer();
      }
    },
    [focusAt, onReturnToComposer, visible.length]
  );

  const open = async (
    conversation: RecentConversation,
    mode: ConversationOpenMode
  ) => {
    if (opening || disabled) return;
    const key = `${conversation.harness}:${conversation.id}:${mode}`;
    setOpening(key);
    try {
      await onOpen(conversation, mode);
    } finally {
      setOpening(null);
    }
  };

  if (!active || hidden) return null;

  return (
    <section
      data-recent-conversations
      aria-labelledby={`${sectionId}-heading`}
      className="@container mt-5 w-full border-t pt-3"
      style={{ borderColor: HUD.strokeFaint }}
    >
      <div className="mb-1.5 flex min-h-7 items-center gap-3 px-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2
            id={`${sectionId}-heading`}
            className="font-mono text-chrome-meta font-semibold tracking-[0.13em]"
            style={{ color: HUD.textDim }}
          >
            Continue recent
          </h2>
          {rows.length > 0 && (
            <span
              className="font-mono text-chrome-micro"
              style={{ color: HUD.textDim }}
            >
              {rows.length}
            </span>
          )}
        </div>
      </div>

      {rows.length > FILTER_THRESHOLD && (
        <label className="relative mb-2 block">
          <Search
            aria-hidden="true"
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={{ color: HUD.textDim }}
          />
          <span className="sr-only">Filter recent conversations</span>
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') {
                if (focusAt(0)) event.preventDefault();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                if (query) setQuery('');
                else onReturnToComposer();
              }
            }}
            placeholder="Filter title, ID, or source"
            className="h-8 w-full rounded border bg-transparent pl-8 pr-2 font-mono text-chrome-meta outline-none placeholder:text-hud-text-dim/70 focus-visible:ring-1 focus-visible:ring-hud-cyan"
            style={{
              color: HUD.text,
              borderColor: HUD.strokeSoft,
              background: HUD.surfaceInputSoft,
            }}
          />
        </label>
      )}

      {state === 'loading' && (
        <div
          role="status"
          className="flex h-16 items-center gap-2 px-3 font-mono text-chrome-meta"
          style={{ color: HUD.textDim }}
        >
          <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          Looking for local conversations…
        </div>
      )}
      {state === 'unavailable' && (
        <p
          className="px-1 py-4 font-mono text-chrome-meta"
          style={{ color: HUD.textDim }}
        >
          Recent conversations are unavailable. Starting a new Agent still
          works.
        </p>
      )}
      {state === 'ready' && rows.length === 0 && (
        <p
          className="px-1 py-4 font-mono text-chrome-meta"
          style={{ color: HUD.textDim }}
        >
          No Claude Code or Codex conversations found for this Project.
        </p>
      )}
      {state === 'ready' && filtered.length === 0 && rows.length > 0 && (
        <p
          className="px-1 py-4 font-mono text-chrome-meta"
          style={{ color: HUD.textDim }}
        >
          No conversations match “{query}”.
        </p>
      )}

      <div
        role="list"
        className="divide-y"
        style={{ borderColor: HUD.divider }}
      >
        {visible.map((conversation, index) => {
          const meta = AGENT_SOURCE_META[conversation.harness];
          const reopensExawatt =
            conversation.continuation.kind === 'exawatt-session';
          const exactKey = `${conversation.harness}:${conversation.id}:resume`;
          const freshKey = `${conversation.harness}:${conversation.id}:fresh`;
          const actionId = `${sectionId}-action-${index}`;
          const targetId = `${sectionId}-target-${index}`;
          const titleId = `${sectionId}-title-${index}`;
          const descriptionId = `${sectionId}-description-${index}`;
          const detailsId = `${sectionId}-details-${index}`;
          return (
            <div
              role="listitem"
              aria-posinset={index + 1}
              aria-setsize={visible.length}
              key={`${conversation.harness}:${conversation.id}`}
              data-conversation-id={conversation.id}
              data-continuation={conversation.continuation.kind}
              data-title-source={conversation.titleSource}
              className="group flex min-w-0 items-stretch gap-1 transition-colors hover:bg-hud-cyan/[0.035] focus-within:bg-hud-cyan/[0.05] @max-[560px]:flex-wrap motion-reduce:transition-none"
              style={{ borderColor: HUD.divider }}
            >
              <button
                ref={node => {
                  primaryRefs.current[index] = node;
                }}
                type="button"
                disabled={disabled || opening !== null}
                onClick={() => void open(conversation, 'resume')}
                onKeyDown={event => handleRowKeyDown(event, index)}
                aria-labelledby={`${actionId} ${titleId} ${targetId}`}
                aria-describedby={`${
                  conversation.description &&
                  conversation.description !== conversation.title
                    ? `${descriptionId} `
                    : ''
                }${detailsId}`}
                title={
                  reopensExawatt && !conversation.providerSessionId
                    ? 'Reopen this saved Exawatt Session with its retained history'
                    : reopensExawatt
                      ? `Resume this exact ${meta.label} conversation and restore its saved Exawatt Session`
                      : `Resume this exact ${meta.label} conversation`
                }
                className="flex min-h-14 min-w-0 flex-1 items-start gap-3 rounded-sm px-2 py-2 text-left outline-none transition-colors disabled:opacity-60 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-hud-cyan @max-[560px]:basis-full"
              >
                <span id={actionId} className="sr-only">
                  {reopensExawatt && !conversation.providerSessionId
                    ? 'Reopen'
                    : 'Resume'}
                </span>
                <span
                  className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-sm border"
                  style={{ color: meta.color, borderColor: `${meta.color}44` }}
                >
                  {opening === exactKey ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                  ) : (
                    <HarnessGlyph harness={conversation.harness} size={14} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2 @max-[430px]:flex-col @max-[430px]:items-start @max-[430px]:gap-0">
                    <span
                      id={titleId}
                      className="truncate text-chrome-title font-medium leading-5"
                      style={{ color: HUD.text }}
                    >
                      {conversation.title}
                    </span>
                    {conversation.titleSource === 'generated' && (
                      <Sparkles
                        aria-label="Title generated by Exawatt"
                        className="h-3 w-3 shrink-0"
                        style={{ color: HUD.magenta }}
                      />
                    )}
                    <span
                      className="ml-auto shrink-0 font-mono text-chrome-micro @max-[430px]:ml-0"
                      style={{ color: meta.color }}
                    >
                      {reopensExawatt ? 'Exawatt · ' : ''}
                      {meta.label} · {relativeTime(conversation.updatedAt)}
                    </span>
                  </span>
                  {conversation.description &&
                    conversation.description !== conversation.title && (
                      <span
                        id={descriptionId}
                        className="mt-0.5 block truncate text-chrome-meta leading-4"
                        style={{ color: HUD.textDim }}
                      >
                        {conversation.description}
                      </span>
                    )}
                  <span
                    id={detailsId}
                    className="mt-0.5 block break-all font-mono text-chrome-micro leading-4"
                    style={{ color: HUD.textDim }}
                  >
                    <span>{conversation.id}</span>
                    <span className="sr-only">
                      . {reopensExawatt ? 'Saved in Exawatt. ' : ''}
                      {conversation.providerSessionId
                        ? `Exact ${meta.label} resume available.`
                        : 'Retained history only.'}
                    </span>
                  </span>
                  <span id={targetId} className="sr-only">
                    {reopensExawatt && !conversation.providerSessionId
                      ? 'in Exawatt'
                      : `in ${meta.label}`}
                  </span>
                </span>
              </button>
              <button
                type="button"
                disabled={disabled || opening !== null}
                onClick={() => void open(conversation, 'fresh')}
                onKeyDown={event => handleRowKeyDown(event, index)}
                aria-label={`Start fresh from ${conversation.title}`}
                title="Start a new Agent from this handoff"
                className="my-1 mr-1.5 inline-flex min-h-11 shrink-0 items-center gap-1 rounded border border-transparent px-2 font-mono text-chrome-micro outline-none transition-[border-color,color] hover:border-hud-cyan/20 hover:text-hud-cyan disabled:opacity-50 focus-visible:border-hud-cyan/30 focus-visible:text-hud-cyan focus-visible:ring-1 focus-visible:ring-hud-cyan @max-[560px]:mb-2 @max-[560px]:ml-12 motion-reduce:transition-none"
                style={{ color: HUD.textDim }}
              >
                {opening === freshKey ? (
                  <LoaderCircle className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                ) : (
                  <ArrowRight className="h-3 w-3" />
                )}
                Start fresh
              </button>
            </div>
          );
        })}
      </div>
      {visible.length > 0 && (
        <p
          aria-hidden="true"
          className="mt-2 px-0.5 font-mono text-chrome-micro"
          style={{ color: HUD.textDim }}
        >
          ↑↓ choose · home/end jump · ⏎ continue · esc new task
        </p>
      )}
    </section>
  );
});
