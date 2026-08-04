// No 'use client': only imported by the client workspace surface.

/**
 * The designed "no food" moment (ENG-017): queue health is the point of the
 * lens, so an empty queue is its most assertive state — an amber terminus
 * node on the spine, plain words, one affordance. Also covers the
 * no-roadmap-found and read-error states so every degraded condition speaks
 * in the same voice.
 */
import {
  WORKSPACE_HUD as HUD,
  withThemeAlpha as withAlpha,
} from '@/components/workspace/workspace-theme';

export function RoadmapEmptyQueue({
  shippedCount,
  onOpenFile,
}: {
  shippedCount: number;
  onOpenFile: (() => void) | null;
}) {
  return (
    <div className="relative flex flex-col gap-2 py-4 pl-6 pr-3">
      {/* the spine runs into a hollow amber terminus */}
      <span
        aria-hidden
        className="absolute left-[7px] top-6 h-2.5 w-2.5 rounded-full motion-safe:animate-pulse"
        style={{
          border: `1.5px solid ${HUD.amber}`,
          boxShadow: `0 0 8px ${withAlpha(HUD.amber, 0.5)}`,
        }}
      />
      <p
        className="font-display text-sm font-semibold"
        style={{ color: HUD.amber }}
      >
        Queue empty
      </p>
      <p className="text-xs leading-5" style={{ color: HUD.textDim }}>
        Nothing is next in this project. Agents here will idle when they finish
        {shippedCount > 0 ? ` — ${shippedCount} shipped so far` : ''}.
      </p>
      {onOpenFile && (
        <button
          type="button"
          tabIndex={-1}
          onClick={onOpenFile}
          className="self-start rounded border px-2 py-1 font-mono text-chrome-meta outline-none hover:bg-hud-fill-hi"
          style={{
            color: HUD.amber,
            borderColor: withAlpha(HUD.amber, 0.45),
          }}
        >
          Open roadmap file
        </button>
      )}
    </div>
  );
}

export function RoadmapNoRoadmap({ checkedPaths }: { checkedPaths: string[] }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-4">
      <p
        className="font-display text-sm font-semibold"
        style={{ color: HUD.text }}
      >
        No roadmap found in this repo
      </p>
      <p className="text-xs leading-5" style={{ color: HUD.textDim }}>
        Looked for{' '}
        {checkedPaths.map((p, i) => (
          <span key={p}>
            {i > 0 && ', '}
            <span
              className="font-mono text-chrome-meta"
              style={{ color: HUD.textMono }}
            >
              {p}
            </span>
          </span>
        ))}
        .
      </p>
      <p className="text-xs leading-5" style={{ color: HUD.textDim }}>
        Add a roadmap in one of these locations to activate the lens. Exawatt
        won&apos;t invent project work.
      </p>
    </div>
  );
}

export function RoadmapReadError({ error }: { error: string }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-4">
      <p
        className="font-display text-sm font-semibold"
        style={{ color: HUD.red }}
      >
        Could not read the roadmap
      </p>
      <p
        className="font-mono text-chrome-meta leading-5"
        style={{ color: HUD.textDim }}
      >
        {error}
      </p>
    </div>
  );
}
