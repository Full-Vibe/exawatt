// No 'use client' directive: this hook is only imported by client components.

/**
 * Held-key camera GLIDE for the AgentField world.
 *
 * WASD (pan), +/− (zoom) and Q/E (orbit) move continuously while held.
 * Arrow keys belong exclusively to spatial Agent selection:
 * a rAF loop damps velocity toward the pressed-key target and decays after
 * release, so movement has one coherent acceleration/deceleration model.
 *
 * Installs window listeners; skips typing contexts and modifier chords.
 * Callers must NOT also handle these keys (double-handling doubles speed).
 */
import { useEffect } from 'react';
import {
  composeCameraTarget,
  createCameraVelocity,
  isCameraKey,
  normalizeCameraKey,
  stepCameraVelocity,
} from './agent-field-motion';

export interface CameraGlideHandle {
  nudge(dx: number, dy: number, dollySteps: number, orbitRadians: number): void;
}

export function useAgentFieldGlide(controller: {
  current: CameraGlideHandle | null;
}) {
  useEffect(() => {
    const pressed = new Set<string>();
    const velocity = createCameraVelocity();
    const target = createCameraVelocity();
    let raf: number | null = null;
    let lastT = 0;
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const apply = (dt: number) => {
      controller.current?.nudge(
        velocity.panX * dt,
        velocity.panY * dt,
        velocity.dolly * dt,
        velocity.orbit * dt
      );
    };

    const step = (t: number) => {
      if (!controller.current) {
        if (pressed.size > 0) raf = requestAnimationFrame(step);
        else raf = null;
        lastT = t;
        return;
      }
      const dt = Math.min(Math.max((t - lastT) / 1000, 0), 0.05);
      lastT = t;
      composeCameraTarget(pressed, target);
      const settling = stepCameraVelocity(
        velocity,
        target,
        dt,
        reducedQuery.matches
      );
      // A glide with nothing moving is not a camera input. Nudging the camera
      // by zero still told it the operator had taken the wheel -- it dropped
      // any semantic flight into damp mode, re-clamped the target, and
      // suspended follow -- so every keystroke on the board, camera key or
      // not, ended in a stray camera move.
      const moving =
        velocity.panX !== 0 ||
        velocity.panY !== 0 ||
        velocity.dolly !== 0 ||
        velocity.orbit !== 0;
      if (dt > 0 && moving) apply(dt);
      if (pressed.size === 0 && !settling) {
        raf = null;
        return;
      }
      raf = requestAnimationFrame(step);
    };

    const start = () => {
      if (raf == null) {
        lastT = performance.now();
        raf = requestAnimationFrame(step);
      }
    };

    const onDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      )
        return;
      const key = normalizeCameraKey(e.key);
      if (!isCameraKey(key)) return;
      e.preventDefault();
      pressed.add(key);
      start();
    };
    const onUp = (e: KeyboardEvent) => {
      // Only a key this glide is holding can release it. Releasing on every
      // keyup started a settle step for keys the glide never saw.
      const key = normalizeCameraKey(e.key);
      if (!pressed.delete(key)) return;
      start();
    };
    const clear = () => {
      pressed.clear();
      start();
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', clear);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [controller]);
}
