'use client';

/**
 * The New Agent surface (ENG-016 D49).
 *
 * Fully controlled and free of persistence, IPC, and launch behaviour so the
 * gallery bench and the composer render the identical component. What the
 * operator sees is task → row → Start, with everything else reachable but
 * silent until asked for:
 *
 *   - no Project/product name above it (finding 10) — the chrome already says it
 *   - no second control row, no duplicated Customize icon (findings 6, 7)
 *   - no co-visible "All configurations" and "Customize" (finding 5)
 *   - no `Shapes` link, no "Optional name" field (findings 8, 9)
 *
 * One disclosure at a time (BUG-328). The setup drawer and the "All engines
 * and models" catalog are two answers to one question, "what will this
 * start?", and opening both stacked a second list under the first. The
 * launcher owns ONE disclosure state, so opening either closes the other by
 * construction; the catalog's content is the caller's, its open state is not.
 *
 * The <form> is what Start submits: the task, the row and the setup drawer.
 * The catalog and the launch options (worktree, branch, roadmap link, Name
 * setup…) are disclosures OUTSIDE it, so Enter in one of their fields can
 * never start an Agent; nothing has to guard that key. The launch options
 * have their own trigger on the status line, which also says what is set
 * (a worktree branch, a roadmap link) while they are folded.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useBackOut } from '@/lib/shortcuts/back-out';
import { SetupRow } from './setup-row';
import {
  SetupDetailPanel,
  SetupDrawerHandle,
  type DetailAxis,
} from './setup-detail';
import {
  setupAccessibleLabel,
  type LauncherRowState,
  type LauncherSetup,
} from './launcher-model';

export interface AgentLauncherProps {
  setups: readonly LauncherSetup[];
  selectedId: string | null;
  state: LauncherRowState;
  /** Axes for the selected setup. Empty while nothing is selected. */
  axes: readonly DetailAxis[];
  detailFootnote?: string;
  detailAction?: React.ReactNode;
  task: string;
  onTaskChange: (task: string) => void;
  onSelect: (id: string) => void;
  /**
   * The "All engines and models" catalog, rendered under the row while it is
   * the open disclosure. `close` folds it (a pick that launches or selects).
   */
  catalog?: (close: () => void) => React.ReactNode;
  /**
   * This launch's options (worktree, branch, roadmap link, naming the setup),
   * rendered under the status line while they are the open disclosure.
   */
  options?: (close: () => void) => React.ReactNode;
  /** What the options hold while folded, e.g. "Worktree agent/1105-1200". */
  optionsSummary?: string | null;
  onStart: () => void;
  launching?: boolean;
  /** Blocks Start with a stated reason; never silently disabled. */
  blockedReason?: string | null;
  /**
   * A fact that does NOT block: the engine reports no sign-in and will ask
   * in the pane, or the row is painted from memory while engines are being
   * rechecked. Shares the reserved status line with `blockedReason`, which
   * wins when both are present.
   */
  notice?: { kind: 'notice' | 'checking'; text: string } | null;
  /**
   * The step that repairs the notice's fact, beside it on the same reserved
   * line: a source's guided sign-in and its Recheck (ENG-003 S5.3.1). Never
   * shown while Start is blocked, whose reason owns the line.
   */
  noticeActions?: readonly { id: string; label: string; onClick: () => void }[];
  /** Source facts the drawer carries under the axes: a step's note and the
   *  source's disclosure line. */
  detailSource?: React.ReactNode;
  placeholderCount?: number;
  /** Bench escape hatch: open a disclosure for a screenshot. */
  defaultDisclosure?: LauncherDisclosure;
  className?: string;
}

/** What is unfolded under the row. Never two things. */
type LauncherDisclosure = 'setup' | 'catalog' | 'options' | null;

