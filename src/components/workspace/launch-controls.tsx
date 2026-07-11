// No 'use client' directive: only imported by the client workspace surface.

/**
 * The LAUNCH gesture (ENG-002 W0.2): pick a harness, go. A project
 * directory is REQUIRED (never a silent home default — harness trust
 * doesn't stick there); the field prefills from the active project or
 * the last-used dir. The worktree toggle creates <repo>-wt/<branch> and
 * launchs inside it, one gesture.
 */
import { useEffect, useRef, useState } from 'react';
import { HUD } from '@/components/hud';
import { HARNESS_META, HARNESS_ORDER } from './harnesses';
import { HarnessGlyph } from './harness-icons';
import type { LaunchOptions } from './use-workspace-state';
import type { PtyHarness } from '@/types/electron';

function defaultBranch(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `agent/${mm}${dd}-${hh}${mi}`;
}

export function LaunchControls({
  prefillDir,
  onLaunch,
}: {
  /** active project dir, else last-used dir, else '' */
  prefillDir: string;
  onLaunch: (opts: LaunchOptions) => Promise<boolean>;
}) {
  const [dir, setDir] = useState(prefillDir);
  const [dirTouched, setDirTouched] = useState(false);
  const [worktree, setWorktree] = useState(false);
  const [branch, setBranch] = useState(defaultBranch);
  // bumped on every manual edit — an launch must not clobber a dir or
  // branch typed WHILE its spawn was in flight
  const editSeq = useRef(0);
  const branchEditSeq = useRef(0);

  // follow the active project until the operator edits the field
  useEffect(() => {
    if (!dirTouched) setDir(prefillDir);
  }, [prefillDir, dirTouched]);

  // the native folder picker is Electron-only; detect post-mount so SSR and
  // the first client render agree (no hydration mismatch)
  const [canBrowse, setCanBrowse] = useState(false);
  useEffect(() => {
    setCanBrowse(!!window.electron?.dialog?.openDirectory);
  }, []);

  const browse = async () => {
    const picked = await window.electron?.dialog?.openDirectory();
    if (picked) {
      editSeq.current += 1;
      setDir(picked);
      setDirTouched(true);
    }
  };

  const launch = async (harness: PtyHarness) => {
    const seqAtLaunch = editSeq.current;
    const branchSeqAtLaunch = branchEditSeq.current;
    const ok = await onLaunch({
      harness,
      dir,
      worktreeBranch: worktree ? branch : undefined,
    });
    // fresh generated branch for the next one — unless the operator already
    // typed the next name while this spawn was in flight
    if (ok && worktree && branchEditSeq.current === branchSeqAtLaunch) {
      setBranch(defaultBranch());
    }
    // resume following the active project — but only if the operator
    // hasn't typed a different dir while the spawn was running
    if (ok && editSeq.current === seqAtLaunch) setDirTouched(false);
  };

  return (
    <div className="ml-auto flex flex-wrap items-center gap-1.5">
      <input
        value={dir}
        onChange={(e) => {
          editSeq.current += 1;
          setDir(e.target.value);
          setDirTouched(true);
        }}
        placeholder="project directory (required)"
        aria-label="Working directory for new sessions"
        className="w-72 rounded border bg-transparent px-2 py-1 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
        style={{ color: HUD.textMono, borderColor: 'rgba(80,230,255,0.2)' }}
      />
      {canBrowse && (
        <button
          type="button"
          onClick={() => void browse()}
          title="Browse for a project directory"
          aria-label="Browse for a project directory"
          className="rounded border px-2 py-1 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
          style={{ color: HUD.textDim, borderColor: 'rgba(80,230,255,0.2)' }}
        >
          📁 Browse
        </button>
      )}
      <button
        onClick={() => setWorktree((w) => !w)}
        aria-pressed={worktree}
        title="Launch inside a fresh git worktree (<repo>-wt/<branch>)"
        className="rounded border px-2 py-1 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
        style={{
          color: worktree ? HUD.cyan : HUD.textDim,
          borderColor: worktree ? 'rgba(25,230,255,0.45)' : 'rgba(80,230,255,0.2)',
          background: worktree ? 'rgba(25,230,255,0.08)' : 'transparent',
        }}
      >
        ⎇ worktree
      </button>
      {worktree && (
        <input
          value={branch}
          onChange={(e) => {
            branchEditSeq.current += 1;
            setBranch(e.target.value);
          }}
          aria-label="Branch name for the new worktree"
          className="w-36 rounded border bg-transparent px-2 py-1 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
          style={{ color: HUD.cyan, borderColor: 'rgba(25,230,255,0.35)' }}
        />
      )}
      {HARNESS_ORDER.map((h) => (
        <button
          key={h}
          onClick={() => void launch(h)}
          className="hud-lift flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-hud-cyan"
          style={{
            color: HARNESS_META[h].color,
            borderColor: 'rgba(80,230,255,0.25)',
            background: 'rgba(10,20,32,0.6)',
          }}
          title={`Launch a new ${HARNESS_META[h].label} session${dir ? ` in ${dir}` : ''}${worktree ? ` (new worktree ${branch})` : ''}`}
        >
          <HarnessGlyph harness={h} />
          {HARNESS_META[h].launch}
        </button>
      ))}
    </div>
  );
}
