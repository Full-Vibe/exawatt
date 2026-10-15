'use client';

/**
 * The chooser's controllable parts (ENG-046 O2): the Project card it lists
 * and the three routes into a Project under it (Browse, Import, Connect).
 *
 * They were inline JSX inside `ProjectOpener`, bound to its native-picker
 * state. The Start screen offers the same routes and the same rows, so the
 * pieces take their verbs as props and both surfaces render one component.
 */
import type { ReactNode } from 'react';
import { Cable, FolderInput, FolderOpen } from 'lucide-react';
import { WORKSPACE_HUD as HUD, withThemeAlpha } from './workspace-theme';

/** One Project in the chooser's grid: identity bar, name, folder line. */
export function ProjectCard({
  name,
  color,
  detail,
  onOpen,
}: {
  name: string;
  /** Project identity colour; a row with none yet shows the muted bar. */
  color: string | null;
  /** The folder line under the name (path, "No folder", a sync note). */
  detail: ReactNode;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group min-w-0 rounded-md border p-3 text-left outline-none transition-colors hover:bg-hud-fill focus-visible:ring-1 focus-visible:ring-hud-cyan"
      style={{
        borderColor: HUD.strokeFaint,
        background: HUD.surfaceInputSoft,
      }}
    >
      <span
        className="mb-5 block h-5 w-[3px] rounded-full"
        style={{
          background: color ?? HUD.textDim,
          boxShadow: `0 0 8px ${withThemeAlpha(color ?? HUD.textDim, 0.4)}`,
        }}
      />
      <span
        className="block truncate text-sm font-medium"
        style={{ color: HUD.text }}
      >
        {name}
      </span>
      <span
        className="mt-1 block truncate font-mono text-chrome-micro"
        style={{ color: HUD.textDim }}
      >
        {detail}
      </span>
    </button>
  );
}

/**
 * Browse Folder, Import Folder, Connect a server: every way into a Project
 * that does not start from a row. `trailing` takes the chooser's registry
 * label; the Start screen passes nothing.
 */
export function ProjectRoutes({
  disabled = false,
  connectSupported = true,
  onBrowse,
  onImport,
  onConnect,
  trailing,
}: {
  /** A native picker owns the screen; no second route may start. */
  disabled?: boolean;
  /** Connecting needs the desktop bridge; outside it the route says so. */
  connectSupported?: boolean;
  onBrowse: () => void;
  onImport: () => void;
  onConnect: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-project-routes>
      <button
        type="button"
        disabled={disabled}
        onClick={onBrowse}
        data-project-route="browse"
        className="inline-flex h-8 items-center gap-2 rounded border px-3 font-mono text-xs outline-none hover:bg-hud-fill disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-hud-cyan"
        style={{
          color: HUD.text,
          borderColor: HUD.strokeSoft,
        }}
      >
        <FolderOpen className="h-3.5 w-3.5" /> Browse Folder
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onImport}
        data-project-route="import"
        className="inline-flex h-8 items-center gap-2 rounded px-3 font-mono text-xs outline-none hover:bg-hud-fill disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-hud-cyan"
        style={{ color: HUD.textDim }}
      >
        <FolderInput className="h-3.5 w-3.5" /> Import Folder
      </button>
      {/* The third route (ENG-010 C2): a Project comes from disk, an Agent
        can come from a server the operator already runs. It carries Browse
        Folder's weight because it is a peer way in, not a footnote under the
        Project routes. */}
      <span
        aria-hidden
        className="mx-1 h-5 w-px"
        style={{ background: HUD.strokeFaint }}
      />
      <button
        type="button"
        disabled={disabled || !connectSupported}
        onClick={onConnect}
        data-project-route="connect"
        className="inline-flex h-8 items-center gap-2 rounded border px-3 font-mono text-xs outline-none hover:bg-hud-fill disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-hud-cyan"
        style={{
          color: HUD.text,
          borderColor: HUD.strokeSoft,
        }}
      >
        <Cable className="h-3.5 w-3.5" /> Connect a server…
      </button>
      {!connectSupported && (
        <span
          className="font-mono text-chrome-micro"
          style={{ color: HUD.textDim }}
        >
          Desktop app only
        </span>
      )}
      {trailing}
    </div>
  );
}
