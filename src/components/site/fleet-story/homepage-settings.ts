import type { NamesId } from './names';
import type { CopySetId } from './stages';
import type { SnapMode } from './use-scene-scroll';
import type { CrustMarkId } from './visuals/crust-marks';
import type { CrustMaterialId } from '@/components/tiles/crust-materials';
import {
  DEFAULT_MOTION,
  type CrustMotion,
} from '@/components/tiles/crust-motion';
import type { CrustShapeId } from '@/components/tiles/crust-shape';
import type { CrustSignalId } from '@/components/tiles/crust-signal';
import type { EnvironmentKind } from '@/components/tiles/environment';

/**
 * What the homepage draws (ENG-031 W15m): the study's choices, fixed. The
 * study at /hud-gallery/homepage-study opens on these and can switch each
 * one, so what is judged there is what `/` ships.
 */
export const HOMEPAGE_STORY: {
  copySet: CopySetId;
  material: CrustMaterialId;
  mark: CrustMarkId;
  shape: CrustShapeId;
  motion: CrustMotion;
  signal: CrustSignalId;
  light: EnvironmentKind;
  snap: SnapMode;
  sound: boolean;
  names: NamesId;
} = {
  copySet: 'canon',
  // operator 2026-10-14: "Gummy but I may switch to acrylic if gummy is too
  // distracting / cute"
  material: 'gummy',
  mark: 'relief',
  shape: 'rounded',
  motion: DEFAULT_MOTION,
  signal: 'paint',
  light: 'studio',
  // one scene per gesture (operator 2026-10-14: "I think 1; can I test 2 in
  // the study?"); Soft, the other, stays in the study to compare
  snap: 'page',
  sound: true,
  names: 'auto',
};
