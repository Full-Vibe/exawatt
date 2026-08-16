/**
 * `/hud-gallery` study for the readiness grammar (ENG-026 N0) — the operator
 * review bench required before production surfaces adopt the components.
 * DOM-only by design: readiness is chrome, and no R3F sibling exists for it
 * (the Fleet board carries no readiness marks in this arc).
 */
import { CloudUpload, Shapes } from 'lucide-react';
import { HUD, withAlpha } from '@/components/hud/tokens';
import { CONSUMPTION_SURFACE_NAME } from '@exawatt/core';
import {
  AnnouncedChip,
  ComingSoonMarker,
  READINESS_NEUTRAL,
  Unbuilt,
  UnbuiltLegend,
} from '@/components/readiness';

function StateCard({
  state,
  rule,
  children,
}: {
  state: string;
  rule: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
      style={{ borderColor: HUD.strokeSoft, background: HUD.bg.panelFill }}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-chrome-label" style={{ color: HUD.cyan }}>
          {state}
        </span>
      </div>
      <div className="flex min-h-12 items-center">{children}</div>
      <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
        {rule}
      </p>
    </div>
  );
}

/** A miniature surface header, as the marker's real mounting context. */
function MiniHeader({ marked }: { marked: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <span
        className="text-chrome-title font-semibold tracking-tight"
        style={{ color: HUD.text }}
      >
        {CONSUMPTION_SURFACE_NAME}
      </span>
      {marked && <ComingSoonMarker />}
    </span>
  );
}

export function ReadinessGrammarStudy() {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <p
        className="max-w-[72ch] text-sm leading-relaxed"
        style={{ color: HUD.textDim }}
      >
        Readiness is a fact carried in the navigation manifest
        (`nav/surfaces.ts`), not per-component styling: shipping a capability
        is a one-line manifest flip plus a source swap. One visual family —
        the neutral grey (<span style={{ color: READINESS_NEUTRAL }}>never a
        status or data channel</span>), a dashed stroke at every scale, and
        the single phrase <span style={{ color: HUD.text }}>Coming soon</span>.
        This generalizes ENG-008 E4&rsquo;s Consumption-local
        &ldquo;designed, not built&rdquo; treatment; two vocabularies did not
        survive.
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <StateCard
          state="live"
          rule="Built, truthful, the user's own data. Normal presentation — the grammar says nothing at all."
        >
          <MiniHeader marked={false} />
        </StateCard>
        <StateCard
          state="preview"
          rule="The real page over a representative source. One persistent marker in the surface header; no banners, no repeated disclaimers."
        >
          <MiniHeader marked />
        </StateCard>
        <StateCard
          state="announced"
          rule="The affordance is visible so the map is complete; nothing is behind it. Muted, cursor default, tooltip naming what is coming — not yet, never broken."
        >
          <span className="flex flex-wrap items-center gap-2">
            <AnnouncedChip coming="one-click hosted agents (ENG-033)">
              <CloudUpload aria-hidden className="h-3.5 w-3.5" />
              Push to cloud
            </AnnouncedChip>
            <AnnouncedChip coming="portable Agent Types (ENG-028)">
              <Shapes aria-hidden className="h-3.5 w-3.5" />
              Reviewer
            </AnnouncedChip>
            {/* micro cut for dense card headers (ENG-026 N5's Type slot) */}
            <AnnouncedChip size="micro" coming="portable Agent Types (ENG-028)">
              <Shapes aria-hidden className="h-2.5 w-2.5" />
              Type
            </AnnouncedChip>
          </span>
        </StateCard>
      </div>

      <div className="flex flex-col gap-3">
        <UnbuiltLegend />
        <Unbuilt
          owner="specimen · block-scale announced region"
          note="Contents render inert: not clickable, not focusable, not tabbable. A drawing of a control, not a control."
        >
          <div className="flex items-center gap-4">
            <span className="text-sm" style={{ color: HUD.text }}>
              Weekly ceiling
            </span>
            <span
              className="h-2 w-48 rounded-[2px]"
              style={{ background: withAlpha(READINESS_NEUTRAL, 0.3) }}
            />
            <span
              className="rounded px-3 py-1.5 text-chrome-label"
              style={{
                border: `1px solid ${withAlpha(READINESS_NEUTRAL, 0.5)}`,
                color: HUD.textDim,
              }}
            >
              Apply
            </span>
          </div>
        </Unbuilt>
      </div>
    </div>
  );
}
