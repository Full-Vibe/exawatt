'use client';

import { Component, type ReactNode } from 'react';

/**
 * Catches a failure inside the canvas (no WebGL, a context that cannot be
 * created, a shader that will not compile) so it costs the page its picture
 * and nothing else: the story's type and controls stay, on the dark ground
 * the canvas would have covered. A class, because an error boundary has to be.
 */
export class CanvasBoundary extends Component<
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
