/**
 * Domain model for the Exawatt roadmap convention (v1).
 *
 * The convention is published in `docs/product/reference/roadmap-convention.md`
 * (decision 0011): a repo-canonical markdown roadmap that Exawatt reads and
 * never writes. The parser is tolerant within the published grammar and
 * diagnostic-honest outside it — unrecognized structure becomes diagnostics,
 * never guessed items.
 */

/** Queue position of an item. Linear v1: now → next → later, plus history. */
export type RoadmapItemStatus = 'now' | 'next' | 'later' | 'shipped' | 'parked';

/** A location in the source roadmap file. */
export interface RoadmapSourceRef {
  /** Repo-relative file path. */
  file: string;
  /** 1-based line number. */
  line: number;
}

export interface RoadmapMilestone {
  /** Short id token like "D4", "S2", "M10"; null when the bullet has none. */
  id: string | null;
  title: string;
  done: boolean;
  /** Left the plan without landing — "(rescoped …)", "(retired …)", "(dropped …)", "(superseded …)", "(cut …)". Never both done and retired. */
  retired: boolean;
  source: RoadmapSourceRef;
}

export interface RoadmapItem {
  /** Declared id, or a synthetic slug prefixed with "~" when none exists. */
  id: string;
  /** Id as written in the heading ("ENG-017"); null for id-less items. */
  declaredId: string | null;
  title: string;
  status: RoadmapItemStatus;
  /** Orthogonal to queue position (`Status: blocked …`). */
  blocked: boolean;
  /** Document-order index across the whole roadmap. */
  ordinal: number;
  /** Free-form text after the status token on the `Status:` line. */
  statusNote: string | null;
  /** Prose and unlabeled bullets inside the item, in document order. */
  description: string[];
  scope: string[];
  exitCriteria: string[];
  milestones: RoadmapMilestone[];
  /** Paths from a `Project doc:` block, backticks stripped. */
  docPaths: string[];
  source: RoadmapSourceRef;
}

export interface RoadmapDiagnostic {
  level: 'info' | 'warn';
  message: string;
  source: RoadmapSourceRef;
}

/**
 * `declared` — frontmatter marker present; `detected` — no marker but the
 * structure parsed into at least one item; `none` — a roadmap file exists
 * but nothing in it matches the convention.
 */
export type RoadmapConformance = 'declared' | 'detected' | 'none';

export interface RoadmapDoc {
  projectDir: string;
  /** Repo-relative path of the parsed file. */
  file: string;
  convention: 'exawatt-v1';
  conformance: RoadmapConformance;
  items: RoadmapItem[];
  diagnostics: RoadmapDiagnostic[];
  /** Non-blank lines inside queue sections that no item could claim. */
  unparsedLineCount: number;
  parsedAt: number;
  /** Hash of the source text; lets consumers skip re-linking on no-op reads. */
  contentHash: string;
}

/** How a session↔item link was established. */
export type SessionLinkMethod = 'declared' | 'inferred';

export type SessionLinkConfidence = 'high' | 'medium' | 'low';

export interface SessionLinkEvidence {
  kind:
    | 'declared'
    | 'branch-name'
    | 'worktree-path'
    | 'session-title'
    | 'context-summary'
    | 'commit-message';
  /** Human-readable excerpt, e.g. `branch "eng-017-roadmap-rail"`. */
  excerpt: string;
}

export interface SessionLink {
  /** Live PTY session id. */
  sessionId: string;
  /** Durable workspace tab id, when known (survives resume). */
  tabId: string | null;
  projectDir: string;
  itemId: string;
  method: SessionLinkMethod;
  /** Declared links are always `high`. */
  confidence: SessionLinkConfidence;
  evidence: SessionLinkEvidence[];
  evaluatedAt: number;
}
