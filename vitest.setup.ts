import '@testing-library/jest-dom/vitest';

/**
 * Every jsdom test that persists anything reads jsdom's Storage. When a Node
 * global shadows it (BUG-229: Node 25+ Web Storage, `undefined` without
 * `--localstorage-file`), say so once here instead of failing each test on
 * `Cannot read properties of undefined (reading 'clear')`.
 */
if (
  typeof window.localStorage === 'undefined' ||
  !(window.localStorage instanceof window.Storage)
) {
  throw new Error(
    `The jsdom test environment has no jsdom localStorage: Node ${process.version} ` +
      'is exposing its own Web Storage global over it. Run the app-dom project with ' +
      '`--no-experimental-webstorage` (see vitest.config.app-dom.ts, BUG-229).'
  );
}

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
