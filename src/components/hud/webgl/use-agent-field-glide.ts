// No 'use client' directive: this hook is only imported by client components.

/**
 * Held-key camera GLIDE for the AgentField world.
 *
 * Arrows (pan), +/− (zoom) and Q/E (orbit) move continuously while held:
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
      if (dt > 0) apply(dt);
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
      pressed.delete(normalizeCameraKey(e.key));
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
