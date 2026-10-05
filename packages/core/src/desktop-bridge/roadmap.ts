/**
 * The roadmap lens's reads and its one narrow write boundary (ENG-017,
 * decision 0035). Reads stay raw: the renderer parses them with the core
 * roadmap parser (decision 0011).
 */

export type RoadmapReadResult =
  | {
      status: 'ok';
      file: string;
      text: string;
      mtimeMs: number;
      observationToken?: string;
    }
  | { status: 'none'; checked: string[]; observationToken?: string }
  | { status: 'error'; error: string };

/**
 * Per-Session git evidence for roadmap link inference (ENG-017 S3). Read-only
 * git queries scoped to the Session's cwd: each worktree carries its own
 * branch, which is the strongest inference signal.
 */
export interface RoadmapSessionEvidence {
  branch: string | null;
  worktreeDirname: string;
  commitSubjects: string[];
}

export interface RoadmapProjectChange {
  hash: string;
  subject: string;
  /** Unix epoch milliseconds. */
  committedAt: number;
}

/**
 * One ticket of the Project repository's delivery queue (ENG-022), as the
 * roadmap lens reads it (ENG-017 S16). Main reads `queue/<ticket>.json` under
 * the repository's common Git directory and never writes there.
 */
export interface RoadmapDeliveryTicket {
  id: string;
  number: number;
  status: 'queued' | 'integrating' | 'integrated' | 'failed';
  /** The real queue always records a branch (`agent:land` requires one).
   *  null only when the source did not record one, which the Demo tick's
   *  landings by unbranched fixture Agents are (ENG-027 W14): shown as
   *  absent, never invented. */
  branch: string | null;
  lane: string;
  /** Subject of the oldest commit in the ticket's range; the first commit
   *  names the owning roadmap item. null when git could not resolve it. */
  subject: string | null;
  /** Unix epoch milliseconds. */
  admittedAt: number;
  headAt: number | null;
  terminalAt: number | null;
  integratedSha: string | null;
  failureReason: string | null;
  /** The head is re-running its floor on a rebased tree: rebase-phase check
   *  events exist in the metrics tail that the ticket has not recorded yet. */
  checking: boolean;
  /** The head is held on the public-projection latch. */
  held: boolean;
}

/**
 * A landing whose floor is running before admission: check events in the
 * metrics tail name a candidate commit that has no ticket yet.
 */
export interface RoadmapDeliveryCandidate {
  candidateSha: string;
  subject: string | null;
  /** Newest check event, Unix epoch milliseconds. */
  at: number;
  checksPassed: number;
}

/**
 * The delivery queue as read for one Project. `unavailable` is the honest
 * answer when the repository has no readable queue: the lens shows no landing
 * state at all, never "nothing queued".
 */
export type RoadmapDeliveryRead =
  | { status: 'unavailable'; reason: string }
  | {
      status: 'ok';
      /** Unix epoch milliseconds of this read. */
      readAt: number;
      tickets: RoadmapDeliveryTicket[];
      candidates: RoadmapDeliveryCandidate[];
      /** Ticket files that did not parse; counted, never hidden. */
      unreadableTickets: number;
      /** Newest metrics event, or null when `metrics.jsonl` was unreadable
       *  (then no `checking` state can be derived). */
      metricsAt: number | null;
    };

/** What `roadmap:activity` resolves to: the repository's recent commits and
 *  its delivery queue, read together. */
export interface RoadmapProjectActivity {
  changes: RoadmapProjectChange[];
  landings: RoadmapDeliveryRead;
}

export type RoadmapWritableStatus = 'now' | 'next' | 'later' | 'parked';

export type RoadmapWriteAction =
  | { kind: 'set-status'; itemId: string; status: RoadmapWritableStatus }
  | { kind: 'move-item'; itemId: string; direction: 'up' | 'down' }
  | { kind: 'set-milestone'; itemId: string; line: number; done: boolean };

export interface RoadmapWriteRequest {
  projectDir: string;
  file: string;
  expectedContentHash: string;
  action: RoadmapWriteAction;
  /** One explicit confirmation for Projects whose launch policy is Ask first. */
  confirmed?: boolean;
}

/** The permission every roadmap write names, granted or refused. */
type RoadmapStateWritePermission = 'roadmap-state-write';

export type RoadmapWriteResult =
  | {
      status: 'applied';
      contentHash: string;
      undoToken: string;
      permission: RoadmapStateWritePermission;
    }
  | {
      status: 'permission-required' | 'refused' | 'failed';
      message: string;
      permission: RoadmapStateWritePermission;
    };

export type RoadmapUndoResult =
  | { status: 'applied'; contentHash: string }
  | { status: 'refused' | 'failed'; message: string };

/** Covered exact Sessions for main to evaluate against its current source evidence.
 * Missing Sessions mean unobserved, not resolved. */
export interface RoadmapAttentionObservation {
  projectDir: string;
  observationToken: string;
  sessions: Array<{
    sessionId: string;
    durableSessionId: string;
  }>;
}