export function AgentLauncher({
  setups,
  selectedId,
  state,
  axes,
  detailFootnote,
  detailAction,
  task,
  onTaskChange,
  onSelect,
  catalog,
  options,
  optionsSummary = null,
  onStart,
  launching = false,
  blockedReason,
  notice = null,
  noticeActions = [],
  detailSource,
  placeholderCount,
  defaultDisclosure = null,
  className,
}: AgentLauncherProps) {
  const [disclosure, setDisclosure] =
    useState<LauncherDisclosure>(defaultDisclosure);
  // A row that stops being ready has no setup to adjust: the drawer folds
  // and stays folded (a catalog stays open). Adjusted while rendering, from
  // the state the previous render saw, so no effect paints it open first.
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    if (state !== 'ready' && disclosure === 'setup') setDisclosure(null);
  }
  const shownDisclosure =
    disclosure === 'setup' && state !== 'ready' ? null : disclosure;
  const [detailFocusRequest, setDetailFocusRequest] = useState(0);
  const [notchPosition, setNotchPosition] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const taskRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Whatever is unfolded is the launcher's rung of the back-out ladder:
  // Escape folds it and returns to the task. Folded, Escape falls through.
  useBackOut({
    rung: 'panel',
    element: rootRef,
    enabled: disclosure !== null,
    back: () => {
      setDisclosure(null);
      requestAnimationFrame(() => taskRef.current?.focus());
      return true;
    },
  });

  const selected = setups.find(setup => setup.id === selectedId) ?? null;
  const ready = state === 'ready' && selected !== null && axes.length > 0;

  // The notch and the handle both follow the SELECTION, not the open state, so
  // switching chips slides them rather than making them disappear and return.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || !selectedId) return;
    const measure = () => {
      const chip = row.querySelector<HTMLElement>(
        `[data-setup-id="${CSS.escape(selectedId)}"]`
      );
      if (!chip) return;
      const rowBox = row.getBoundingClientRect();
      const chipBox = chip.getBoundingClientRect();
      if (rowBox.width === 0) return;
      setNotchPosition(
        (chipBox.left + chipBox.width / 2 - rowBox.left) / rowBox.width
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [selectedId, setups]);

  const toggle = (next: Exclude<LauncherDisclosure, null>) =>
    setDisclosure(current => (current === next ? null : next));
  const toggleDetail = () => toggle('setup');
  const closeDisclosure = () => setDisclosure(null);
  const enterDetail = (id: string) => {
    if (id !== selectedId) onSelect(id);
    setDisclosure('setup');
    setDetailFocusRequest(current => current + 1);
  };
  const startBlocked = Boolean(blockedReason) || launching || selected === null;

  return (
    <div
      ref={rootRef}
      data-agent-launcher
      className={cn('flex w-full min-w-0 flex-col gap-2', className)}
    >
      <form
        data-agent-launcher-form
        className="flex min-w-0 flex-col gap-2"
        onSubmit={event => {
          event.preventDefault();
          if (!startBlocked) onStart();
        }}
      >
        <textarea
          ref={taskRef}
          rows={1}
          value={task}
          maxLength={8_000}
          onChange={event => onTaskChange(event.target.value)}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (!startBlocked) onStart();
            }
          }}
          placeholder="What should this Agent do?"
          aria-label="Initial task for the new Agent"
          data-launcher-task
          className="max-h-40 min-h-11 w-full resize-none rounded-md border border-hud-stroke-soft bg-hud-surface-input px-3 py-2 font-mono text-xs leading-5 text-hud-text outline-none transition-colors [field-sizing:content] placeholder:text-hud-text-dim/80 hover:border-hud-cyan/40 focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
        />

        {/* Row, handle and panel are ONE block with no gaps between them: the
          handle used to sit in its own `gap-2` child and read as a detached
          arrow floating under the cards (operator, round 3). */}
        <div ref={rowRef} className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-stretch gap-2">
            <SetupRow
              setups={setups}
              selectedId={selectedId}
              expandedId={shownDisclosure === 'setup' ? selectedId : null}
              state={state}
              placeholderCount={placeholderCount}
              onSelect={onSelect}
              onToggleDetail={toggleDetail}
              onEnterDetail={enterDetail}
              catalogOpen={shownDisclosure === 'catalog'}
              onOpenCatalog={() => toggle('catalog')}
              className="flex-1"
            />
            <Button
              type="submit"
              data-launcher-start
              aria-busy={launching}
              disabled={startBlocked}
              title={blockedReason ?? undefined}
              // Stable hook for the chrome-layout gate, which checks that Start
              // survives a narrowing window. D46 had one; D49's redraw dropped
              // it and the gate rotted silently (BUG-010).
              data-agent-start-button
              className="min-w-24 shrink-0 self-stretch motion-reduce:transition-none"
            >
              {launching ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : null}
              {launching ? 'Starting…' : 'Start'}
            </Button>
          </div>

          <SetupDrawerHandle
            open={shownDisclosure === 'setup'}
            axes={axes}
            tickPosition={notchPosition}
            onToggle={toggleDetail}
            disabled={!ready}
          />

          <SetupDetailPanel
            open={shownDisclosure === 'setup' && ready}
            focusRequest={detailFocusRequest}
            axes={axes}
            footnote={detailFootnote}
            action={detailAction}
            source={detailSource}
            onDone={closeDisclosure}
          />
        </div>
      </form>

      {shownDisclosure === 'catalog' && catalog
        ? catalog(closeDisclosure)
        : null}

      {/* The status line is RESERVED, never revealed: a reason that appears
          under the row would move the hint line and the recents below it
          (design system: a hint or reason reveal never shifts layout). It is
          one box with three registers: a blocking fact in the attention
          tone, a non-blocking fact dimmer, and the quiet checking affordance
          while the row is painted from memory (BUG-062 / BUG-082). */}
      <div className="flex min-h-4 min-w-0 items-center gap-3">
        <p
          role="status"
          data-launcher-status
          data-launcher-status-kind={
            blockedReason ? 'blocked' : (notice?.kind ?? 'none')
          }
          className={cn(
            'min-h-4 min-w-0 truncate font-mono text-chrome-micro leading-4',
            blockedReason
              ? 'text-hud-amber/85'
              : notice?.kind === 'notice'
                ? 'text-hud-amber/60'
                : 'text-hud-text-dim/70'
          )}
        >
          {blockedReason ?? notice?.text ?? ''}
        </p>
        {!blockedReason
          ? noticeActions.map(action => (
              <button
                key={action.id}
                type="button"
                data-launcher-notice-action={action.id}
                onClick={action.onClick}
                className="shrink-0 rounded-sm font-mono text-chrome-micro leading-4 text-hud-text underline decoration-hud-text-dim/60 underline-offset-2 outline-none transition-colors hover:text-hud-cyan focus-visible:ring-2 focus-visible:ring-hud-cyan motion-reduce:transition-none"
              >
                {action.label}
              </button>
            ))
          : null}
        {options ? (
          <button
            type="button"
            data-launch-options-trigger
            aria-expanded={shownDisclosure === 'options'}
            data-open={shownDisclosure === 'options' || undefined}
            onClick={() => toggle('options')}
            className="ml-auto flex min-w-0 shrink items-center gap-1.5 rounded-sm font-mono text-chrome-micro leading-4 text-hud-text-dim outline-none transition-colors hover:text-hud-text focus-visible:ring-2 focus-visible:ring-hud-cyan data-[open]:text-hud-text motion-reduce:transition-none"
          >
            <span className="shrink-0">Options</span>
            {optionsSummary ? (
              <span
                data-launch-options-summary
                className="min-w-0 truncate text-hud-text"
              >
                {optionsSummary}
              </span>
            ) : null}
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none',
                shownDisclosure === 'options' && 'rotate-180'
              )}
            />
          </button>
        ) : null}
      </div>

      {shownDisclosure === 'options' && options
        ? options(closeDisclosure)
        : null}

      {/* The composer's ONE keyboard hint (BUG-017). The surrounding
          `launch-controls.tsx` printed a second copy of the same chords under
          drifted words; this line is the single owner, so every key the
          composer answers to belongs on it — including `recent ↓`, which the
          composer implements and this component does not. */}
      <p
        aria-hidden="true"
        data-launcher-hints
        className="px-0.5 font-mono text-chrome-micro leading-none text-hud-text-dim"
      >
        start ⏎ · recent ↓ · setup ⌥↑↓ · adjust ⇥ · shell ⌘⌥T · image ⌘V ·
        newline ⇧⏎
      </p>

      <span className="sr-only" aria-live="polite">
        {state === 'settling' || notice?.kind === 'checking'
          ? 'Checking which engines are available.'
          : selected
            ? `Selected ${setupAccessibleLabel(selected)}.${
                shownDisclosure === 'setup' ? ' Adjusting this setup.' : ''
              }`
            : ''}
      </span>
    </div>
  );
}
