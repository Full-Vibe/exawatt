export type FocusScale = 'agent' | 'team' | 'fleet';
type MotionInput = {
  progress: number;
  mode: 'story' | 'lab';
  yaw: number;
  pitch: number;
  focus: FocusScale;
  hovered: number;
};

/** One input authority for scroll, buttons and pointer gestures. No DOM/canvas controllers compete. */
export function createMotionPort() {
  const state: MotionInput = {
    progress: 0,
    mode: 'story',
    yaw: 0,
    pitch: 0,
    focus: 'fleet',
    hovered: -1,
  };
  const listeners = new Set<() => void>();
  return {
    read: () => state,
    change(patch: Partial<MotionInput>) {
      Object.assign(state, patch);
      listeners.forEach(fn => fn());
    },
    orbit(dx: number, dy: number) {
      state.yaw += dx;
      state.pitch = Math.max(-0.22, Math.min(0.2, state.pitch + dy));
      listeners.forEach(fn => fn());
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
export type MotionPort = ReturnType<typeof createMotionPort>;
export interface StoryPose {
  yaw: number;
  pitch: number;
  zoom: number;
  x: number;
  y: number;
}
const POSES: readonly StoryPose[] = [
  { yaw: 0.35, pitch: 0.84, zoom: 1, x: -0.68, y: 0.12 },
  { yaw: 0.1, pitch: 0.92, zoom: 0.9, x: -0.68, y: 0.12 },
  { yaw: -0.32, pitch: 0.8, zoom: 0.94, x: -0.68, y: 0.12 },
  { yaw: 0.1, pitch: 0.94, zoom: 0.91, x: -0.68, y: 0.12 },
  { yaw: 0.48, pitch: 0.61, zoom: 1.1, x: -0.68, y: 0.12 },
  { yaw: 0.78, pitch: 0.8, zoom: 1.04, x: -0.68, y: 0.12 },
];
/** Continuous at every chapter boundary, independent of the discrete copy/selection chapter. */
export function sampleStoryPose(progress: number, out: StoryPose) {
  const p = Math.max(0, Math.min(POSES.length - 1, progress));
  const i = Math.floor(p),
    j = Math.min(i + 1, POSES.length - 1);
  const t = p - i,
    eased = t * t * (3 - 2 * t);
  out.yaw = POSES[i].yaw + (POSES[j].yaw - POSES[i].yaw) * eased;
  out.pitch = POSES[i].pitch + (POSES[j].pitch - POSES[i].pitch) * eased;
  out.zoom = Math.exp(
    Math.log(POSES[i].zoom) +
      (Math.log(POSES[j].zoom) - Math.log(POSES[i].zoom)) * eased
  );
  out.x = POSES[i].x + (POSES[j].x - POSES[i].x) * eased;
  out.y = POSES[i].y + (POSES[j].y - POSES[i].y) * eased;
}
export function copyOpacity(progress: number, index: number) {
  const distance = Math.abs(progress - index);
  return Math.max(0, Math.min(1, (0.55 - distance) / 0.3));
}

/** Fleet reveal is reversible and admits a stable prefix of sites. */
export function storyFleetCount(progress: number) {
  const t = Math.max(0, Math.min(1, (progress - 3.2) / 0.95));
  return Math.round(10 + 90 * t * t * (3 - 2 * t));
}
