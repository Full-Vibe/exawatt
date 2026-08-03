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
import { StatusLight } from '@/components/status-light/status-light';
import { useEffect, useState } from 'react';

export function chipTooltip(chip: ChipModel): string {
  const method = chip.method === 'declared' ? 'declared at launch' : 'inferred';
  const evidence = chip.evidence.map(e => e.excerpt).join(' · ');
  return evidence ? `${method} — ${evidence}` : method;
}

function elapsedLabel(startedAt: number | null, now: number): string | null {
  if (!startedAt) return null;
  const minutes = Math.max(0, Math.floor((now - startedAt) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
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
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = elapsedLabel(chip.startedAt, now);
  const lightState =
    chip.turnState === 'needs-you'
      ? 'needs-you'
      : chip.turnState === 'working'
        ? 'active'
        : 'off';
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
      <StatusLight decorative size="compact" state={lightState} />
      {chip.harness !== 'shell' && (
        <span className="shrink-0" style={{ color }}>
          <HarnessGlyph harness={chip.harness as PtyHarness} size={10} />
        </span>
      )}
      <span className="min-w-0 truncate">{chip.title}</span>
      <span className="shrink-0" style={{ color: HUD.textDim }}>
        {chip.turnState === 'working'
          ? 'working'
          : chip.turnState === 'needs-you'
            ? 'needs you'
            : 'waiting'}
        {elapsed ? ` · ${elapsed}` : ''}
      </span>
    </button>
  );
}
