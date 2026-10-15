import type { SpatialThemeSnapshot } from '@/components/fleet/spatial/spatial-theme';
import type { StatusLightState } from '@/components/status-light/protocol';
import type { HARNESS_MARK_PATHS } from '@/components/workspace/harness-icons';
import type { CrustMarkId } from './crust-marks';
import type { CrustMaterialId } from './crust-materials';
import type { CrustMotion } from './crust-motion';
import type { CrustShapeId } from './crust-shape';
import type { CrustSignalId } from './crust-signal';
import type { EnvironmentKind } from './environment';
import type { PressSoundSetting } from './press-sounds';
import type { TileSurface } from './surface';

/** Geometry carries no site/concept registry. Each caller supplies its marks. */
export interface TileMarkRegistry {
  paths: Readonly<Record<string, (typeof HARNESS_MARK_PATHS)['claude']>>;
  tone: (id: string, tone: string) => string | null;
}

/** A tile is already laid out by its owner. x/y map to world X/Z. */
export interface TileInstance {
  id: string;
  agentId?: string;
  x: number;
  y: number;
  elevation?: number;
  /** Uniform size relative to the authored tile (body circumradius .82). */
  radius?: number;
  status?: StatusLightState;
  mark?: string;
  /** Stable motion phase; unrelated to the renderer's instance ordering. */
  phase?: number;
  ring?: number;
}

export interface TileFrame {
  focusId: string | null;
  selection: ReadonlySet<string>;
  exemplarId?: string | null;
  highlightWeights?: Partial<Record<StatusLightState, number>>;
  highlightStrength?: number;
  outlined?: boolean;
  tilePresent?: (tileId: string) => boolean;
  tileGhost?: (tileId: string) => boolean;
  tileAgent?: (tileId: string) => boolean;
}

export interface TileRendererProps {
  tiles: readonly TileInstance[];
  surface: TileSurface;
  theme: SpatialThemeSnapshot;
  marks: TileMarkRegistry;
  readFrame: () => TileFrame;
  material: CrustMaterialId;
  mark: CrustMarkId;
  shape: CrustShapeId;
  motion: CrustMotion;
  signal: CrustSignalId;
  light?: EnvironmentKind;
  reducedMotion: boolean;
  /** Product attention stays still; only active work animates. */
  calmAttention?: boolean;
  /** Host owns cadence. The layer never starts an independent frame loop. */
  requestFrame?: () => void;
  /** Supply the host's ambient clock when motion is cadence-driven. */
  readClock?: () => number;
  /** Overview/low-power hosts can remove the extra transmission pass. */
  transmission?: boolean;
  sound?: PressSoundSetting;
  onExpand?: () => void;
  expandable?: boolean;
  onHoverChange?: (id: string | null) => void;
  onSelect?: (id: string | null) => void;
  onFocusPoint?: (id: string | null, x: number, y: number) => void;
}
