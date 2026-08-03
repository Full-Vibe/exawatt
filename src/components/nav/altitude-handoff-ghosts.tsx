'use client';

/**
 * Ghost layer for the Team → Fleet altitude handoff (ENG-004 V3.0).
 *
 * Rendered by the D11 transition owner while a handoff is in flight: one
 * pointer-events-none card ghost per captured Team card, plus a scrim that
 * smooths the Sessions backdrop into the board background. When the board
 * rig reports its entry pose, each matched ghost flies (FLIP transform) to
 * the screen rect its Project zone occupies under that pose and crossfades
 * out while the zone entrance fades in beneath — the card becomes the node.
 *
 * The fallback cut lives here too: if no pose arrives inside the frame
 * budget, or the rig declines, ghosts fade fast and the arrival is the
 * ordinary directional cut. A stalled main thread mid-crossfade finishes
 * the animation instantly. Falling back is a normal outcome.
 */

import { useEffect, useRef } from 'react';
import {
  ALTITUDE_HANDOFF_BUDGET_MS,
  ALTITUDE_HANDOFF_CROSSFADE_MS,
  ALTITUDE_HANDOFF_FALLBACK_EVENT,
  ALTITUDE_HANDOFF_POSE_EVENT,
  type HandoffPoseDetail,
  type HandoffSnapshot,
} from './altitude-handoff';

export type HandoffOutcome = 'pose' | 'fallback';

const FALLBACK_FADE_MS = 120;
/** A frame gap this large mid-crossfade means the budget is blown — finish
 *  the flight instantly rather than letting a janky tween play out. */
const STALL_GAP_MS = 250;

function supportsWaapi(element: HTMLElement): boolean {
  return typeof element.animate === 'function';
}

