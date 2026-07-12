'use client';

/**
 * Manipulable-lens prototypes (ENG-017 S10 — GATED on operator play).
 *
 * Three gestures, two interaction options each, all MOCK: every "commit"
 * ends in a toast saying what WOULD happen. Nothing here touches a file,
 * launches a session, or ships to the workspace rail — an accepted option
 * graduates to its own milestone with real plumbing and acceptance.
 *
 * Vocabulary (operator, 2026-07-12): the verb is ASSIGN, not feed; the
 * progress gestures are spelled out in plain language because their first
 * labels ("check milestones", "cycle status") were incomprehensible.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { HUD, withAlpha } from '@/components/hud';
import type { RoadmapItemView, RoadmapLensView } from '@exawatt/ui-model';
import { cleanMilestoneTitle } from '@/components/roadmap/roadmap-format';

type Gesture = 'assign' | 'reorder' | 'progress';
type OptionKey = 'a' | 'b';

const GESTURES: Array<{
  key: Gesture;
  label: string;
  /** one plain sentence: what this gesture does to the real world */
  explainer: string;
  a: string;
  b: string;
}> = [
  {
    key: 'assign',
    label: 'Assign to an agent',
    explainer:
      'Enter on an item launches an agent already pointed at it — pick the harness, optionally a fresh worktree; the session starts with a kickoff prompt referencing the roadmap.',
    a: 'inline row under the item',
    b: 'centered dialog',
  },
  {
    key: 'reorder',
    label: 'Reorder the queue',
    explainer:
      'Change what comes next. Committing would rewrite the item order in roadmap.md.',
    a: 'move mode (press m, arrows move, Enter commits)',
    b: 'hold ⌘ and press arrows',
  },
  {
    key: 'progress',
    label: 'Record progress',
    explainer:
      'Report finished work back into the roadmap file — the file stays the only truth.',
    a: 'Space — mark the next milestone done',
    b: 's — advance the item toward shipped',
  },
];

function useToast(): [string | null, (msg: string) => void] {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = (msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3200);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return [toast, show];
}

function seededPrompt(item: RoadmapItemView): string {
  const scope = item.scope[0] ? ` First scope bullet: ${item.scope[0]}` : '';
  return `Work ${item.declaredId ?? item.title} per docs/engineering/roadmap.md. Keep the roadmap updated as you land milestones.${scope}`;
}

