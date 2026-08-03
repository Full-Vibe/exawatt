/**
 * Organization preview model (ENG-026 N3).
 *
 * The multi-human story over ENG-027's Workspace scope: decision 0023 gives
 * Team to the middle command altitude, so the human surface is Organization.
 * Members and roles are authored representative content for Voltaic Grid
 * Systems (the Demo Workspace startup); their spend is DERIVED from the
 * fixtures' base-tier Agents — the same `@exawatt/core` corpus Consumption
 * rolls up — attributed to the person who commands each Project. Raw units
 * only, exactly one commander per Project, so member spend sums to fleet
 * spend by construction (test-enforced). Nothing here is a bill.
 */
import {
  DEMO_BASE_AGENTS,
  DEMO_PROJECTS,
  type DemoUsageSpec,
} from '@exawatt/core';

export type OrgRole = 'Owner' | 'Admin' | 'Member';

export interface OrgMemberSpec {
  name: string;
  title: string;
  role: OrgRole;
  /** Voltaic Projects this person commands — a partition of the fleet. */
  projectKeys: readonly string[];
}

export interface OrgMember extends OrgMemberSpec {
  /** Base-tier Sessions commanded (delegated runs not double-counted). */
  sessionCount: number;
  /** Raw tokens across those Sessions and their delegated runs. */
  rawTokens: number;
}

/** Role meanings, Docs-like: visibility and command, not repo ACLs. */
export const ORG_ROLES: Record<OrgRole, string> = {
  Owner: 'Everything, plus billing and the Organization ceiling',
  Admin: 'Manage members, Workspaces, and policy inside the ceiling',
  Member: 'See and command the Workspaces shared with them',
};

/** Authored Voltaic humans. Every Project has exactly one commander. */
export const ORG_MEMBER_SPECS: readonly OrgMemberSpec[] = [
  {
    name: 'Maya Okafor',
    title: 'Founder & CEO',
    role: 'Owner',
    projectKeys: ['demand-gen', 'market-intel'],
  },
  {
    name: 'Dan Reyes',
    title: 'Head of Engineering',
    role: 'Admin',
    projectKeys: ['dispatch-engine', 'grid-api', 'platform-infra'],
  },
  {
    name: 'Priya Shah',
    title: 'Fleet & Grid Ops',
    role: 'Member',
    projectKeys: [
      'telemetry-ingest',
      'edge-gateway',
      'partner-portal',
      'support-ops',
    ],
  },
  {
    name: 'Tomás Silva',
    title: 'Product Engineer',
    role: 'Member',
    projectKeys: ['voltaic-home'],
  },
];

/** Raw tokens of one usage spec. `output` already includes reasoning. */
function rawTokens(usage: DemoUsageSpec): number {
  return usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
}

/** Members with spend derived from the fixture corpus. */
export function demoOrgMembers(): OrgMember[] {
  return ORG_MEMBER_SPECS.map(spec => {
    const keys = new Set(spec.projectKeys);
    const agents = DEMO_BASE_AGENTS.filter(agent => keys.has(agent.projectKey));
    return {
      ...spec,
      sessionCount: agents.length,
      rawTokens: agents.reduce(
        (sum, agent) =>
          sum +
          rawTokens(agent.usage) +
          agent.delegated.reduce((s, run) => s + rawTokens(run.usage), 0),
        0
      ),
    };
  });
}

/** Fleet total over the same corpus — the members' spend must sum to this. */
export function demoOrgFleetRawTokens(): number {
  return demoOrgMembers().reduce((sum, member) => sum + member.rawTokens, 0);
}

/** True when every Voltaic Project has exactly one commanding member. */
export function orgPartitionIsTotal(): boolean {
  const commanded = ORG_MEMBER_SPECS.flatMap(spec => spec.projectKeys);
  return (
    commanded.length === new Set(commanded).size &&
    DEMO_PROJECTS.every(project => commanded.includes(project.key))
  );
}
