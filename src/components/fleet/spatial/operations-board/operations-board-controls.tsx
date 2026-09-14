'use client';

/**
 * The board's DOM control plane: Project chips, per-Agent hit targets and
 * tooltips, and delegation controls, all parented through DampedHtmlAnchor so
 * DOM rides the same damped camera as the WebGL it fronts. Interaction and
 * a11y live here; the WebGL layers stay visual-only.
 */

import { Html } from '@react-three/drei';
import {
  useFrame,
  useThree,
} from '@react-three/fiber';
import {
  memo,
  useLayoutEffect,
  useRef,
  type ReactNode,
  useSyncExternalStore,
} from 'react';
import * as THREE from 'three';
import {
  type SpatialBoardDelegationUnit,
  type SpatialBoardLayout,
  type SpatialBoardLens,
  type SpatialBoardPiece,
  type SpatialBoardProjectZone,
} from '@exawatt/ui-model';
import {
  STATUS_LIGHT_META,
  workStateReading,
  type StatusLightReading,
  type StatusLightState,
} from '@/components/status-light/protocol';
import {
  type ZoneLabelTierStore,
} from './operations-board-label-tier';
import {
  useBoardTransitionClock,
} from './operations-board-field';
import {
  isBoardTransitionActive,
} from './operations-board-transition';
import {
  spatialColorWithAlpha,
  spatialPressureColor,
  spatialProjectIdentityColor,
  type SpatialThemeSnapshot,
} from '../spatial-theme';
import { delegationElapsedLabel } from '../spatial-agent-copy';
import { useMinuteClock } from '../use-minute-clock';
import type {
  BoardAgentCandidate,
} from './operations-board-presentation';

function ProjectHealthRail({
  zone,
  theme,
}: {
  zone: SpatialBoardProjectZone;
  theme: SpatialThemeSnapshot;
}) {
  const total = Math.max(zone.agentCount, 1);
  // Keyed by reading, painted by light state. The unreported band is its own
  // segment so the rail's widths still add up to the zone's population; it
  // shares the unlit paint because hue is not what separates it from idle.
  const segments: Array<[StatusLightReading, StatusLightState, number]> = [
    [
      'active',
      'active',
      zone.statusCounts.working + zone.statusCounts.reviewing,
    ],
    ['needs-you', 'needs-you', zone.statusCounts.blocked],
    ['fault', 'fault', zone.statusCounts.error],
    ['result', 'result', zone.statusCounts.complete],
    ['off', 'off', zone.statusCounts.idle],
    ['unreported', 'off', zone.statusCounts.unreported],
  ];
  return (
    <span
      className="mt-1 flex h-[3px] w-full overflow-hidden"
      style={{ background: spatialColorWithAlpha(theme.unitMuted, 0.28) }}
    >
      {segments.map(([reading, paint, count]) =>
        count > 0 ? (
          <span
            key={reading}
            style={{
              width: `${(count / total) * 100}%`,
              background: theme.status[paint],
            }}
          />
        ) : null
      )}
    </span>
  );
}

/** Ceiling for in-world DOM anchors: above the board's own chrome, below the
 *  app's fixed layers (the feedback panel is `z-50`, first-run is `z-90`). */
const BOARD_HTML_Z_MAX = 30;

