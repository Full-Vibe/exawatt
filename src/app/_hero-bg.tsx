'use client';

import Image from 'next/image';
import { useState, useCallback, useRef } from 'react';

const ALPHA_DELAY = 200;
const ALPHA_DURATION = 500;
const CONTRAST_DELAY = -300;
const CONTRAST_DURATION = 1150;
const START_CONTRAST = 600;

export function HeroBg() {
  const [opacity, setOpacity] = useState(0);
  const [contrast, setContrast] = useState(START_CONTRAST);
  const hasStarted = useRef(false);

  const onLoad = useCallback(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    setTimeout(() => {
      setOpacity(1);

      // Negative delay = overlap with alpha fade
      const contrastStart = Math.max(0, ALPHA_DURATION + CONTRAST_DELAY);
      setTimeout(() => {
        setContrast(100);
      }, contrastStart);
    }, ALPHA_DELAY);
  }, []);

  return (
    <Image
      src="/images/hero-bg.png"
      alt=""
      fill
      className="object-cover"
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
    />
  );
}
