import type { Guide } from '@/lib/guides/guides';
import { CopyButton } from './copy-button';
import { InlineText } from './inline-text';

type DocBlock = Guide['blocks'][number];

function CodeBlock({ block }: { block: Extract<DocBlock, { kind: 'code' }> }) {
  if (block.lang === 'prompt') {
    // Prose to paste: it reflows on the page and copies as written.
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-white/12 bg-white/[0.04] px-5 py-4 sm:flex-row sm:items-start sm:gap-4">
        <div className="min-w-0 flex-1 space-y-3 text-[1.0625rem] leading-relaxed text-white/90">
          {block.text.split('\n\n').map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
        <div className="self-end sm:self-start">
          <CopyButton text={block.text} />
        </div>
      </div>
    );
  }
  // The command scrolls inside its own column, so it never runs under Copy.
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] py-4 pl-5 pr-4">
      <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-sm leading-relaxed text-white/85">
        <code>{block.text}</code>
      </pre>
      {block.lang === 'sh' && <CopyButton text={block.text} />}
    </div>
  );
}

/** A site document's body, block by block. */
export function DocBlocks({ blocks }: { blocks: readonly DocBlock[] }) {
  return (
    <div className="space-y-5 text-[1.0625rem] leading-relaxed text-white/80">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return block.level === 2 ? (
              <h2
                key={index}
                className="pt-6 text-[1.375rem] font-semibold leading-snug tracking-tight text-white"
              >
                <InlineText runs={block.runs} />
              </h2>
            ) : (
              <h3
                key={index}
                className="pt-2 text-[1.0625rem] font-semibold text-white"
              >
                <InlineText runs={block.runs} />
              </h3>
            );
          case 'paragraph':
            return (
              <p key={index}>
                <InlineText runs={block.runs} />
              </p>
            );
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul';
            return (
              <List key={index} className="space-y-2.5">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="relative pl-6">
                    {block.ordered ? (
                      <span
                        aria-hidden
                        className="absolute left-0 tabular-nums text-white/45"
                      >
                        {itemIndex + 1}.
                      </span>
                    ) : (
                      <span
                        aria-hidden
                        className="absolute left-1 top-[0.7em] h-1 w-1 rounded-full bg-white/40"
                      />
                    )}
                    <InlineText runs={item} />
                  </li>
                ))}
              </List>
            );
          }
          case 'code':
            return <CodeBlock key={index} block={block} />;
        }
      })}
    </div>
  );
}