function DampedHtmlAnchor({
  position,
  reduced,
  center = false,
  children,
}: {
  position: [number, number, number];
  reduced: boolean;
  center?: boolean;
  children: ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const initial = useRef(position);
  const target = useRef(position);
  target.current = position;
  const invalidate = useThree(state => state.invalidate);
  const transitionClock = useBoardTransitionClock();
  useLayoutEffect(() => {
    if (!reduced || !group.current) return;
    group.current.position.set(...position);
    invalidate();
  }, [invalidate, position, reduced]);
  useFrame((state, delta) => {
    const node = group.current;
    if (!node || reduced) return;
    // During a semantic transition the whole field is being carried, so an
    // anchor that also damped its own local position would ease twice and lag
    // behind the piece it labels. It takes the new local spot immediately and
    // lets the field do the travelling.
    if (
      transitionClock &&
      isBoardTransitionActive(transitionClock.current, performance.now())
    ) {
      node.position.set(...target.current);
      return;
    }
    const nextX = THREE.MathUtils.damp(
      node.position.x,
      target.current[0],
      7.5,
      delta
    );
    const nextY = THREE.MathUtils.damp(
      node.position.y,
      target.current[1],
      7.5,
      delta
    );
    const nextZ = THREE.MathUtils.damp(
      node.position.z,
      target.current[2],
      7.5,
      delta
    );
    const moving =
      Math.abs(nextX - target.current[0]) > 0.001 ||
      Math.abs(nextY - target.current[1]) > 0.001 ||
      Math.abs(nextZ - target.current[2]) > 0.001;
    node.position.set(
      moving ? nextX : target.current[0],
      moving ? nextY : target.current[1],
      moving ? nextZ : target.current[2]
    );
    if (moving) state.invalidate();
  });
  return (
    <group ref={group} position={initial.current}>
      <Html
        center={center}
        // drei defaults this to 16,777,271, which is above every app-chrome
        // layer in the product — in-world labels then paint over the quick
        // feedback panel and anything else fixed above the board. These
        // anchors belong just above the board's own overlay chrome (z-10/z-20)
        // and below app chrome, so the range is stated rather than defaulted.
        zIndexRange={[BOARD_HTML_Z_MAX, 0]}
        style={{ pointerEvents: 'auto' }}
      >
        {children}
      </Html>
    </group>
  );
}

/** Zone-label budget (V3.1): full cards only when the zone's projected size
 *  can afford them; below that a one-line chip keeps identity, count, and the
 *  drill affordance while the population field stays visible. */

/** "12%" / "<1%" — the zone control is the exact-figure owner while the dot
 *  field speaks in color. */
function burnShareCopy(share: number): string {
  const pct = Math.round(share * 100);
  return pct < 1 ? '<1%' : `${pct}%`;
}

export const ProjectControls = memo(function ProjectControls({
  zones,
  altitude,
  focusedProjectId,
  labelTierStore,
  reduced,
  lens,
  onDrillProject,
  onToggleZoneSelect,
  theme,
}: {
  zones: SpatialBoardProjectZone[];
  altitude: SpatialBoardLayout['altitude'];
  focusedProjectId: string | null;
  labelTierStore: ZoneLabelTierStore;
  reduced: boolean;
  lens: SpatialBoardLens;
  onDrillProject: (projectId: string) => void;
  onToggleZoneSelect?: (zoneId: string) => void;
  theme: SpatialThemeSnapshot;
}) {
  const labelTier = useSyncExternalStore(
    labelTierStore.subscribe,
    labelTierStore.get,
    labelTierStore.get
  );
  return zones.map(zone => {
    // The zone control is the focusable DOM equivalent of the zone plate, so
    // it carries both verbs: activate opens, shift-activate (pointer or
    // keyboard — synthesized clicks keep modifier state) toggles selection.
    const activateZone = (event: { shiftKey: boolean }) => {
      if (event.shiftKey && onToggleZoneSelect) onToggleZoneSelect(zone.id);
      else onDrillProject(zone.id);
    };
    const position: [number, number, number] = [
      zone.rect.x + zone.radius * 0.28,
      -(zone.rect.y + 1.25),
      0.8,
    ];
    const accent = spatialProjectIdentityColor(theme, zone.id);
    // Compact is a CLASS, not a different tree. The label used to swap its
    // whole DOM subtree between a compact and a full rendering when the zoom
    // crossed a threshold or focus changed, which remounted every zone's
    // control at once -- ten <Html> portals in one commit, a 58ms stall
    // measured mid-flight, and a visible hitch in the camera. One structure
    // that shows or hides its detail rows costs an attribute write per zone
    // and never interrupts a frame. Detail rows also read as a reveal, which
    // is what altitude is supposed to feel like.
    const compact =
      labelTier === 'compact' ||
      (altitude !== 'fleet' && zone.id !== focusedProjectId);
    const burnShare =
      lens === 'burn' && zone.burn ? burnShareCopy(zone.burn.share) : null;
    const content = (
      <>
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={
              compact
                ? 'max-w-[10rem] truncate text-chrome-title font-semibold tracking-[-0.01em]'
                : 'max-w-[11rem] truncate text-sm font-semibold tracking-[-0.01em]'
            }
            style={{ color: theme.label }}
          >
            {zone.label}
          </span>
          <span className="flex items-baseline gap-2">
            <span
              className="font-mono text-chrome-meta tabular-nums"
              style={{ color: theme.labelMuted }}
            >
              {zone.agentCount}
              <span className={compact ? 'hidden' : undefined}>A</span>
            </span>
            {zone.blockedCount > 0 && (
              <span
                className={
                  compact ? 'font-mono text-chrome-nano tabular-nums' : 'hidden'
                }
                style={{ color: theme.status['needs-you'] }}
              >
                {zone.blockedCount}!
              </span>
            )}
            {burnShare && (
              <span
                className={
                  compact ? 'font-mono text-chrome-nano tabular-nums' : 'hidden'
                }
                style={{
                  color: spatialPressureColor(theme, zone.burn!.intensity),
                }}
                title={`${burnShare} of the fleet's normalized token burn`}
              >
                {burnShare}
              </span>
            )}
          </span>
        </span>
        <span
          className={
            compact
              ? 'hidden'
              : 'mt-1 flex gap-2 font-mono text-chrome-meta tabular-nums'
          }
          style={{ color: theme.labelMuted }}
        >
          <span>
            {zone.agentCount === 0
              ? 'No agents yet'
              : `${zone.activeCount} active`}
          </span>
          {zone.blockedCount > 0 && (
            <span style={{ color: theme.status['needs-you'] }}>
              {zone.blockedCount} blocked
            </span>
          )}
          {lens === 'burn' &&
            (zone.burn ? (
              <span
                style={{
                  color: spatialPressureColor(theme, zone.burn.intensity),
                }}
                title={`${burnShare} of the fleet's normalized token burn`}
              >
                {burnShare} of burn
              </span>
            ) : (
              <span style={{ color: theme.consumption.unknown }}>
                usage unreported
              </span>
            ))}
        </span>
        <span className={compact ? 'hidden' : 'block'}>
          <ProjectHealthRail zone={zone} theme={theme} />
        </span>
      </>
    );
    const frameClass = compact
      ? 'exa-material-chrome board-control-enter border px-2 py-1.5 text-left'
      : 'exa-material-chrome board-control-enter w-52 border px-3 py-2.5 text-left';
    const frameStyle = {
      borderColor: accent,
      color: theme.label,
      boxShadow: `0 8px 22px ${theme.shadow}`,
    };
    return (
      <DampedHtmlAnchor key={zone.id} position={position} reduced={reduced}>
        {!zone.isAggregate ? (
          <button
            type="button"
            data-board-zone={zone.id}
            data-board-zone-tier={compact ? 'compact' : 'full'}
            aria-current={zone.selected ? 'true' : undefined}
            aria-label={`Open Project ${zone.label}`}
            onClick={activateZone}
            style={frameStyle}
            className={`${frameClass} outline-none transition-[border-color,background-color,transform] duration-150 hover:brightness-105 active:translate-y-px focus-visible:ring-2 focus-visible:ring-ring`}
          >
            {content}
          </button>
        ) : (
          <div
            data-board-zone-tier={compact ? 'compact' : 'full'}
            style={frameStyle}
            className={frameClass}
          >
            {content}
          </div>
        )}
      </DampedHtmlAnchor>
    );
  });
});

export const AgentControls = memo(function AgentControls({
  pieces,
  altitude,
  focusedProjectId,
  onSelectAgent,
  onToggleAgentSelect,
  onHoverChange,
  onPressedChange,
  candidateTreatment,
  multiSelection,
  reduced,
  theme,
}: {
  pieces: SpatialBoardPiece[];
  altitude: SpatialBoardLayout['altitude'];
  focusedProjectId: string | null;
  onSelectAgent: (agentId: string) => void;
  onToggleAgentSelect?: (agentId: string) => void;
  onHoverChange: (agentId: string | null) => void;
  onPressedChange: (agentId: string | null) => void;
  candidateTreatment: BoardAgentCandidate;
  multiSelection?: ReadonlySet<string>;
  reduced: boolean;
  theme: SpatialThemeSnapshot;
}) {
  if (altitude === 'fleet') return null;
  return pieces
    .filter(
      piece =>
        piece.kind === 'agent' &&
        piece.visible &&
        piece.agentId &&
        piece.projectId === focusedProjectId
    )
    .map(piece => {
      // The READING, not the light state: an Agent whose source reported
      // nothing must not be announced as idle in the accessible name, which
      // is the only channel a screen reader or a colourless capture has.
      const lightState = workStateReading(piece.status);
      // Delegation joins the control copy as labels (ENG-023 D3b): the count
      // and the team's kinds. Full child descriptions stay at the Sessions
      // and Terminal altitudes — a board tooltip is not a roster.
      const delegated = piece.delegation;
      const delegationCopy = delegated
        ? `${delegated.count} delegated ${delegated.count === 1 ? 'agent' : 'agents'} working`
        : null;
      const delegationKinds = delegated
        ? [
            ...new Set(
              delegated.children
                .map(child => child.agentType?.trim())
                .filter((kind): kind is string => !!kind)
            ),
          ].join(', ')
        : '';
      return (
        <DampedHtmlAnchor
          key={`control:${piece.id}`}
          position={[piece.x, -piece.y, 1.2]}
          reduced={reduced}
          center
        >
          <button
            type="button"
            data-board-agent={piece.agentId}
            data-board-session-state={piece.sessionState}
            data-board-status-light={lightState}
            data-board-delegation={delegated ? delegated.count : undefined}
            aria-current={piece.selected ? 'true' : undefined}
            aria-pressed={
              onToggleAgentSelect
                ? (multiSelection?.has(piece.agentId!) ?? false)
                : undefined
            }
            aria-label={`${piece.label}${piece.activity ? `, ${piece.activity}` : ''}, ${STATUS_LIGHT_META[lightState].label}${piece.sessionState === 'stopped' ? ', stopped session' : ''}${delegationCopy ? `, ${delegationCopy}` : ''}`}
            onClick={event => {
              // Shift-activate (pointer or keyboard) toggles the Agent in
              // the multi-selection (V3.2); plain activate inspects it.
              if (event.shiftKey && onToggleAgentSelect) {
                onToggleAgentSelect(piece.agentId!);
              } else {
                onSelectAgent(piece.agentId!);
              }
            }}
            onPointerEnter={() => {
              if (candidateTreatment === 'precision') {
                onHoverChange(piece.agentId!);
              }
            }}
            onPointerLeave={event => {
              if (
                candidateTreatment === 'precision' &&
                document.activeElement !== event.currentTarget
              ) {
                onHoverChange(null);
              }
            }}
            onPointerDown={event => {
              if (event.button !== 0 || candidateTreatment !== 'precision')
                return;
              event.currentTarget.setPointerCapture(event.pointerId);
              onPressedChange(piece.agentId!);
            }}
            onPointerUp={event => {
              if (candidateTreatment !== 'precision') return;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              onPressedChange(null);
            }}
            onPointerCancel={() => {
              if (candidateTreatment === 'precision') onPressedChange(null);
            }}
            onLostPointerCapture={() => {
              if (candidateTreatment === 'precision') onPressedChange(null);
            }}
            onFocus={() => {
              if (candidateTreatment === 'precision') {
                onHoverChange(piece.agentId!);
              }
            }}
            onBlur={() => {
              if (candidateTreatment === 'precision') {
                onHoverChange(null);
                onPressedChange(null);
              }
            }}
            onKeyDown={event => {
              if (
                candidateTreatment === 'precision' &&
                (event.key === 'Enter' || event.key === ' ')
              ) {
                onPressedChange(piece.agentId!);
              }
            }}
            onKeyUp={event => {
              if (
                candidateTreatment === 'precision' &&
                (event.key === 'Enter' || event.key === ' ')
              ) {
                onPressedChange(null);
              }
            }}
            className={`board-control-enter group relative grid h-11 w-11 cursor-pointer place-items-center border border-transparent bg-transparent outline-none transition-[border-color,transform] duration-150 active:translate-y-px ${
              candidateTreatment === 'precision'
                ? ''
                : 'focus-visible:ring-2 focus-visible:ring-ring'
            }`}
          >
            {/* Reveal-only (operator, 2026-08-11): a persistent card per Agent
                put three lines of prose on a board whose job is a glance, and
                the prose was the least of what it said. Status, activity and
                lineage are carried by the mark, its motion, and the spoke; the
                words are here for the one unit you point at, and for the
                accessible name that never depended on them being visible. */}
            <span
              className="exa-material-overlay pointer-events-none absolute left-1/2 top-[calc(100%+3px)] w-16 -translate-x-1/2 border px-1 py-1 text-center text-chrome-nano font-medium opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none sm:w-28 sm:px-1.5 sm:text-chrome-micro"
              style={{
                borderColor: theme.unitMuted,
                color: theme.label,
                boxShadow: `0 8px 22px ${theme.shadow}`,
              }}
            >
              <span className="block truncate">{piece.label}</span>
              <span
                className="mt-0.5 block truncate text-chrome-nano font-normal"
                style={{ color: theme.labelMuted }}
              >
                {piece.activity ?? 'No recent activity reported'}
              </span>
              {delegationCopy && (
                <span
                  className="block truncate text-chrome-nano font-normal"
                  style={{ color: theme.labelMuted }}
                >
                  {delegated!.count} delegated
                  {delegationKinds ? ` · ${delegationKinds}` : ''}
                </span>
              )}
            </span>
          </button>
        </DampedHtmlAnchor>
      );
    });
});

/**
 * DOM equivalents for delegated child units (D3c). WebGL stays out of the
 * accessibility tree, so every visible child is reachable by pointer, focus,
 * and screen reader here. Focus reveals type, description, elapsed, and parent.
 * Activating opens the PARENT Session: D3c does not pretend a child is
 * independently commandable, and never joins "Direct N Agents".
 */
export const DelegationControls = memo(function DelegationControls({
  units,
  pieces,
  altitude,
  focusedProjectId,
  onSelectAgent,
  onSelectDelegationChild,
  onHoverChange,
  reduced,
  theme,
}: {
  units: SpatialBoardDelegationUnit[];
  pieces: SpatialBoardPiece[];
  altitude: SpatialBoardLayout['altitude'];
  focusedProjectId: string | null;
  onSelectAgent: (agentId: string) => void;
  /** Reports which child was activated, so the surface that opens the parent
   *  can also say WHICH worker the operator meant. */
  onSelectDelegationChild?: (parentAgentId: string, childId: string) => void;
  onHoverChange: (unitId: string | null) => void;
  reduced: boolean;
  /** Injected clock so elapsed copy is deterministic and stable per paint. */
  theme: SpatialThemeSnapshot;
}) {
  // The minute clock lives with its only consumer. At the canvas root it
  // re-rendered every layer under the board once a minute for the elapsed
  // labels on delegated children -- measured as two renders on the wall-clock
  // minute with the board otherwise parked under reduced motion.
  const now = useMinuteClock();
  if (altitude === 'fleet') return null;
  const parentLabels = new Map(
    pieces.map(piece => [piece.id, piece.label] as const)
  );
  return units
    .filter(unit => unit.projectId === focusedProjectId)
    .map(unit => {
      const parentLabel = parentLabels.get(unit.parentPieceId) ?? 'its parent';
      const elapsed = delegationElapsedLabel(unit.startedAt, now);
      // The label states what activation does. A child looks like a peer but
      // is not independently commandable until ENG-023 D2 gives it a
      // destination, so silently selecting the parent would be a trapdoor.
      const label =
        unit.kind === 'overflow'
          ? `${unit.overflowCount} more delegated Agents under ${parentLabel}. Selects ${parentLabel}.`
          : [
              unit.agentType ?? 'Delegated Agent',
              unit.description,
              elapsed ? `running ${elapsed}` : null,
              `delegated by ${parentLabel}`,
            ]
              .filter(Boolean)
              .join(', ') + `. Selects ${parentLabel}.`;
      return (
        <DampedHtmlAnchor
          key={`delegation-control:${unit.id}`}
          position={[unit.x, -unit.y, 1.1]}
          reduced={reduced}
          center
        >
          <button
            type="button"
            data-board-delegation-unit={unit.id}
            data-board-delegation-kind={unit.kind}
            data-board-delegation-parent={unit.parentAgentId}
            aria-label={label}
            title={label}
            onClick={() => {
              if (unit.kind === 'child' && unit.childId) {
                onSelectDelegationChild?.(unit.parentAgentId, unit.childId);
              }
              onSelectAgent(unit.parentAgentId);
            }}
            onPointerEnter={() => onHoverChange(unit.id)}
            onPointerLeave={() => onHoverChange(null)}
            onFocus={() => onHoverChange(unit.id)}
            onBlur={() => onHoverChange(null)}
            className="board-control-enter group relative grid h-11 w-11 place-items-center border border-transparent bg-transparent outline-none transition-[border-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {unit.kind === 'overflow' && (
              <span
                aria-hidden="true"
                className="pointer-events-none font-mono text-chrome-micro font-semibold"
                style={{ color: theme.label }}
              >
                +{unit.overflowCount}
              </span>
            )}
          </button>
        </DampedHtmlAnchor>
      );
    });
});
