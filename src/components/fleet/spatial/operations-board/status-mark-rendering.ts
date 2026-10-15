/** D40 is world geometry in v1 and a semantic annotation over v2 materials.
 * One transparent-pass ordering keeps the contrast plate, glyph and unread
 * detail readable without another scene, render pass or animation owner. */
export type StatusMarkDepthPolicy = 'scene' | 'overlay';

const policies = {
  scene: {
    depthTest: true,
    depthWrite: false,
    backing: 1,
    glyph: 2,
    cutout: 2,
    unread: 3,
  },
  overlay: {
    depthTest: false,
    depthWrite: false,
    backing: 10,
    glyph: 11,
    cutout: 12,
    unread: 13,
  },
} as const;

export function statusMarkRendering(policy: StatusMarkDepthPolicy = 'scene') {
  return policies[policy];
}
