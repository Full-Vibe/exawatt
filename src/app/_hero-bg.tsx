'use client';

import Image from 'next/image';
import { useState, useCallback, useEffect, useRef } from 'react';

const ALPHA_DELAY = 200;
const ALPHA_DURATION = 500;
const CONTRAST_DELAY = -300;
const CONTRAST_DURATION = 1150;
const START_CONTRAST = 600;

export function HeroBg({
  onFadeInComplete,
  reducedMotion = false,
}: {
  onFadeInComplete?: () => void;
  reducedMotion?: boolean;
}) {
  const [opacity, setOpacity] = useState(0);
  const [contrast, setContrast] = useState(START_CONTRAST);
  const hasStarted = useRef(false);
  const hasCompleted = useRef(false);
  const alphaTimer = useRef<number | null>(null);
  const contrastTimer = useRef<number | null>(null);
  const completionTimer = useRef<number | null>(null);

  const completeFade = useCallback(() => {
    if (hasCompleted.current) return;
    hasCompleted.current = true;
    onFadeInComplete?.();
  }, [onFadeInComplete]);

  useEffect(
    () => () => {
      if (alphaTimer.current !== null) window.clearTimeout(alphaTimer.current);
      if (contrastTimer.current !== null) {
        window.clearTimeout(contrastTimer.current);
      }
      if (completionTimer.current !== null) {
        window.clearTimeout(completionTimer.current);
      }
    },
    []
  );

  const onLoad = useCallback(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    if (reducedMotion) {
      setOpacity(1);
      setContrast(100);
      completeFade();
      return;
    }

    alphaTimer.current = window.setTimeout(() => {
      setOpacity(1);

      // Negative delay = overlap with alpha fade
      const contrastStart = Math.max(0, ALPHA_DURATION + CONTRAST_DELAY);
      contrastTimer.current = window.setTimeout(() => {
        setContrast(100);
      }, contrastStart);

      // Transition events can be suppressed by browser lifecycle changes. Keep
      // the command-key choreography deterministic with a bounded fallback.
      completionTimer.current = window.setTimeout(
        completeFade,
        ALPHA_DURATION + 100
      );
    }, ALPHA_DELAY);
  }, [completeFade, reducedMotion]);

  return (
    <Image
      src="/images/hero-bg.png"
      alt=""
      fill
      className="object-cover"
      data-fade-state={opacity === 1 ? 'visible' : 'hidden'}
      data-home-hero-background
      style={{
        opacity,
        filter: `contrast(${contrast}%)`,
        transition: [
          `opacity ${ALPHA_DURATION}ms ease-out`,
          `filter ${CONTRAST_DURATION}ms cubic-bezier(0.16, 1, 0.3, 1)`,
        ].join(', '),
      }}
      priority
      onLoad={onLoad}
      onTransitionEnd={event => {
        if (event.propertyName === 'opacity') completeFade();
      }}
    />
  );
}
