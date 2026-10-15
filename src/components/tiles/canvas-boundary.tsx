'use client';

import { Component, useSyncExternalStore, type ReactNode } from 'react';

/**
 * Catches a failure inside the canvas (a context that cannot be created, a
 * shader that will not compile) so it costs the page its picture and nothing
 * else: the story's type and controls stay, on the dark ground the canvas
 * would have covered. A class, because an error boundary has to be.
 */
class CanvasBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // keep the cause where a developer will look for it
    console.error('The story canvas could not draw:', error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

let webgl2: boolean | undefined;

/** Whether this browser can draw the story at all: one WebGL2 context, tried
 *  once and released. three.js reports a context it cannot create from its
 *  own async setup, where no boundary can catch it, so a browser with WebGL
 *  off must never mount the canvas (ENG-031 W15m). */
function canDraw(): boolean {
  if (webgl2 === undefined) {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      webgl2 = gl !== null;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}

const noChange = () => () => {};

/** The story's canvas, where the browser can draw it, inside the boundary.
 *  Without WebGL the story is its type on its dark ground. */
export function StoryCanvas({ children }: { children: ReactNode }) {
  const drawable = useSyncExternalStore(noChange, canDraw, () => false);
  return drawable ? <CanvasBoundary>{children}</CanvasBoundary> : null;
}
