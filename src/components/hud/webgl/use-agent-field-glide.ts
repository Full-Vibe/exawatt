// No 'use client' directive: this hook is only imported by client components.

/**
 * Held-key camera GLIDE for the AgentField world.
 *
 * Arrows (pan), +/− (zoom) and Q/E (orbit) move continuously while held:
 * a rAF loop feeds small instant `nudge`s through the camera's own damping,
 * so motion is fluid instead of the stuttery hop-per-keydown of key repeat.
 * A quick TAP still lands a discrete kick so single presses feel responsive.
 *
 * Installs window listeners; skips typing contexts and modifier chords.
 * Callers must NOT also handle these keys (double-handling doubles speed).
 */
import { useEffect } from 'react';
import type { AgentFieldHandle } from './agent-field';

const PAN_SPEED = 0.75; // field-radius fractions per second
const DOLLY_SPEED = 1.5; // dolly steps per second
const ORBIT_SPEED = 1.2; // radians per second
const TAP_KICK = 0.12; // seconds of motion applied instantly on a fresh press

type Vec = { dx: number; dy: number; dolly: number; az: number };

/** normalized key -> unit direction */
function keyVec(key: string): Vec | null {
  switch (key) {
    case 'arrowleft':
      return { dx: -1, dy: 0, dolly: 0, az: 0 };
    case 'arrowright':
      return { dx: 1, dy: 0, dolly: 0, az: 0 };
    // vertical is inverted vs the raw truck axis — operator-confirmed feel:
    // ArrowUp brings the upper part of the map INTO view
    case 'arrowup':
      return { dx: 0, dy: -1, dolly: 0, az: 0 };
    case 'arrowdown':
      return { dx: 0, dy: 1, dolly: 0, az: 0 };
    case '+':
    case '=':
      return { dx: 0, dy: 0, dolly: 1, az: 0 };
    case '-':
    case '_':
      return { dx: 0, dy: 0, dolly: -1, az: 0 };
    case 'q':
      return { dx: 0, dy: 0, dolly: 0, az: 1 };
    case 'e':
      return { dx: 0, dy: 0, dolly: 0, az: -1 };
    default:
      return null;
  }
}

function normalize(key: string): string {
  return key.toLowerCase();
}

export function useAgentFieldGlide(controller: {
  current: AgentFieldHandle | null;
}) {
  useEffect(() => {
    const pressed = new Set<string>();
    let raf: number | null = null;
    let lastT = 0;

    const apply = (v: Vec, dt: number) => {
      controller.current?.nudge(
        v.dx * dt * PAN_SPEED,
        v.dy * dt * PAN_SPEED,
        v.dolly * dt * DOLLY_SPEED,
        v.az * dt * ORBIT_SPEED
      );
    };

    const combined = (): Vec => {
      const v: Vec = { dx: 0, dy: 0, dolly: 0, az: 0 };
      for (const k of pressed) {
        const kv = keyVec(k);
        if (!kv) continue;
        v.dx += kv.dx;
        v.dy += kv.dy;
        v.dolly += kv.dolly;
        v.az += kv.az;
      }
      return v;
    };

    const step = (t: number) => {
      if (pressed.size === 0 || !controller.current) {
        raf = null;
        return;
      }
      const dt = Math.min((t - lastT) / 1000, 0.05);
      lastT = t;
      apply(combined(), dt);
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
      const key = normalize(e.key);
      const v = keyVec(key);
      if (!v) return;
      e.preventDefault();
      if (!e.repeat && !pressed.has(key)) apply(v, TAP_KICK); // tap = kick
      pressed.add(key);
      start();
    };
    const onUp = (e: KeyboardEvent) => {
      pressed.delete(normalize(e.key));
    };
    const clear = () => pressed.clear();

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
