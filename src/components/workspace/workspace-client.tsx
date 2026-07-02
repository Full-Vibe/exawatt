'use client';

/**
 * Agent Terminal Workspace — W0.1 foundation surface (ENG-002).
 *
 * The product gesture is IGNITE AN AGENT (pick a harness, go), not "open a
 * terminal". W0.1 scope: spawn shell / Claude Code / Codex sessions in a
 * chosen working directory, talk to their TUIs directly, switch tabs fast.
 * Initiative windows, the worktree picker, and persistence land in W0.2.
 *
 * Sessions live in the Electron main process; this surface adopts whatever
 * exists on mount (pty.list), so renderer reloads AND route round-trips
 * (e.g. /fleet/spatial and back) never lose sessions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TerminalPane } from './terminal-pane';
import { HARNESS_META, HARNESS_ORDER } from './harnesses';
import { useWorkspaceShortcuts } from './use-workspace-shortcuts';
import { HUD } from '@/components/hud';
import type { PtyHarness, PtySessionInfo } from '@/types/electron';

export function WorkspaceClient() {
  const [sessions, setSessions] = useState<PtySessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cwd, setCwd] = useState('');
  const [exited, setExited] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  // SSR renders neither branch; the electron check runs after mount so the
  // server and client HTML always match (hydration safety)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const inElectron = mounted && !!window.electron?.pty;
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  // adopt sessions that already exist in the main process (renderer reload,
  // navigating away and back)
  useEffect(() => {
    const api = window.electron?.pty;
    if (!api) return;
    void api.list().then((list) => {
      setSessions(list);
      setActiveId((cur) => cur ?? list[0]?.id ?? null);
      setExited(
        Object.fromEntries(
          list.filter((s) => s.exited).map((s) => [s.id, s.exitCode ?? 0])
        )
      );
    });
    return api.onExit(({ id, exitCode }) => {
      setExited((prev) => ({ ...prev, [id]: exitCode }));
    });
  }, []);

  const ignite = useCallback(async (harness: PtyHarness) => {
    const api = window.electron?.pty;
    if (!api) return;
    const result = await api.create({
      harness,
      cwd: cwdRef.current.trim() || undefined,
      title: HARNESS_META[harness].label,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setSessions((prev) => [...prev, result.session]);
    setActiveId(result.session.id);
  }, []);

  const close = useCallback(async (id: string) => {
    const api = window.electron?.pty;
    if (!api) return;
    await api.kill(id);
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      setActiveId((cur) =>
        cur === id ? (next[next.length - 1]?.id ?? null) : cur
      );
      return next;
    });
    setExited((prev) => {
      const { [id]: _drop, ...rest } = prev;
      return rest;
    });
  }, []);

  // each action reports whether it applied — the hook prevents the browser
  // default only for chords that actually did something
  const shortcutActions = useMemo(
    () => ({
      igniteShell: () => {
        void ignite('shell');
        return true;
      },
      closeActive: () => {
        if (!activeId) return false;
        void close(activeId);
        return true;
      },
      selectIndex: (index: number) => {
        const target = sessions[index];
        if (!target) return false;
        setActiveId(target.id);
        return true;
      },
      cycle: (delta: 1 | -1) => {
        if (sessions.length === 0) return false;
        const cur = sessions.findIndex((s) => s.id === activeId);
        const next =
          (cur === -1 ? 0 : cur + delta + sessions.length) % sessions.length;
        setActiveId(sessions[next].id);
        return true;
      },
    }),
    [ignite, close, activeId, sessions]
  );
  useWorkspaceShortcuts(shortcutActions, inElectron);

  if (!mounted) return null;

  if (!inElectron) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div
          className="max-w-md rounded border p-6 text-center"
          style={{
            borderColor: 'rgba(80,230,255,0.25)',
            background: 'rgba(7,12,20,0.9)',
          }}
        >
          <p
            className="font-display text-lg font-semibold"
            style={{ color: HUD.text }}
          >
            Terminal Workspace
          </p>
          <p className="mt-2 font-mono text-sm" style={{ color: HUD.textDim }}>
            Live terminal sessions run in the Exawatt desktop app. Launch it
            with <span style={{ color: HUD.textMono }}>pnpm electron:dev</span>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" style={{ background: HUD.bg.void }}>
      {/* tab strip + ignite controls */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-2"
        style={{ borderColor: 'rgba(80,230,255,0.15)', background: HUD.bg.deep }}
      >
        {sessions.map((s, i) => {
          const on = s.id === activeId;
          const dead = s.id in exited;
          const meta = HARNESS_META[s.harness];
          return (
            <div
              key={s.id}
              data-active={on || undefined}
              className="flex items-center overflow-hidden rounded border"
              style={{
                borderColor: on
                  ? 'rgba(25,230,255,0.5)'
                  : 'rgba(80,230,255,0.15)',
                background: on ? 'rgba(25,230,255,0.08)' : 'transparent',
                opacity: dead ? 0.5 : 1,
              }}
            >
              <button
                onClick={() => setActiveId(s.id)}
                className="flex items-center gap-2 px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                style={{ color: on ? HUD.text : HUD.textDim }}
                title={`${s.cwd}${dead ? ` · exited ${exited[s.id]}` : ''}`}
              >
                <span
                  className="inline-block h-2 w-2 rotate-45"
                  style={{
                    background: meta.color,
                    boxShadow: `0 0 4px ${meta.color}`,
                  }}
                />
                {i + 1} · {s.title}
                {dead && <span style={{ color: HUD.red }}>✕</span>}
              </button>
              <button
                onClick={() => void close(s.id)}
                aria-label={`Close ${s.title}`}
                className="px-1.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                style={{ color: HUD.textDim }}
              >
                ×
              </button>
            </div>
          );
        })}

        <div className="ml-auto flex items-center gap-1.5">
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="~ (working dir / worktree)"
            aria-label="Working directory for new sessions"
            className="w-56 rounded border bg-transparent px-2 py-1 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
            style={{ color: HUD.textMono, borderColor: 'rgba(80,230,255,0.2)' }}
          />
          {HARNESS_ORDER.map((h) => (
            <button
              key={h}
              onClick={() => void ignite(h)}
              className="hud-lift rounded border px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-hud-cyan"
              style={{
                color: HARNESS_META[h].color,
                borderColor: 'rgba(80,230,255,0.25)',
                background: 'rgba(10,20,32,0.6)',
              }}
              title={`Ignite ${HARNESS_META[h].label}${cwd ? ` in ${cwd}` : ''}`}
            >
              {HARNESS_META[h].ignite}
            </button>
          ))}
        </div>
      </div>

      {/* ignite errors (bad working dir, spawn failures) — dismissible */}
      {error && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 border-b px-3 py-1.5 font-mono text-xs"
          style={{
            color: HUD.red,
            borderColor: 'rgba(255,31,75,0.35)',
            background: 'rgba(255,31,75,0.08)',
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="px-1 outline-none focus-visible:ring-1 focus-visible:ring-hud-red"
          >
            ×
          </button>
        </div>
      )}

      {/* panes: all mounted, one visible — no output lost on tab switch */}
      <div className="relative min-h-0 flex-1">
        {sessions.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="font-mono text-sm" style={{ color: HUD.textDim }}>
              Ignite an agent to begin — ⌘T for a shell.
            </p>
          </div>
        ) : (
          sessions.map((s) => (
            <TerminalPane
              key={s.id}
              sessionId={s.id}
              active={s.id === activeId}
            />
          ))
        )}
      </div>
    </div>
  );
}
