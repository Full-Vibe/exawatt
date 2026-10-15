// No 'use client': only imported by the client workspace surface.

/**
 * Team's right-hand dock (ENG-017 S12, ENG-029 B3): one panel at a time,
 * chosen by a tab, beside the Team grid. It follows VS Code's side bar
 * (operator, 2026-10-15: "find another app that has similar UI and does it
 * well and follow their guidance"): one view visible at a time, a badge count
 * on a tab, one shortcut (⌘B) for the whole dock, the last tab remembered,
 * and the same behaviour at every width: docked beside the grid when the
 * window affords it, a drawer over it when it does not.
 *
 * The dock owns the frame and the keyboard boundary (width, docking, the
 * focus ring, which panel holds focus); each panel owns only its content and
 * marks its keyboard root with `data-dock-focus`. Inactive panels stay
 * mounted and hidden, so switching back finds a panel where it was left.
 *
 * Keyboard: ⌘B lands in the active panel; Shift+Tab from a panel reaches the
 * tabs, ←/→ switch them, Tab or ↓ returns to the panel; Escape inside a panel
 * backs out of it (the panel decides how far).
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  WORKSPACE_HUD as HUD,
  withThemeAlpha as withAlpha,
} from '@/components/workspace/workspace-theme';
import {
  TEAM_DOCK_FOCUS_EVENT,
  takeTeamDockSummon,
  type TeamDockTab,
} from './team-dock-summon';

export const TEAM_DOCK_WIDTH = 320;
/** the dock widens while it holds focus: reading room without a resize */
const TEAM_DOCK_FOCUSED_WIDTH = 420;

const TAB_STORAGE_KEY = 'exawatt:team-dock-tab:v1';
const TABS: readonly TeamDockTab[] = ['roadmap', 'chatter'];
const tabListeners = new Set<() => void>();
let rememberedTab: TeamDockTab | null = null;

function readRememberedTab(): TeamDockTab {
  if (rememberedTab) return rememberedTab;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(TAB_STORAGE_KEY);
  } catch {
    // storage unavailable: start on the first tab
  }
  rememberedTab = TABS.includes(stored as TeamDockTab)
    ? (stored as TeamDockTab)
    : 'roadmap';
  return rememberedTab;
}

function rememberTab(tab: TeamDockTab): void {
  rememberedTab = tab;
  try {
    window.localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // remembered for this window only
  }
  for (const listener of tabListeners) listener();
}

/** The dock's tab, remembered across opens (VS Code's last view). */
export function useTeamDockTab(): [TeamDockTab, (tab: TeamDockTab) => void] {
  const tab = useSyncExternalStore(
    listener => {
      tabListeners.add(listener);
      return () => tabListeners.delete(listener);
    },
    readRememberedTab,
    () => 'roadmap' as const
  );
  return [tab, rememberTab];
}

/** Test seam: forget the in-memory tab so storage is read again. */
export function resetTeamDockTabForTest(): void {
  rememberedTab = null;
}

interface TeamDockPanel {
  id: TeamDockTab;
  label: string;
  /** a count shown on the tab; 0 or null shows nothing */
  badge?: number | null;
  /** what the badge counts, for assistive technology ("3 unread") */
  badgeLabel?: string;
  content: ReactNode;
}

