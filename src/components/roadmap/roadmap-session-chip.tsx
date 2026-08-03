// No 'use client': only imported by the client workspace surface.

/**
 * A live session rendered on the roadmap item it executes. Link confidence
 * is a rest state: solid border = declared at launch, dashed = inferred,
 * with the evidence spelled out in the tooltip. The chip is the lens's one
 * cross-surface jump — activating it focuses that terminal tab.
 */
import {
  WORKSPACE_HUD as HUD,
  withThemeAlpha as withAlpha,
} from '@/components/workspace/workspace-theme';
import { HarnessGlyph } from '../workspace/harness-icons';
import type { PtyHarness } from '@/types/electron';
import type { RoadmapSessionChip as ChipModel } from '@exawatt/ui-model';

export function chipTooltip(chip: ChipModel): string {
  const method = chip.method === 'declared' ? 'declared at launch' : 'inferred';
  const evidence = chip.evidence.map(e => e.excerpt).join(' · ');
  return evidence ? `${method} — ${evidence}` : method;
}

export function RoadmapSessionChipButton({
  chip,
  color,
  selected,
  onJump,
}: {
  chip: ChipModel;
  color: string;
  selected: boolean;
  onJump: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      data-roadmap-chip={chip.sessionId}
      data-selected={selected || undefined}
      title={chipTooltip(chip)}
      onClick={onJump}
      className="flex min-w-0 max-w-full items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-chrome-micro outline-none hover:bg-hud-fill-hi"
      style={{
        borderColor: selected ? color : withAlpha(color, 0.45),
        borderStyle: chip.method === 'inferred' ? 'dashed' : 'solid',
        background: selected ? withAlpha(color, 0.12) : 'transparent',
        color: HUD.text,
        boxShadow: selected ? `0 0 8px ${withAlpha(color, 0.35)}` : 'none',
      }}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 shrink-0 rotate-45"
        style={{ background: color }}
      />
      {chip.harness !== 'shell' && (
        <span className="shrink-0" style={{ color }}>
          <HarnessGlyph harness={chip.harness as PtyHarness} size={10} />
        </span>
      )}
      <span className="min-w-0 truncate">{chip.title}</span>
      {chip.needsAttention && (
        <span className="relative ml-0.5 inline-flex h-1.5 w-1.5 shrink-0">
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full motion-reduce:animate-none"
            style={{ background: HUD.amber, opacity: 0.6 }}
          />
          <span
            className="relative inline-flex h-1.5 w-1.5 rounded-full"
            style={{ background: HUD.amber }}
          />
        </span>
      )}
    </button>
  );
}
