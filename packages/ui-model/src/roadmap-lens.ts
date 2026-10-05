import type {
  RoadmapConformance,
  RoadmapBacklogMetadata,
  RoadmapDoc,
  RoadmapItemStatus,
  RoadmapMilestone,
  SessionLink,
  SessionLinkConfidence,
  SessionLinkEvidence,
  SessionLinkMethod,
} from '@exawatt/core';
import type {
  RoadmapDeliveryCandidate,
  RoadmapDeliveryRead,
  RoadmapDeliveryTicket,
} from '@exawatt/core/desktop-bridge';

/**
 * Roadmap lens view model (ENG-017). Pure and geometry-free: the workspace
 * DOM rail is the first consumer; a horizontal strip or spatial expression
 * consumes the same model unchanged (same shared-resolver philosophy as
 * `selectFleetSpatialScene`).
 */

/** What the lens needs to know about a live session to render a chip. */
export interface RoadmapLensSessionInput {
  sessionId: string;
  /** Durable workspace tab id when known. */
  tabId: string | null;
  title: string;
  harness: string;
  needsAttention: boolean;
  /** Main-process PTY start time; null for fixture or unavailable sources. */
  startedAt: number | null;
  turnState: 'working' | 'waiting' | 'needs-you';
}

export interface RoadmapSessionChip {
  sessionId: string;
  tabId: string | null;
  title: string;
  harness: string;
  needsAttention: boolean;
  startedAt: number | null;
  turnState: RoadmapLensSessionInput['turnState'];
  method: SessionLinkMethod;
  confidence: SessionLinkConfidence;
  evidence: SessionLinkEvidence[];
}

/** Normal-case pill vocabulary; `now` displays as `active`. */
export type RoadmapDisplayStatus =
  | 'active'
  | 'next'
  | 'later'
  | 'backlog'
  | 'shipped'
  | 'parked';

export interface RoadmapRecentChange {
  hash: string;
  subject: string;
  committedAt: number;
}

/**
 * Landing state on an item (S16): where the ticket that names this item is in
 * the Project repository's delivery queue. `checking` before admission is a
 * floor running on a candidate commit; `checking` at the head is the floor
 * running again on a rebased tree.
 */
export type RoadmapLandingState =
  | 'checking'
  | 'queued'
  | 'integrating'
  | 'landed'
  | 'failed';

export interface RoadmapItemLanding {
  state: RoadmapLandingState;
  /** 1-based place in the queue for queued and integrating; the head is 1. */
  position: number | null;
  /** Short integrated sha once landed. */
  shortSha: string | null;
  /** null for a pre-admission candidate, which has no ticket yet. */
  ticketNumber: number | null;
  branch: string | null;
  subject: string | null;
  /** When this state began, Unix epoch milliseconds. */
  at: number;
  /** The landing's own failure reason, when it failed. */
  reason: string | null;
}

/** The queue as one header line: how many wait, who is at the head, and the
 *  last thing that reached master. null when the queue is not readable, which
 *  the lens renders as nothing at all, never as an empty queue. */
export interface RoadmapLensLandings {
  /** Tickets queued or integrating. */
  inQueue: number;
  /** Pre-admission floors running. */
  checking: number;
  head: {
    ticketNumber: number;
    declaredId: string | null;
    state: RoadmapLandingState;
  } | null;
  /** In-flight tickets and candidates whose subject names no item. */
  unmatched: number;
  lastLanded: {
    shortSha: string;
    at: number;
    declaredId: string | null;
  } | null;
  unreadableTickets: number;
  /** When the queue was read. */
  readAt: number;
}

/** How long a landed or failed ticket stays on its item. */
export const RECENT_LANDING_MS = 2 * 60 * 60_000;

