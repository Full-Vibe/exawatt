import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent' } }));

import {
  __resetAgentActivityForTests,
  recordAgentFinished,
  recordAgentLaunched,
  recordWebLink,
  type AgentActivityDependencies,
} from './analytics-activity';
import type { MainProcessAnalyticsEvent } from './analytics-bridge';

const WEB_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function deps(options: { first?: boolean[]; link?: boolean[] } = {}) {
  const queued: MainProcessAnalyticsEvent[] = [];
  const first = [...(options.first ?? [true, false, false])];
  const link = [...(options.link ?? [true, false])];
  const dependencies: AgentActivityDependencies = {
    firstAgentLaunch: () => first.shift() ?? false,
    claimWebLink: () => link.shift() ?? false,
    queue: event => void queued.push(event),
  };
  return { dependencies, queued };
}

afterEach(() => __resetAgentActivityForTests());

describe('Agent activity main records (ENG-047)', () => {
  it('queues a launch with first_for_install true exactly once', () => {
    const { dependencies, queued } = deps();
    recordAgentLaunched(
      { id: 'pty-1', harness: 'claude' },
      { permissionMode: 'unrestricted' },
      dependencies
    );
    recordAgentLaunched({ id: 'pty-2', harness: 'codex' }, {}, dependencies);
    expect(queued).toEqual([
      {
        name: 'agent_launched',
        harness: 'claude',
        permissionMode: 'unrestricted',
        firstForInstall: true,
      },
      {
        name: 'agent_launched',
        harness: 'codex',
        permissionMode: null,
        firstForInstall: false,
      },
    ]);
  });

  it('never counts a Shell, and finishes only an Agent it saw start', () => {
    const { dependencies, queued } = deps();
    recordAgentLaunched({ id: 'pty-1', harness: 'shell' }, {}, dependencies);
    recordAgentFinished('pty-1', dependencies);
    recordAgentFinished('never-launched', dependencies);
    expect(queued).toEqual([]);

    recordAgentLaunched({ id: 'pty-2', harness: 'codex' }, {}, dependencies);
    recordAgentFinished('pty-2', dependencies);
    recordAgentFinished('pty-2', dependencies);
    expect(queued.filter(event => event.name === 'agent_finished')).toEqual([
      { name: 'agent_finished', harness: 'codex' },
    ]);
  });
});

describe('the web-to-app link (ENG-047 F2)', () => {
  it('records one alias per installation and ignores repeats', () => {
    const { dependencies, queued } = deps({ link: [true, false] });
    expect(recordWebLink(WEB_ID, dependencies)).toBe(true);
    expect(recordWebLink(WEB_ID, dependencies)).toBe(false);
    expect(queued).toEqual([{ name: 'web_alias', webId: WEB_ID }]);
  });

  it('ignores a malformed or missing id without spending the one claim', () => {
    const claim = vi.fn(() => true);
    const { dependencies, queued } = deps();
    for (const webId of [null, '', 'not-an-id', WEB_ID.toUpperCase(), `${WEB_ID}&x=1`]) {
      expect(recordWebLink(webId, { ...dependencies, claimWebLink: claim })).toBe(
        false
      );
    }
    expect(claim).not.toHaveBeenCalled();
    expect(queued).toEqual([]);
  });
});
