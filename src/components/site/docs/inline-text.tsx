import Link from 'next/link';
import type { InlineRun } from '@/lib/site-docs/site-docs.mjs';

/** A site document's inline runs: plain, bold, code and links. */
export function InlineText({ runs }: { runs: readonly InlineRun[] }) {
  return (
    <>
      {runs.map((run, index) => {
        let node = run.code ? (
          <code className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[0.875em] text-white/90">
            {run.text}
          </code>
        ) : (
          <>{run.text}</>
        );
        if (run.strong)
          node = <strong className="font-semibold text-white">{node}</strong>;
        if (run.href) {
          const className =
            'text-white underline decoration-white/30 underline-offset-4 hover:decoration-white';
          node = run.href.startsWith('/') ? (
            <Link href={run.href} className={className}>
              {node}
            </Link>
          ) : (
            <a href={run.href} className={className}>
              {node}
            </a>
          );
        }
        return <span key={index}>{node}</span>;
      })}
    </>
  );
}
