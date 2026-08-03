// Root pending state for route transitions. Dynamic routes re-render on the
// local server during navigation; this keeps the transition visibly alive
// instead of painting a bare dark frame (ENG-016 D18).
export default function RootLoading() {
  return (
    <div
      className="flex h-[calc(100svh-3rem)] items-center justify-center bg-[var(--exa-foundation-canvas)]"
      role="status"
      aria-label="Loading"
    >
      <p className="animate-pulse font-mono text-xs text-[var(--exa-foundation-text-muted)]">
        Loading…
      </p>
    </div>
  );
}