export function TeamDock({
  panels,
  overlay,
  tab,
  onTabChange,
}: {
  panels: readonly TeamDockPanel[];
  /** float over the grid as a drawer (narrow windows) instead of docking */
  overlay: boolean;
  tab: TeamDockTab;
  onTabChange: (tab: TeamDockTab) => void;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const idBase = useId();
  const [focused, setFocused] = useState(false);

  const focusActivePanel = useCallback(() => {
    const root = rootRef.current;
    const target = root?.querySelector<HTMLElement>(
      '[role="tabpanel"]:not([hidden]) [data-dock-focus]'
    );
    target?.focus();
  }, []);

  // ⌘B / palette / context chip: show the requested tab (or the remembered
  // one) and move focus into its panel, whether the summon arrived before
  // this dock mounted or while it is on screen
  const onTabChangeRef = useRef(onTabChange);
  onTabChangeRef.current = onTabChange;
  useEffect(() => {
    const land = () => {
      const summon = takeTeamDockSummon();
      if (summon?.tab) onTabChangeRef.current(summon.tab);
      requestAnimationFrame(focusActivePanel);
    };
    if (takeTeamDockSummon()) land();
    window.addEventListener(TEAM_DOCK_FOCUS_EVENT, land);
    return () => window.removeEventListener(TEAM_DOCK_FOCUS_EVENT, land);
  }, [focusActivePanel]);

  const selectTab = (next: TeamDockTab, focusTab: boolean) => {
    onTabChange(next);
    if (focusTab) {
      requestAnimationFrame(() =>
        rootRef.current
          ?.querySelector<HTMLElement>(`[data-team-dock-tab="${next}"]`)
          ?.focus()
      );
    }
  };

  const onTabKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const last = panels.length - 1;
    const step = (to: number) => {
      event.preventDefault();
      event.stopPropagation();
      selectTab(panels[to].id, true);
    };
    if (event.key === 'ArrowRight') step(index === last ? 0 : index + 1);
    else if (event.key === 'ArrowLeft') step(index === 0 ? last : index - 1);
    else if (event.key === 'Home') step(0);
    else if (event.key === 'End') step(last);
    else if (event.key === 'ArrowDown' || event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      focusActivePanel();
    }
  };

  return (
    <aside
      ref={rootRef}
      data-team-dock
      data-team-dock-active={tab}
      aria-label="Project panels"
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(false);
      }}
      // keyboard ownership must be VISIBLE (D27): while the dock holds focus
      // it wears an accent ring and an esc hint
      className={`group/dock flex shrink-0 flex-col border-l outline-none transition-[width,box-shadow] duration-150 focus-within:ring-1 focus-within:ring-inset focus-within:ring-hud-cyan/60 motion-reduce:transition-none ${
        overlay ? 'absolute inset-y-0 right-0 z-10' : ''
      }`}
      style={{
        width: focused ? TEAM_DOCK_FOCUSED_WIDTH : TEAM_DOCK_WIDTH,
        borderColor: HUD.strokeFaint,
        background: HUD.bg.deep,
        boxShadow: overlay
          ? `-12px 0 32px ${withAlpha(HUD.bg.void, 0.55)}`
          : undefined,
      }}
    >
      <div
        className="flex shrink-0 items-stretch gap-1 border-b px-2"
        style={{ borderColor: HUD.strokeFaint }}
      >
        <div role="tablist" aria-label="Project panels" className="flex">
          {panels.map((panel, index) => {
            const active = panel.id === tab;
            const badge = panel.badge ?? 0;
            return (
              <button
                key={panel.id}
                type="button"
                role="tab"
                id={`${idBase}-tab-${panel.id}`}
                aria-selected={active}
                aria-controls={`${idBase}-panel-${panel.id}`}
                tabIndex={active ? 0 : -1}
                data-team-dock-tab={panel.id}
                onClick={() => {
                  onTabChange(panel.id);
                  requestAnimationFrame(focusActivePanel);
                }}
                onKeyDown={event => onTabKeyDown(event, index)}
                className="relative flex h-9 items-center gap-1.5 px-2 font-ui text-chrome-label font-medium outline-none hover:bg-hud-fill focus-visible:bg-hud-fill-hi"
                style={{ color: active ? HUD.text : HUD.textDim }}
              >
                {panel.label}
                {badge > 0 && (
                  <span
                    data-team-dock-badge
                    aria-label={panel.badgeLabel ?? `${badge} new`}
                    className="min-w-4 rounded-full px-1 text-center font-mono text-chrome-micro tabular-nums leading-4"
                    style={{
                      color: HUD.bg.deep,
                      background: HUD.cyan,
                    }}
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
                <span
                  aria-hidden
                  className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full"
                  style={{ background: active ? HUD.cyan : 'transparent' }}
                />
              </button>
            );
          })}
        </div>
        <span
          data-team-dock-focus-hint
          className="ml-auto hidden shrink-0 self-center font-mono text-chrome-micro group-focus-within/dock:inline"
          style={{ color: HUD.textMono }}
        >
          esc · back to tiles
        </span>
      </div>
      {panels.map(panel => (
        <div
          key={panel.id}
          role="tabpanel"
          id={`${idBase}-panel-${panel.id}`}
          aria-labelledby={`${idBase}-tab-${panel.id}`}
          hidden={panel.id !== tab}
          className="min-h-0 flex-1 flex-col [&:not([hidden])]:flex"
        >
          {panel.content}
        </div>
      ))}
    </aside>
  );
}
