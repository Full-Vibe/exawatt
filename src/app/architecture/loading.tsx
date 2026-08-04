export default function ArchitectureLoading() {
  return (
    <div
      className="flex h-[calc(100svh-3rem)] items-center justify-center bg-[var(--exa-public-exhibition-canvas)] text-neutral-400"
      data-architecture-loading
      data-public-exhibition-surface="true"
      role="status"
      aria-label="Loading architecture"
    >
      <p className="font-mono text-xs">Loading architecture…</p>
    </div>
  );
}