export function AltitudeHandoffGhosts({
  snapshot,
  onDone,
}: {
  snapshot: HandoffSnapshot;
  onDone: (outcome: HandoffOutcome) => void;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const scrim = useRef<HTMLDivElement | null>(null);
  const ghosts = useRef(new Map<string, HTMLDivElement>());
  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let deadline: number | null = null;
    let stallFrame: number | null = null;
    let fadingOut = false;
    const animations: Animation[] = [];

    const finish = (outcome: HandoffOutcome) => {
      if (done.current) return;
      done.current = true;
      if (deadline !== null) window.clearTimeout(deadline);
      if (stallFrame !== null) window.cancelAnimationFrame(stallFrame);
      onDoneRef.current(outcome);
    };

    const fadeOutAll = (durationMs: number, outcome: HandoffOutcome) => {
      if (done.current) return;
      fadingOut = true;
      const elements: HTMLElement[] = [
        ...(scrim.current ? [scrim.current] : []),
        ...ghosts.current.values(),
      ];
      let pendingCount = 0;
      for (const element of elements) {
        if (!supportsWaapi(element)) continue;
        pendingCount += 1;
        const animation = element.animate([{ opacity: 0 }], {
          duration: durationMs,
          easing: 'ease-out',
          fill: 'forwards',
        });
        animations.push(animation);
        animation.addEventListener('finish', () => {
          pendingCount -= 1;
          if (pendingCount === 0) finish(outcome);
        });
      }
      if (pendingCount === 0) finish(outcome); // jsdom / no WAAPI: snap
    };

    const onPose = (event: Event) => {
      // Decline a pose that lands after the deadline fade has begun: the
      // flight keyframes start at opacity 1, so accepting it would snap
      // half-faded ghosts back to full. The fallback path is already the
      // outcome — let it finish.
      if (done.current || fadingOut) return;
      if (deadline !== null) {
        window.clearTimeout(deadline);
        deadline = null;
      }
      const detail = (event as CustomEvent<HandoffPoseDetail>).detail;
      const targeted = new Set<string>();
      let pendingCount = 0;
      const settle = () => {
        pendingCount -= 1;
        if (pendingCount === 0) finish('pose');
      };
      for (const target of detail.targets) {
        const ghost = ghosts.current.get(target.key);
        if (!ghost || !supportsWaapi(ghost)) continue;
        targeted.add(target.key);
        const dx = target.to.left - target.from.left;
        const dy = target.to.top - target.from.top;
        const sx = target.to.width / Math.max(target.from.width, 1);
        const sy = target.to.height / Math.max(target.from.height, 1);
        pendingCount += 1;
        const flight = ghost.animate(
          [
            { transform: 'translate(0px, 0px) scale(1, 1)', opacity: 1 },
            {
              transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
              opacity: 0.55,
              offset: 0.62,
            },
            {
              transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
              opacity: 0,
            },
          ],
          {
            duration: detail.crossfadeMs,
            // In-out, gently front-weighted: the flight must SPEND its
            // duration traveling so the card is seen becoming the zone.
            easing: 'cubic-bezier(0.45, 0.05, 0.15, 1)',
            fill: 'forwards',
          }
        );
        animations.push(flight);
        flight.addEventListener('finish', settle);
      }
      // Cards without a node on the board simply fade — identity that does
      // not exist at the Fleet altitude is not invented.
      for (const [key, ghost] of ghosts.current) {
        if (targeted.has(key) || !supportsWaapi(ghost)) continue;
        pendingCount += 1;
        const fade = ghost.animate([{ opacity: 0 }], {
          duration: detail.crossfadeMs * 0.6,
          easing: 'ease-out',
          fill: 'forwards',
        });
        animations.push(fade);
        fade.addEventListener('finish', settle);
      }
      if (scrim.current && supportsWaapi(scrim.current)) {
        pendingCount += 1;
        const fade = scrim.current.animate([{ opacity: 0 }], {
          duration: detail.crossfadeMs,
          easing: 'ease-out',
          fill: 'forwards',
        });
        animations.push(fade);
        fade.addEventListener('finish', settle);
      }
      if (pendingCount === 0) {
        finish('pose');
        return;
      }
      // Missed-frame watchdog: a stalled main thread finishes the flight
      // instantly (a cut) instead of resuming a stale tween later.
      let last = performance.now();
      const watch = (now: number) => {
        if (done.current) return;
        if (now - last > STALL_GAP_MS) {
          for (const animation of animations) animation.finish();
          return;
        }
        last = now;
        stallFrame = window.requestAnimationFrame(watch);
      };
      stallFrame = window.requestAnimationFrame(watch);
    };

    const onFallback = () => fadeOutAll(FALLBACK_FADE_MS, 'fallback');

    window.addEventListener(ALTITUDE_HANDOFF_POSE_EVENT, onPose);
    window.addEventListener(ALTITUDE_HANDOFF_FALLBACK_EVENT, onFallback);
    const elapsed = performance.now() - snapshot.capturedAt;
    deadline = window.setTimeout(
      () => fadeOutAll(FALLBACK_FADE_MS, 'fallback'),
      Math.max(0, ALTITUDE_HANDOFF_BUDGET_MS - elapsed)
    );
    return () => {
      window.removeEventListener(ALTITUDE_HANDOFF_POSE_EVENT, onPose);
      window.removeEventListener(ALTITUDE_HANDOFF_FALLBACK_EVENT, onFallback);
      if (deadline !== null) window.clearTimeout(deadline);
      if (stallFrame !== null) window.cancelAnimationFrame(stallFrame);
      for (const animation of animations) animation.cancel();
    };
  }, [snapshot]);

  return (
    <div
      ref={root}
      data-altitude-handoff
      data-command-transition="handoff"
      data-command-transition-target="spatial"
      data-command-transition-direction="ascend"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[60]"
    >
      {/* Matches the Sessions overlay backdrop so the route swap does not
          flash; fades out with the crossfade. */}
      <div
        ref={scrim}
        data-altitude-handoff-scrim
        className="absolute inset-0"
        style={{
          background:
            'color-mix(in srgb, var(--exa-foundation-canvas) 70%, transparent)',
        }}
      />
      {snapshot.cards.map(card => (
        <div
          key={card.key}
          ref={node => {
            if (node) ghosts.current.set(card.key, node);
            else ghosts.current.delete(card.key);
          }}
          data-altitude-handoff-ghost={card.key}
          className="exa-material-overlay absolute overflow-hidden rounded border"
          style={{
            left: card.rect.left,
            top: card.rect.top,
            width: card.rect.width,
            height: card.rect.height,
            transformOrigin: 'top left',
            willChange: 'transform, opacity',
            borderColor: `${card.color}66`,
            boxShadow: `0 0 14px ${card.color}22`,
          }}
        >
          <span className="absolute left-2.5 top-2 flex items-center gap-2">
            <span
              className="h-3.5 w-[3px] shrink-0 rounded-full"
              style={{ background: card.color }}
            />
            <span className="truncate font-sans text-sm font-semibold text-[var(--exa-foundation-text)]">
              {card.label}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
