import '@testing-library/jest-dom/vitest';

/**
 * jsdom has no `IntersectionObserver`, and every surface that pauses work when
 * it scrolls out of view uses one. A component test that renders such a
 * surface would otherwise fail on the environment rather than on the
 * behaviour it is asserting.
 *
 * The stub observes nothing and reports nothing on purpose: a test that cares
 * about intersection behaviour should drive the callback itself rather than
 * inherit a fake that guesses at visibility.
 */
if (!('IntersectionObserver' in globalThis)) {
  class NoopIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    constructor(
      _callback: IntersectionObserverCallback,
      _options?: IntersectionObserverInit
    ) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    writable: true,
    configurable: true,
    value: NoopIntersectionObserver,
  });
}
