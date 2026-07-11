import type {
  RoadmapDoc,
  RoadmapItem,
  SessionLink,
  SessionLinkConfidence,
  SessionLinkEvidence,
} from './types';

/**
 * Session→item inference (ENG-017 S3). Closed-vocabulary by design: only
 * ids/titles already present in the parsed roadmap can match, so injected
 * text in AI-generated summaries can at worst mislink a badge — it can
 * never invent an item. Ambiguity yields NO link (the session stays
 * visibly unmapped); precedence is declared > branch/worktree (high) >
 * title/context/commit id (medium) > normalized-title containment (low).
 */
export interface SessionLinkCandidate {
  sessionId: string;
  tabId: string | null;
  projectDir: string;
  title: string;
  contextSummary: string | null;
  cwd: string;
  branch: string | null;
  /** basename of the session cwd when it differs from the project root */
  worktreeDirname: string | null;
  commitSubjects: string[];
}

/** id present with boundaries: "eng-017" must not match inside "eng-0170" */
function containsId(text: string, idLower: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(idLower, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : text[at - 1];
    const after = text[at + idLower.length] ?? '';
    if (!/[a-z0-9]/.test(before) && !/[0-9]/.test(after)) return true;
    from = at + 1;
  }
}

function normalizeTitle(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface Match {
  item: RoadmapItem;
  confidence: SessionLinkConfidence;
  evidence: SessionLinkEvidence[];
}

const CONFIDENCE_RANK: Record<SessionLinkConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function matchCandidate(item: RoadmapItem, candidate: SessionLinkCandidate): Match | null {
  const evidence: SessionLinkEvidence[] = [];
  const idLower = item.declaredId?.toLowerCase() ?? null;

  if (idLower) {
    if (candidate.branch && containsId(candidate.branch.toLowerCase(), idLower)) {
      evidence.push({ kind: 'branch-name', excerpt: `branch "${candidate.branch}"` });
    }
    if (
      candidate.worktreeDirname &&
      containsId(candidate.worktreeDirname.toLowerCase(), idLower)
    ) {
      evidence.push({
        kind: 'worktree-path',
        excerpt: `worktree "${candidate.worktreeDirname}"`,
      });
    }
    if (containsId(candidate.title.toLowerCase(), idLower)) {
      evidence.push({ kind: 'session-title', excerpt: `title "${candidate.title}"` });
    }
    if (
      candidate.contextSummary &&
      containsId(candidate.contextSummary.toLowerCase(), idLower)
    ) {
      evidence.push({
        kind: 'context-summary',
        excerpt: `${item.declaredId} in the session context`,
      });
    }
    const subject = candidate.commitSubjects.find(s =>
      containsId(s.toLowerCase(), idLower)
    );
    if (subject) {
      evidence.push({ kind: 'commit-message', excerpt: `commit "${subject.slice(0, 72)}"` });
    }
  }

  // last resort: the item's normalized title inside the session title
  let fuzzyOnly = false;
  const itemTitle = normalizeTitle(item.title);
  if (
    evidence.length === 0 &&
    itemTitle.length >= 8 &&
    normalizeTitle(candidate.title).includes(itemTitle)
  ) {
    evidence.push({ kind: 'session-title', excerpt: `title matches "${item.title}"` });
    fuzzyOnly = true;
  }

  if (evidence.length === 0) return null;
  const confidence: SessionLinkConfidence = evidence.some(
    e => e.kind === 'branch-name' || e.kind === 'worktree-path'
  )
    ? 'high'
    : fuzzyOnly
      ? 'low'
      : 'medium';
  return { item, confidence, evidence };
}

export function inferSessionLinks(
  doc: RoadmapDoc,
  candidates: SessionLinkCandidate[],
  now: () => number = Date.now
): SessionLink[] {
  const links: SessionLink[] = [];
  for (const candidate of candidates) {
    const matches = doc.items
      .map(item => matchCandidate(item, candidate))
      .filter((m): m is Match => m !== null);
    if (matches.length === 0) continue;
    const best = Math.max(...matches.map(m => CONFIDENCE_RANK[m.confidence]));
    const top = matches.filter(m => CONFIDENCE_RANK[m.confidence] === best);
    // two items matching equally well = ambiguous = visibly unmapped
    if (top.length !== 1) continue;
    const { item, confidence, evidence } = top[0];
    links.push({
      sessionId: candidate.sessionId,
      tabId: candidate.tabId,
      projectDir: candidate.projectDir,
      itemId: item.id,
      method: 'inferred',
      confidence,
      evidence,
      evaluatedAt: now(),
    });
  }
  return links;
}