export interface RoadmapItemView {
  id: string;
  declaredId: string | null;
  title: string;
  /** Physical queue section; differs from status when a Status line overrides it. */
  sectionStatus: RoadmapItemStatus;
  status: RoadmapItemStatus;
  displayStatus: RoadmapDisplayStatus;
  blocked: boolean;
  /** The single active station — first item in the now group. */
  isNowStation: boolean;
  statusNote: string | null;
  backlog: RoadmapBacklogMetadata | null;
  description: string[];
  scope: string[];
  exitCriteria: string[];
  milestones: RoadmapMilestone[];
  milestonesDone: number;
  /** Countable milestones — retired ones are excluded from progress fractions. */
  milestonesTotal: number;
  docPaths: string[];
  sourceLine: number;
  /** Parser warnings anchored inside this item's line range. */
  hasWarnings: boolean;
  /** The declared id resolves to exactly one source block. */
  hasUniqueDeclaredId: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  chips: RoadmapSessionChip[];
  recentChanges: RoadmapRecentChange[];
  landing: RoadmapItemLanding | null;
}

export interface RoadmapLensTrust {
  file: string;
  contentHash: string;
  convention: RoadmapDoc['convention'];
  conformance: RoadmapConformance;
  itemCount: number;
  warningCount: number;
  unparsedLineCount: number;
  diagnostics: string[];
}

export type RoadmapLensStatus = 'loading' | 'ok' | 'none' | 'error';

export interface RoadmapLensView {
  status: RoadmapLensStatus;
  /** Discovery paths that were checked (status 'none'). */
  checkedPaths: string[];
  error: string | null;
  file: string | null;
  mtimeMs: number | null;
  /** All queue-status now items; the first is the hero station. */
  now: RoadmapItemView[];
  next: RoadmapItemView[];
  later: RoadmapItemView[];
  backlog: RoadmapItemView[];
  shipped: RoadmapItemView[];
  parked: RoadmapItemView[];
  /** No unfinished work anywhere — the designed "no food" moment. */
  queueEmpty: boolean;
  /** Live sessions with no link to any item; visible, never guessed. */
  unmappedSessions: RoadmapLensSessionInput[];
  trust: RoadmapLensTrust | null;
  landings: RoadmapLensLandings | null;
}

export type RoadmapLensRead =
  | { status: 'loading' }
  | { status: 'none'; checked: string[] }
  | { status: 'error'; error: string }
  | { status: 'ok'; doc: RoadmapDoc; mtimeMs: number };

export interface RoadmapLensInput {
  read: RoadmapLensRead;
  sessions?: RoadmapLensSessionInput[];
  /** Session→item links, declared and inferred, already merged (S3/S4). */
  links?: SessionLink[];
  recentChanges?: RoadmapRecentChange[];
  /** The Project repository's delivery queue (S16); absent or unavailable
   *  means the lens shows no landing state. */
  landings?: RoadmapDeliveryRead | null;
}

const DISPLAY_STATUS: Record<RoadmapItemStatus, RoadmapDisplayStatus> = {
  now: 'active',
  next: 'next',
  later: 'later',
  backlog: 'backlog',
  shipped: 'shipped',
  parked: 'parked',
};

function emptyView(status: RoadmapLensStatus): RoadmapLensView {
  return {
    status,
    checkedPaths: [],
    error: null,
    file: null,
    mtimeMs: null,
    now: [],
    next: [],
    later: [],
    backlog: [],
    shipped: [],
    parked: [],
    queueEmpty: false,
    unmappedSessions: [],
    trust: null,
    landings: null,
  };
}

/** The reciprocal lookup: which item is this workspace tab executing? */
export function findRoadmapSessionChip(
  view: RoadmapLensView,
  tabId: string
): { item: RoadmapItemView; chip: RoadmapSessionChip } | null {
  for (const group of [
    view.now,
    view.next,
    view.later,
    view.backlog,
    view.shipped,
    view.parked,
  ]) {
    for (const item of group) {
      const chip = item.chips.find(c => c.tabId === tabId);
      if (chip) return { item, chip };
    }
  }
  return null;
}

