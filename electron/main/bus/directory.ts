/**
 * The bus directory (ENG-029 C4): who can be addressed, and what a sender's
 * `to` means.
 *
 * The address is the durable Session id; `@name` is the Agent's own name
 * (`claude-1`, dealt at launch and renamed only by the operator), and
 * `@claude` reaches the one Claude Code Agent of the Project. Resolution is
 * the core's `resolveAgentAddress`, the one resolver every surface shares;
 * this module only feeds it the live roster, read at the moment of the send.
 * Scope is the Project (decision `0052`, 2026-10-15): a recipient in another
 * Project, an unknown one, an ended one and an ambiguous name each fail with
 * a reason the sender can act on.
 */
import {
  busHandle,
  resolveAgentAddress,
  type AgentHarness,
  type BusDirectoryEntry,
} from '@exawatt/core';
import type { PtySessionRecord } from '@exawatt/core/desktop-bridge';

/** The live session roster, and the Project key each named Agent was
 *  named within (the workspace Project's `dir`, the key Team groups by). */
interface BusSessionSource {
  list(): PtySessionRecord[];
  agentDirectory?(): { durableSessionId: string; projectKey: string }[];
}

/** One addressable Session: the directory entry plus the record behind it. */
export interface BusAddressee {
  entry: BusDirectoryEntry;
  session: PtySessionRecord & { harness: AgentHarness };
}

type BusResolution =
  | { ok: true; addressee: BusAddressee }
  | { ok: false; reason: string; candidates?: BusDirectoryEntry[] };

function isAgent(
  session: PtySessionRecord
): session is PtySessionRecord & { harness: AgentHarness } {
  return session.harness !== 'shell';
}

/** The name a Session answers to: its Agent name, else (a Session from
 *  before names, or one that could not be named) its tab label, folded. */
function nameOf(session: PtySessionRecord): string {
  return (
    session.agentName?.trim() || busHandle(session.title || session.harness)
  );
}

export class BusDirectory {
  constructor(private readonly sessions: BusSessionSource) {}

  /** Every addressable Session, live first; one per durable Session. */
  addressees(): BusAddressee[] {
    const projectKeys = new Map(
      (this.sessions.agentDirectory?.() ?? []).map(record => [
        record.durableSessionId,
        record.projectKey,
      ])
    );
    const byDurable = new Map<string, BusAddressee>();
    for (const session of this.sessions.list()) {
      if (!isAgent(session)) continue;
      const name = nameOf(session);
      const addressee: BusAddressee = {
        session,
        entry: {
          sessionId: session.durableSessionId,
          name,
          harness: session.harness,
          // The Project an Agent's name is unique within; a Session launched
          // without one is in its git Project.
          projectId:
            projectKeys.get(session.durableSessionId) ?? session.projectDir,
          projectName: session.projectName,
          handle: busHandle(name),
          state: session.exited ? 'ended' : 'live',
        },
      };
      const known = byDurable.get(session.durableSessionId);
      if (!known || (known.session.exited && !session.exited))
        byDurable.set(session.durableSessionId, addressee);
    }
    return [...byDurable.values()].sort(
      (a, b) =>
        Number(a.session.exited) - Number(b.session.exited) ||
        a.entry.handle.localeCompare(b.entry.handle)
    );
  }

  /** The Session a running process belongs to (a bus token names a pty). */
  byProcess(ptyId: string): BusAddressee | null {
    return this.addressees().find(item => item.session.id === ptyId) ?? null;
  }

  /** The live Session behind a durable address, wherever it is. */
  bySession(sessionId: string): BusAddressee | null {
    return (
      this.addressees().find(item => item.entry.sessionId === sessionId) ?? null
    );
  }

  /**
   * What `to` names, seen from a sender in `projectId`: a durable Session
   * id, `@name`, or a harness's short name (`@codex`).
   */
  resolve(
    projectId: string,
    to: string,
    senderSessionId: string | null = null
  ): BusResolution {
    const all = this.addressees();
    const resolution = resolveAgentAddress(
      all.map(item => ({
        durableSessionId: item.entry.sessionId,
        projectKey: item.entry.projectId,
        harness: item.entry.harness,
        name: item.entry.handle,
        item,
      })),
      projectId,
      to
    );
    if (resolution.kind === 'none') {
      return {
        ok: false,
        reason: resolution.elsewhere.length
          ? `${resolution.reason}; messages stay within a Project`
          : `${resolution.reason}. Run \`exawatt agents\` to list them`,
      };
    }
    if (resolution.kind === 'ambiguous') {
      // Name the live ones: an ended Agent is not a choice.
      const live = resolution.candidates.filter(
        candidate => candidate.item.entry.state === 'live'
      );
      if (live.length === 1)
        return this.addressable(live[0].item, senderSessionId);
      return {
        ok: false,
        reason: `${resolution.reason}; name one`,
        candidates: (live.length ? live : resolution.candidates).map(
          candidate => candidate.item.entry
        ),
      };
    }
    return this.addressable(resolution.agent.item, senderSessionId);
  }

  private addressable(
    addressee: BusAddressee,
    senderSessionId: string | null
  ): BusResolution {
    if (addressee.entry.state === 'ended') {
      return {
        ok: false,
        reason: `@${addressee.entry.handle} has ended; messages reach only running Agents`,
      };
    }
    if (addressee.entry.sessionId === senderSessionId) {
      return { ok: false, reason: 'That is you' };
    }
    return { ok: true, addressee };
  }
}
