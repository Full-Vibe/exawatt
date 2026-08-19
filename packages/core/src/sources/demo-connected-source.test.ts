import { describe, expect, it } from 'vitest';
import {
  DemoConnectedSource,
  DEMO_CONNECTED_SOURCE_NOW_MS,
  DEMO_SOURCE_AGENT_MARKET,
  DEMO_SOURCE_AGENT_MARKET_REPLACEMENT,
  DEMO_SOURCE_AGENT_NEWSROOM,
  DEMO_SOURCE_AGENT_NEWSROOM_REPLACEMENT,
  DEMO_SOURCE_INSTALLATION,
  DEMO_SOURCE_INSTALLATION_REPLACEMENT,
  DEMO_SOURCE_READ_METHODS,
  DEMO_SOURCE_WRITE_METHODS,
  DEMO_SOURCE_WRITE_REFUSAL_MESSAGE,
} from './demo-connected-source';
import {
  projectAgentTopology,
  AGENT_PROJECTION_VERSION,
} from '../agent-projection';

/**
 * The Demo connected source (ENG-010 C3).
 *
 * These tests hold the fixture to the promises the lifecycle contract will
 * lean on: it answers the Gateway's own methods, it refuses every write, its
 * evidence is simulated, and each lever puts the source in the situation it
 * names without disturbing anything else.
 */

const MAIN_KEY = `agent:${DEMO_SOURCE_AGENT_MARKET}:main`;

function source(): DemoConnectedSource {
  return new DemoConnectedSource({
    configuredSourceId: 'demo-source-under-test',
  });
}

/** Words the product may never use about work it merely stopped watching. */
const STOPPED_WORK_WORDS = /stopped|paused|lost|ended|finished/iu;