export function buildRoadmapLens(input: RoadmapLensInput): RoadmapLensView {
  const {
    read,
    sessions = [],
    links = [],
    recentChanges = [],
    landings = null,
  } = input;
  if (read.status === 'loading') return emptyView('loading');
  if (read.status === 'none') {
    return {
      ...emptyView('none'),
      checkedPaths: read.checked,
      unmappedSessions: sessions,
    };
  }
  if (read.status === 'error') {
    return {
      ...emptyView('error'),
      error: read.error,
      unmappedSessions: sessions,
    };
  }

  const { doc } = read;
  const linkBySession = new Map<string, SessionLink>();
  for (const link of links) {
    if (!linkBySession.has(link.sessionId))
      linkBySession.set(link.sessionId, link);
  }

  const chipsByItem = new Map<string, RoadmapSessionChip[]>();
  const unmappedSessions: RoadmapLensSessionInput[] = [];
  const itemIds = new Set(doc.items.map(item => item.id));
  for (const session of sessions) {
    const link = linkBySession.get(session.sessionId);
    if (!link || !itemIds.has(link.itemId)) {
      unmappedSessions.push(session);
      continue;
    }
    const chip: RoadmapSessionChip = {
      sessionId: session.sessionId,
      tabId: session.tabId,
      title: session.title,
      harness: session.harness,
      needsAttention: session.needsAttention,
      startedAt: session.startedAt,
      turnState: session.turnState,
      method: link.method,
      confidence: link.confidence,
      evidence: link.evidence,
    };
    const chips = chipsByItem.get(link.itemId);
    if (chips) chips.push(chip);
    else chipsByItem.set(link.itemId, [chip]);
  }

  // Bucket parser warnings into item line ranges so the rail can badge the
  // exact item whose source the parser struggled with.
  const sorted = [...doc.items].sort((a, b) => a.source.line - b.source.line);
  const warnLines = doc.diagnostics
    .filter(d => d.level === 'warn')
    .map(d => d.source.line);
  const itemHasWarning = new Set<string>();
  for (const line of warnLines) {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (line >= sorted[i].source.line) {
        const next = sorted[i + 1];
        if (!next || line < next.source.line) itemHasWarning.add(sorted[i].id);
        break;
      }
    }
  }

  const changesFor = (declaredId: string | null): RoadmapRecentChange[] => {
    if (!declaredId) return [];
    const boundary = idBoundary(declaredId);
    return recentChanges
      .filter(change => boundary.test(change.subject))
      .slice(0, 3);
  };

  const declaredIdCounts = new Map<string, number>();
  for (const item of doc.items) {
    if (item.declaredId) {
      declaredIdCounts.set(
        item.declaredId,
        (declaredIdCounts.get(item.declaredId) ?? 0) + 1
      );
    }
  }

  const views = doc.items.map<RoadmapItemView>(item => ({
    id: item.id,
    declaredId: item.declaredId,
    title: item.title,
    sectionStatus: item.sectionStatus,
    status: item.status,
    displayStatus: DISPLAY_STATUS[item.status],
    blocked: item.blocked,
    isNowStation: false,
    statusNote: item.statusNote,
    backlog: item.backlog,
    description: item.description,
    scope: item.scope,
    exitCriteria: item.exitCriteria,
    milestones: item.milestones,
    milestonesDone: item.milestones.filter(m => m.done).length,
    milestonesTotal: item.milestones.filter(m => !m.retired).length,
    docPaths: item.docPaths,
    sourceLine: item.source.line,
    hasWarnings: itemHasWarning.has(item.id),
    hasUniqueDeclaredId:
      item.declaredId !== null && declaredIdCounts.get(item.declaredId) === 1,
    canMoveUp: false,
    canMoveDown: false,
    chips: chipsByItem.get(item.id) ?? [],
    recentChanges: changesFor(item.declaredId),
    landing: null,
  }));

  const reorderableStatuses = new Set<RoadmapItemStatus>([
    'now',
    'next',
    'later',
    'backlog',
    'parked',
  ]);
  const canSwap = (
    item: RoadmapItemView,
    neighbor: RoadmapItemView | undefined
  ) =>
    Boolean(
      neighbor &&
      item.hasUniqueDeclaredId &&
      reorderableStatuses.has(item.status) &&
      item.status === item.sectionStatus &&
      neighbor.status === item.status &&
      neighbor.sectionStatus === item.sectionStatus
    );
  for (let index = 0; index < views.length; index++) {
    views[index].canMoveUp = canSwap(views[index], views[index - 1]);
    views[index].canMoveDown = canSwap(views[index], views[index + 1]);
  }

  const lensLandings = projectLandings(landings, views);

  const byStatus = (status: RoadmapItemStatus) =>
    views.filter(v => v.status === status);
  const now = byStatus('now');
  if (now.length > 0) now[0].isNowStation = true;

  return {
    status: 'ok',
    checkedPaths: [],
    error: null,
    file: doc.file,
    mtimeMs: read.mtimeMs,
    now,
    next: byStatus('next'),
    later: byStatus('later'),
    backlog: byStatus('backlog'),
    shipped: byStatus('shipped'),
    parked: byStatus('parked'),
    queueEmpty:
      now.length === 0 &&
      byStatus('next').length === 0 &&
      byStatus('later').length === 0,
    unmappedSessions,
    trust: {
      file: doc.file,
      contentHash: doc.contentHash,
      convention: doc.convention,
      conformance: doc.conformance,
      itemCount: doc.items.length,
      warningCount: warnLines.length,
      unparsedLineCount: doc.unparsedLineCount,
      diagnostics: doc.diagnostics.map(diagnostic => diagnostic.message),
    },
    landings: lensLandings,
  };
}

