import {
  harnessCarriesAgentName,
  type AgentNameRecord,
  type AgentNameRequest,
} from '@exawatt/core';

import { isSessionTab, type Project } from './workspace-model';

/**
 * The Sessions in the layout that main has not named for the Project they
 * sit in, in Project order and then tab order (ENG-029 C4).
 *
 * This is the migration and the catch-up in one: the first read of a layout
 * saved before names existed asks for every Agent at once, so the names it
 * is dealt follow the strip left to right; afterwards it asks only for a
 * Session that arrived without one (a reopened or cloned tab) or that moved
 * Project. A draft is named when it launches, a shell never is, and a
 * connected coworker keeps the name its source gave it.
 *
 * A tab its operator renamed under an older build offers that title as the
 * name it would like.
 */
export function agentNameRequests(
  projects: readonly Project[],
  names: ReadonlyMap<string, AgentNameRecord>
): AgentNameRequest[] {
  const requests: AgentNameRequest[] = [];
  for (const project of projects) {
    for (const tab of project.tabs) {
      if (!isSessionTab(tab) || tab.lifecycle === 'draft') continue;
      if (!harnessCarriesAgentName(tab.harness)) continue;
      const known = names.get(tab.durableSessionId);
      if (known && known.projectKey === project.dir) continue;
      requests.push({
        durableSessionId: tab.durableSessionId,
        projectKey: project.dir,
        harness: tab.harness,
        preferredName: tab.titleKind === 'operator' ? tab.title : null,
      });
    }
  }
  return requests;
}