export function RoadmapFeedPrototypes({ view }: { view: RoadmapLensView }) {
  const [gesture, setGesture] = useState<Gesture>('assign');
  const [option, setOption] = useState<OptionKey>('a');
  const [toast, showToast] = useToast();

  // a local, mutable copy of the queue — prototypes reorder/toggle this copy
  const initial = useMemo(
    () => (view.status === 'ok' ? [...view.now, ...view.next, ...view.later] : []),
    [view]
  );
  const [items, setItems] = useState<RoadmapItemView[]>(initial);
  useEffect(() => setItems(initial), [initial]);
  const [sel, setSel] = useState(0);
  const [assignOpen, setAssignOpen] = useState(false);
  const [moveMode, setMoveMode] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const move = (delta: number) => {
    setItems(list => {
      const next = [...list];
      const to = sel + delta;
      if (to < 0 || to >= next.length) return list;
      const [it] = next.splice(sel, 1);
      next.splice(to, 0, it);
      setSel(to);
      return next;
    });
  };

  const launchMock = (item: RoadmapItemView, harness: string, worktree = false) => {
    setAssignOpen(false);
    showToast(
      `Prototype — this would launch ${harness}${
        worktree ? ' in a new worktree' : ''
      }, assigned to ${item.declaredId ?? item.title}, with a kickoff prompt from the roadmap.`
    );
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const item = items[sel];
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      if (gesture === 'reorder' && (moveMode || (option === 'b' && e.metaKey))) move(1);
      else setSel(s => Math.min(items.length - 1, s + 1));
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      if (gesture === 'reorder' && (moveMode || (option === 'b' && e.metaKey))) move(-1);
      else setSel(s => Math.max(0, s - 1));
    } else if (e.key === 'Enter' && item) {
      e.preventDefault();
      if (gesture === 'assign') setAssignOpen(true);
      else if (gesture === 'reorder' && moveMode) {
        setMoveMode(false);
        showToast('Prototype — this would rewrite the queue order in roadmap.md.');
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setAssignOpen(false);
      setMoveMode(false);
    } else if (gesture === 'reorder' && option === 'a' && e.key === 'm') {
      e.preventDefault();
      setMoveMode(m => !m);
    } else if (gesture === 'progress' && item) {
      if (option === 'a' && e.key === ' ') {
        e.preventDefault();
        const next = item.milestones.find(m => !m.done && !m.retired);
        setChecked(c => ({ ...c, [item.id]: !c[item.id] }));
        showToast(
          next
            ? `Prototype — this would mark “${cleanMilestoneTitle(next.title)}” done in roadmap.md (its “- [ ]” becomes “- [x]”).`
            : `Prototype — ${item.declaredId ?? item.title} has no open milestone; nothing to mark done.`
        );
      } else if (option === 'b' && e.key === 's') {
        e.preventDefault();
        showToast(
          `Prototype — this would move ${item.declaredId ?? item.title} one step toward shipped by editing its Status: line in roadmap.md.`
        );
      }
    }
  };

  if (view.status !== 'ok' || initial.length === 0) return null;
  const active = GESTURES.find(g => g.key === gesture)!;

  return (
    <section aria-label="Manipulable-lens prototypes" className="mt-10 max-w-2xl">
      <h2 className="font-display text-sm font-semibold" style={{ color: HUD.text }}>
        Prototypes — gated on operator play
      </h2>
      <p className="mb-3 mt-1 font-ui text-xs leading-5" style={{ color: HUD.textDim }}>
        Mock interactions only — every commit ends in a toast saying what would
        happen; no files are written. Accept or reject each option; verdicts go
        in the project doc before anything ships.
      </p>

      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {GESTURES.map(g => (
          <button
            key={g.key}
            type="button"
            data-lab-gesture={g.key}
            onClick={() => {
              setGesture(g.key);
              setAssignOpen(false);
              setMoveMode(false);
            }}
            className="rounded border px-2 py-1 font-ui text-[12px] outline-none hover:bg-white/10"
            style={{
              borderColor:
                g.key === gesture ? withAlpha(HUD.cyan, 0.7) : 'rgba(80,230,255,0.18)',
              color: g.key === gesture ? HUD.text : HUD.textDim,
            }}
          >
            {g.label}
          </button>
        ))}
        <span className="mx-2 h-4 w-px" style={{ background: 'rgba(80,230,255,0.2)' }} />
        {(['a', 'b'] as const).map(o => (
          <button
            key={o}
            type="button"
            data-lab-option={o}
            onClick={() => setOption(o)}
            className="rounded border px-2 py-1 font-ui text-[12px] outline-none hover:bg-white/10"
            style={{
              borderColor: o === option ? withAlpha(HUD.amber, 0.7) : 'rgba(80,230,255,0.18)',
              color: o === option ? HUD.text : HUD.textDim,
            }}
          >
            Option {o.toUpperCase()} — {o === 'a' ? active.a : active.b}
          </button>
        ))}
      </div>
      <p className="mb-2 font-ui text-[12px] leading-5" style={{ color: HUD.textDim }}>
        {active.explainer}
      </p>

      <div
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="Prototype queue"
        className="rounded border p-2 outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
        style={{ borderColor: 'rgba(80,230,255,0.15)', background: HUD.bg.deep }}
      >
        <p className="mb-1.5 font-ui text-[11px]" style={{ color: HUD.textDim }}>
          Click to focus, then j/k or arrows to select an item.{' '}
          {gesture === 'assign'
            ? 'Enter assigns the selected item.'
            : gesture === 'reorder'
              ? option === 'a'
                ? 'm starts moving it; arrows carry it; Enter commits.'
                : 'Hold ⌘ and press ↑/↓ (or j/k) to move it.'
              : option === 'a'
                ? 'Space marks its next milestone done.'
                : 's advances it toward shipped.'}
        </p>
        {items.map((item, i) => (
          <div key={item.id}>
            <div
              data-lab-item={item.id}
              data-selected={i === sel || undefined}
              onClick={() => setSel(i)}
              className="flex items-center gap-2 rounded px-2 py-1 text-[12px]"
              style={{
                background:
                  i === sel
                    ? moveMode
                      ? withAlpha(HUD.amber, 0.14)
                      : HUD.fillHi
                    : 'transparent',
                color: HUD.text,
                textDecoration: checked[item.id] ? 'line-through' : 'none',
                opacity: checked[item.id] ? 0.6 : 1,
              }}
            >
              <span
                className="font-mono text-[11px]"
                style={{ color: moveMode && i === sel ? HUD.amber : HUD.textDim }}
              >
                {moveMode && i === sel ? '⇕' : `${i + 1}.`}
              </span>
              <span className="font-mono text-[11px]" style={{ color: HUD.textMono }}>
                {item.declaredId ?? '—'}
              </span>
              <span className="min-w-0 truncate font-ui">{item.title}</span>
              {item.chips.length > 0 && (
                <span
                  className="font-mono text-[11px]"
                  title={`${item.chips.length} session${item.chips.length === 1 ? '' : 's'} on this item`}
                  style={{ color: HUD.cyan }}
                >
                  ▸{item.chips.length}
                </span>
              )}
            </div>
            {gesture === 'assign' && option === 'a' && assignOpen && i === sel && (
              <div
                className="mb-1 ml-7 flex flex-wrap items-center gap-1.5 rounded border p-1.5"
                style={{ borderColor: withAlpha(HUD.cyan, 0.35) }}
              >
                {['Claude Code', 'Codex', 'Shell'].map(h => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => launchMock(item, h)}
                    className="rounded border px-2 py-0.5 font-ui text-[11px] hover:bg-white/10"
                    style={{ borderColor: 'rgba(80,230,255,0.3)', color: HUD.text }}
                  >
                    ✳ {h}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => launchMock(item, 'Claude Code', true)}
                  className="rounded border px-2 py-0.5 font-ui text-[11px] hover:bg-white/10"
                  style={{ borderColor: 'rgba(80,230,255,0.3)', color: HUD.textDim }}
                >
                  ⌘↵ in a new worktree
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {gesture === 'assign' && option === 'b' && assignOpen && items[sel] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Assign item"
          className="fixed inset-0 z-40 grid place-items-center bg-black/60"
          onClick={() => setAssignOpen(false)}
        >
          <div
            className="w-96 rounded border p-4"
            style={{ borderColor: withAlpha(HUD.cyan, 0.4), background: HUD.bg.deep }}
            onClick={e => e.stopPropagation()}
          >
            <p className="font-display text-sm font-semibold" style={{ color: HUD.text }}>
              Assign {items[sel].declaredId ?? items[sel].title} to…
            </p>
            <div className="mt-3 flex flex-col gap-1.5">
              {['Claude Code', 'Codex', 'Shell'].map(h => (
                <button
                  key={h}
                  type="button"
                  onClick={() => launchMock(items[sel], h)}
                  className="rounded border px-2 py-1.5 text-left font-ui text-xs hover:bg-white/10"
                  style={{ borderColor: 'rgba(80,230,255,0.3)', color: HUD.text }}
                >
                  ✳ New {h} session on this item
                </button>
              ))}
            </div>
            <p className="mt-3 font-ui text-[11px] leading-4" style={{ color: HUD.textDim }}>
              Kickoff prompt: “{seededPrompt(items[sel])}”
            </p>
          </div>
        </div>
      )}

      {toast && (
        <div
          data-lab-toast
          className="fixed bottom-6 left-1/2 z-50 max-w-xl -translate-x-1/2 rounded border px-3 py-1.5 font-ui text-[12px]"
          style={{
            borderColor: withAlpha(HUD.amber, 0.5),
            background: HUD.bg.deep,
            color: HUD.text,
          }}
        >
          {toast}
        </div>
      )}
    </section>
  );
}