describe('DemoConnectedSource', () => {
  describe('the protocol a Gateway answers', () => {
    it('lists the configured Agents with their own configured names', () => {
      const listed = source().call('agents.list') as {
        agents: { id: string; name: string }[];
      };
      expect(listed.agents.map(agent => agent.id).sort()).toEqual([
        DEMO_SOURCE_AGENT_MARKET,
        DEMO_SOURCE_AGENT_NEWSROOM,
      ]);
      expect(listed.agents.map(agent => agent.name).sort()).toEqual([
        'Dara',
        'Wren',
      ]);
    });

    it('never lists an Agent it only retains history for', () => {
      const listed = source().call('agents.list') as {
        agents: { id: string }[];
      };
      expect(listed.agents.map(agent => agent.id)).not.toContain('night-desk');
    });

    it('keys every session the way a Gateway keys one', () => {
      const listed = source().call('sessions.list', {
        agentId: DEMO_SOURCE_AGENT_MARKET,
      }) as { sessions: { key: string }[] };
      expect(listed.sessions.map(session => session.key)).toEqual([
        MAIN_KEY,
        `agent:${DEMO_SOURCE_AGENT_MARKET}:cron:price-sweep`,
        `agent:${DEMO_SOURCE_AGENT_MARKET}:subagent:basis-check`,
        `agent:${DEMO_SOURCE_AGENT_MARKET}:thread:enrollment-notes`,
      ]);
    });

    it('reads history by sessionKey, which is not what subscribe takes', () => {
      const answered = source().call('chat.history', {
        sessionKey: MAIN_KEY,
      }) as { messages: unknown[] };
      expect(answered.messages).toHaveLength(4);
      // The protocol is not uniform here, and neither is the fixture: passing
      // the subscribe methods' parameter name must not accidentally work.
      const wrongName = source().call('chat.history', { key: MAIN_KEY }) as {
        messages: unknown[];
      };
      expect(wrongName.messages).toHaveLength(0);
    });

    it('reports its automations and its own source-wide totals', () => {
      const jobs = source().call('cron.list') as {
        jobs: {
          agentId: string;
          enabled: boolean;
          state: { lastStatus: string };
        }[];
      };
      expect(jobs.jobs).toHaveLength(1);
      expect(jobs.jobs[0]?.agentId).toBe(DEMO_SOURCE_AGENT_MARKET);
      const status = source().call('status') as { tasks: { total: number } };
      expect(status.tasks.total).toBeGreaterThan(0);
    });

    it('answers every read method it advertises', () => {
      const demo = source();
      for (const method of DEMO_SOURCE_READ_METHODS) {
        expect(() =>
          demo.call(method, { agentId: DEMO_SOURCE_AGENT_MARKET })
        ).not.toThrow();
      }
    });

    it('refuses every write the way a read-scoped device is refused', () => {
      const demo = source();
      for (const method of DEMO_SOURCE_WRITE_METHODS) {
        expect(() => demo.call(method, {})).toThrow(
          DEMO_SOURCE_WRITE_REFUSAL_MESSAGE
        );
      }
    });

    it('throws loudly on a method it does not implement', () => {
      expect(() => source().call('gateway.restart')).toThrow(
        /does not implement/u
      );
    });

    it('records every method it was asked for, refusals included', () => {
      const demo = source();
      demo.call('agents.list');
      expect(() => demo.call('chat.send', {})).toThrow();
      expect(demo.calls.map(call => call.method)).toEqual([
        'agents.list',
        'chat.send',
      ]);
    });
  });

  describe('evidence', () => {
    it('is simulated, at the one place a snapshot is built', () => {
      const demo = source();
      expect(demo.evidenceBasis).toBe('simulated');
      expect(demo.snapshot().evidenceBasis).toBe('simulated');
    });

    it('produces a snapshot the projection kernel accepts', () => {
      const demo = source();
      const projected = projectAgentTopology([demo.snapshot()], {
        projectionVersion: AGENT_PROJECTION_VERSION,
        mappings: [
          {
            configuredSourceId: demo.configuredSourceId,
            nativeAgentId: DEMO_SOURCE_AGENT_MARKET,
            exawattAgentId: 'demo-coworker-wren',
            projectId: 'demo-project-market',
            displayNameOverride: null,
          },
        ],
      });
      expect(projected.ok).toBe(true);
      if (!projected.ok) return;
      expect(projected.projection.agents).toHaveLength(1);
      const [wren] = projected.projection.agents;
      expect(wren?.displayName).toBe('Wren');
      expect(wren?.primaryConversation?.nativeContextId).toBe(MAIN_KEY);
      expect(wren?.contexts).toHaveLength(4);
    });

    it('keeps cron, helper, and spawned work subordinate to the coworker', () => {
      const snapshot = source().snapshot();
      expect(snapshot.agents.map(agent => agent.nativeAgentId).sort()).toEqual([
        DEMO_SOURCE_AGENT_MARKET,
        DEMO_SOURCE_AGENT_NEWSROOM,
      ]);
      const kinds = snapshot.contexts
        .filter(context => context.nativeAgentId === DEMO_SOURCE_AGENT_MARKET)
        .map(context => context.kind)
        .sort();
      expect(kinds).toEqual(['cron', 'helper', 'main', 'spawned']);
    });

    it('is stable when nothing about the source moved', () => {
      const demo = source();
      expect(demo.snapshot(1_000)).toEqual(demo.snapshot(1_000));
    });
  });

  describe('levers', () => {
    it('stops answering and comes back with everything it had', () => {
      const demo = source();
      const before = demo.snapshot(1_000);
      demo.goAway();
      expect(demo.answering).toBe(false);
      expect(() => demo.call('agents.list')).toThrow();
      demo.comeBack();
      expect(demo.call('chat.history', { sessionKey: MAIN_KEY })).toEqual({
        sessionKey: MAIN_KEY,
        messages: expect.any(Array),
      });
      expect(demo.snapshot(1_000)).toEqual(before);
    });

    it('says nothing about work when it cannot be reached', () => {
      const demo = source();
      demo.goAway();
      try {
        demo.call('agents.list');
        expect.unreachable('an unreachable source must refuse the read');
      } catch (error) {
        expect((error as Error).message).not.toMatch(STOPPED_WORK_WORDS);
      }
    });

    it('restarts with the same identities and no run in flight', () => {
      const demo = source();
      demo.startRun(DEMO_SOURCE_AGENT_MARKET);
      expect(
        demo.snapshot().contexts.some(context => context.hasActiveRun)
      ).toBe(true);
      demo.restart();
      expect(demo.installationId).toBe(DEMO_SOURCE_INSTALLATION);
      expect(demo.configuredAgentIds).toEqual([
        DEMO_SOURCE_AGENT_MARKET,
        DEMO_SOURCE_AGENT_NEWSROOM,
      ]);
      expect(
        demo.snapshot().contexts.some(context => context.hasActiveRun === true)
      ).toBe(false);
      expect(demo.lifetimeCount).toBe(2);
    });

    it('restarts as another installation keeping only the display names', () => {
      const demo = source();
      demo.restartAsAnotherInstallation();
      expect(demo.installationId).toBe(DEMO_SOURCE_INSTALLATION_REPLACEMENT);
      expect(demo.configuredAgentIds).toEqual(
        [
          DEMO_SOURCE_AGENT_MARKET_REPLACEMENT,
          DEMO_SOURCE_AGENT_NEWSROOM_REPLACEMENT,
        ].sort()
      );
      expect(Object.values(demo.configuredAgentNames).sort()).toEqual([
        'Dara',
        'Wren',
      ]);
    });

    it('retires an Agent without disturbing the other', () => {
      const demo = source();
      demo.retireAgent(DEMO_SOURCE_AGENT_NEWSROOM);
      expect(demo.configuredAgentIds).toEqual([DEMO_SOURCE_AGENT_MARKET]);
      const listed = demo.call('agents.list') as { agents: { id: string }[] };
      expect(listed.agents.map(agent => agent.id)).toEqual([
        DEMO_SOURCE_AGENT_MARKET,
      ]);
      expect(
        demo
          .snapshot()
          .contexts.some(
            context => context.nativeAgentId === DEMO_SOURCE_AGENT_MARKET
          )
      ).toBe(true);
    });

    it('configures a new Agent with a conversation of its own', () => {
      const demo = source();
      demo.configureAgent('support-desk', 'Ines');
      expect(demo.configuredAgentIds).toContain('support-desk');
      const primary = demo
        .snapshot()
        .contexts.find(context => context.nativeAgentId === 'support-desk');
      expect(primary?.roles).toEqual(['primary-conversation']);
    });

    it('starts and clears a run without touching anything else', () => {
      const demo = source();
      const before = demo.retainedContextKeys;
      demo.startRun(DEMO_SOURCE_AGENT_MARKET);
      expect(
        demo
          .snapshot()
          .contexts.find(context => context.nativeContextId === MAIN_KEY)
          ?.hasActiveRun
      ).toBe(true);
      demo.clearRun(DEMO_SOURCE_AGENT_MARKET);
      expect(
        demo
          .snapshot()
          .contexts.find(context => context.nativeContextId === MAIN_KEY)
          ?.hasActiveRun
      ).toBe(false);
      expect(demo.retainedContextKeys).toEqual(before);
    });

    it('forgets one retained context and keeps the rest', () => {
      const demo = source();
      const helper = `agent:${DEMO_SOURCE_AGENT_MARKET}:thread:enrollment-notes`;
      demo.forgetContext(helper);
      expect(demo.retainedContextKeys).not.toContain(helper);
      expect(demo.retainedContextKeys).toContain(MAIN_KEY);
    });

    it('moves only when a caller advances its clock', () => {
      const demo = source();
      expect(demo.now).toBe(DEMO_CONNECTED_SOURCE_NOW_MS);
      demo.advance(90_000);
      expect(demo.now).toBe(DEMO_CONNECTED_SOURCE_NOW_MS + 90_000);
      demo.advance(-5);
      expect(demo.now).toBe(DEMO_CONNECTED_SOURCE_NOW_MS + 90_000);
    });
  });

  describe('public safety', () => {
    it('names no host, address, user, key, or credential anywhere it answers', () => {
      const demo = source();
      const answered = JSON.stringify([
        demo.call('agents.list'),
        demo.call('sessions.list', { agentId: DEMO_SOURCE_AGENT_MARKET }),
        demo.call('sessions.list', { agentId: DEMO_SOURCE_AGENT_NEWSROOM }),
        demo.call('cron.list'),
        demo.call('status'),
        demo.call('chat.history', { sessionKey: MAIN_KEY }),
        demo.snapshot(),
      ]);
      for (const pattern of [
        /\b\d{1,3}(\.\d{1,3}){3}\b/u,
        /https?:\/\//iu,
        /\bssh\b/iu,
        /BEGIN [A-Z ]*PRIVATE KEY/u,
        /\b[\w.-]+@[\w.-]+\.\w+\b/u,
        /\.(com|net|org|io|ai|dev)\b/iu,
      ]) {
        expect(answered).not.toMatch(pattern);
      }
    });

    it('never carries the workspace, model, or runtime into a snapshot', () => {
      const serialized = JSON.stringify(source().snapshot());
      expect(serialized).not.toMatch(/invented\/never\/read/u);
      expect(serialized).not.toMatch(/invented-model/u);
      expect(serialized).not.toMatch(/invented-runtime/u);
    });
  });
});
