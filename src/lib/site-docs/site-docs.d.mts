/** Which inline marks a kind of document renders. */
type InlineMark = 'strong' | 'code' | 'link';

/** One run of inline text; `code` and `href` are set only when they apply. */
export interface InlineRun {
  readonly text: string;
  readonly strong: boolean;
  readonly code?: true;
  readonly href?: string;
}

export interface InlineOptions {
  marks?: readonly InlineMark[];
  /** Resolves a link's href, or throws to refuse it. */
  link?: (href: string) => string;
  label?: string;
  source?: string;
}

type SiteDocBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; lang: 'sh' | 'text' | 'prompt'; text: string };

export declare class SiteDocError extends Error {
  constructor(label: string, source: string, message: string);
}

export declare function refuseEmDash(
  text: string,
  where: { label: string; source: string }
): void;
export declare function readFrontMatter(
  text: string,
  options: { label: string; source: string; keys: readonly string[] }
): { front: Record<string, string>; body: string[] };
export declare function inlineRuns(
  text: string,
  options?: InlineOptions
): InlineRun[];
export declare function parseBlocks(
  lines: readonly string[],
  options: InlineOptions & { label: string; source: string }
): SiteDocBlock[];