/** An item id matched as a whole token: `ENG-01` never matches `ENG-017`. */
function idBoundary(declaredId: string): RegExp {
  const escaped = declaredId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Z0-9])${escaped}(?![A-Z0-9])`, 'i');
}

/**
 * The matching rule (S16): a landing belongs to the item whose declared id
 * appears FIRST in its first commit's subject (`feat(ENG-008 E15): …`,
 * `fix(BUG-256): …`). Ids that resolve to more than one item are skipped, so
 * ambiguity reads as unmatched rather than guessed, as session links do (S3).
 */
export function landingOwner(
  subject: string | null,
  items: readonly RoadmapItemView[]
): RoadmapItemView | null {
  if (!subject) return null;
  let owner: RoadmapItemView | null = null;
  let ownerIndex = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (!item.declaredId || !item.hasUniqueDeclaredId) continue;
    const match = idBoundary(item.declaredId).exec(subject);
    if (!match) continue;
    const index = match.index + match[1].length;
    if (index < ownerIndex) {
      owner = item;
      ownerIndex = index;
    }
  }
  return owner;
}

const IN_FLIGHT = new Set<RoadmapDeliveryTicket['status']>([
  'queued',
  'integrating',
]);

function ticketLanding(
  ticket: RoadmapDeliveryTicket,
  position: number | null
): RoadmapItemLanding {
  const base = {
    position,
    shortSha: null,
    ticketNumber: ticket.number,
    branch: ticket.branch,
    subject: ticket.subject,
    reason: null,
  };
  switch (ticket.status) {
    case 'queued':
      return { ...base, state: 'queued', at: ticket.admittedAt };
    case 'integrating':
      return {
        ...base,
        state: ticket.checking ? 'checking' : 'integrating',
        at: ticket.headAt ?? ticket.admittedAt,
      };
    case 'integrated':
      return {
        ...base,
        state: 'landed',
        position: null,
        shortSha: ticket.integratedSha?.slice(0, 7) ?? null,
        at: ticket.terminalAt ?? ticket.admittedAt,
      };
    case 'failed':
      return {
        ...base,
        state: 'failed',
        position: null,
        at: ticket.terminalAt ?? ticket.admittedAt,
        reason: ticket.failureReason,
      };
  }
}

function candidateLanding(
  candidate: RoadmapDeliveryCandidate
): RoadmapItemLanding {
  return {
    state: 'checking',
    position: null,
    shortSha: null,
    ticketNumber: null,
    branch: null,
    subject: candidate.subject,
    at: candidate.at,
    reason: null,
  };
}

/**
 * Assign the queue to items (mutating `landing` on the views) and summarize
 * it for the header. One landing per item: an in-flight ticket wins over a
 * pre-admission candidate, which wins over a recent terminal ticket; among
 * tickets the lowest number (closest to the head) or the newest terminal one.
 */
function projectLandings(
  read: RoadmapDeliveryRead | null,
  views: RoadmapItemView[]
): RoadmapLensLandings | null {
  if (!read || read.status !== 'ok') return null;
  const inFlight = read.tickets
    .filter(ticket => IN_FLIGHT.has(ticket.status))
    .sort((left, right) => left.number - right.number);
  const position = new Map(
    inFlight.map((ticket, index) => [ticket.id, index + 1])
  );

  type Ranked = { landing: RoadmapItemLanding; rank: number; order: number };
  const chosen = new Map<string, Ranked>();
  const offer = (item: RoadmapItemView, candidate: Ranked) => {
    const current = chosen.get(item.id);
    if (
      !current ||
      candidate.rank < current.rank ||
      (candidate.rank === current.rank && candidate.order < current.order)
    ) {
      chosen.set(item.id, candidate);
    }
  };

  let unmatched = 0;
  for (const ticket of inFlight) {
    const owner = landingOwner(ticket.subject, views);
    if (!owner) {
      unmatched += 1;
      continue;
    }
    offer(owner, {
      landing: ticketLanding(ticket, position.get(ticket.id) ?? null),
      rank: 0,
      order: ticket.number,
    });
  }
  for (const candidate of read.candidates) {
    const owner = landingOwner(candidate.subject, views);
    if (!owner) {
      unmatched += 1;
      continue;
    }
    offer(owner, {
      landing: candidateLanding(candidate),
      rank: 1,
      order: -candidate.at,
    });
  }
  for (const ticket of read.tickets) {
    if (IN_FLIGHT.has(ticket.status)) continue;
    if (
      ticket.terminalAt === null ||
      read.readAt - ticket.terminalAt > RECENT_LANDING_MS
    )
      continue;
    const owner = landingOwner(ticket.subject, views);
    if (!owner) continue;
    offer(owner, {
      landing: ticketLanding(ticket, null),
      rank: 2,
      order: -ticket.terminalAt,
    });
  }
  for (const item of views) {
    item.landing = chosen.get(item.id)?.landing ?? null;
  }

  const headTicket = inFlight[0] ?? null;
  const head = headTicket
    ? {
        ticketNumber: headTicket.number,
        declaredId: landingOwner(headTicket.subject, views)?.declaredId ?? null,
        state: ticketLanding(headTicket, 1).state,
      }
    : null;

  let newest: RoadmapDeliveryTicket | null = null;
  for (const ticket of read.tickets) {
    if (ticket.status !== 'integrated' || !ticket.integratedSha) continue;
    if (!newest || ticket.number > newest.number) newest = ticket;
  }
  const lastLanded = newest
    ? {
        shortSha: newest.integratedSha!.slice(0, 7),
        at: newest.terminalAt ?? newest.admittedAt,
        declaredId: landingOwner(newest.subject, views)?.declaredId ?? null,
      }
    : null;

  return {
    inQueue: inFlight.length,
    checking: read.candidates.length,
    head,
    unmatched,
    lastLanded,
    unreadableTickets: read.unreadableTickets,
    readAt: read.readAt,
  };
}
