/**
 * Work-log source (ENG-027 W7): every demo Session opens READABLE.
 *
 * A Session's pane renders, in order of preference: an authored transcript
 * (the heroes), an authored few-bullet work log (the base tier), or a log
 * DERIVED here from the agent's own fixture facts (the generated board
 * tier). Derivation restates only what the fixture already records —
 * roadmap link, delegated runs, and the current state — never an invented
 * step; the no-fabricated-liveness boundary holds.
 */

import type { DemoFleetAgent } from './types';

export function demoWorkLog(agent: DemoFleetAgent): string[] {
  if (agent.workLog && agent.workLog.length > 0) return [...agent.workLog];

  const log: string[] = [];
  if (agent.roadmapItemId) {
    log.push(`Picked up ${agent.roadmapItemId} from the Project roadmap.`);
  }
  if (agent.gitBranch) {
    log.push(`Working on ${agent.gitBranch}.`);
  }
  for (const run of agent.delegated) {
    log.push(`Delegated to ${run.agentType}: ${run.task}.`);
  }
  switch (agent.status) {
    case 'blocked':
      if (agent.blocker) log.push(`Stopped for your input: ${agent.blocker.title}`);
      break;
    case 'error':
      if (agent.faultNote) log.push(`Stopped on a fault: ${agent.faultNote}`);
      break;
    case 'complete':
      log.push(`Finished the turn — ${agent.contextLabel}.`);
      break;
    case 'idle':
      log.push(`Paused — ${agent.contextLabel}.`);
      break;
    default:
      log.push(`In progress — ${agent.contextLabel}.`);
  }
  return log;
}
