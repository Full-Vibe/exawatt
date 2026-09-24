/**
 * The roadmap lens's reads and its one narrow write boundary (ENG-017,
 * decision 0035). Reads stay raw: the renderer parses them with the core
 * roadmap parser (decision 0011).
 */

export type RoadmapReadResult =
  | { status: 'ok'; file: string; text: string; mtimeMs: number }
  | { status: 'none'; checked: string[] }
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
