import { createHash } from 'node:crypto';
import * as path from 'node:path';
import {
  AGENT_PROJECTION_VERSION,
  sourceAgentKey,
  type AgentProjectionMapping,
} from '@exawatt/core';
import { readJsonFile, writeJsonFileAtomic } from './atomic-json-file';
import {
  normalizeGatewayIdentity,
  type GatewayIdentity,
} from './gateway-identity';
import { MAX_ID_LENGTH, isRecord, validText } from './untrusted-input';

/**
 * Exawatt's projection plan: who is bound to whom, and to what (ENG-010 C2).
 *
 * A set of product decisions about people, persisted on its own. Deliberately
 * not a field on the source registry and deliberately not owned by the runtime
 * class: a source is a connection, a plan is a set of decisions the operator
 * made about coworkers, and detaching one source must never rewrite the mapping
 * of another. Keeping the file format, its per-row fail-closed parsing, and the
 * derived-id rule together here means the runtime reads and writes a plan
 * without also owning what a plan on disk looks like.
 *
 * Nothing in this module reaches a Gateway. Renaming a coworker or moving it
 * between Projects is an Exawatt decision and must be invisible to the server.
 */

const PLAN_FILE = 'connected-agent-projection.json';
const PLAN_SCHEMA_VERSION = 1;
/** A registry of coworkers, not a data store. */
export const MAX_MAPPINGS = 2_000;

/**
 * One native Agent's place in Exawatt.
 *
 * `projectLabel` rides alongside the kernel's mapping rather than inside it:
 * `AgentProjectionMapping` is the C0 contract and owns identity, not display
 * text. The label is what the Connect flow's Project step chose, kept so the
 * roster can name a Project that the local workspace catalog has never heard
 * of.
 */
export interface ConnectedAgentMapping extends AgentProjectionMapping {
  projectLabel: string;
}

/**
 * The plan, with the second half of "who is bound to whom" beside it.
 *
 * `boundIdentities` is keyed by configured source id. A mapping says "this
 * coworker is that source's `market-watch`"; the bound identity says which
 * installation was answering when the operator said so. Without it a relaunch
 * has nothing to compare the next snapshot against, and a Gateway swapped for a
 * different installation while Exawatt was closed — the moment a swap is most
 * likely and least visible — is accepted in silence. It lives here rather than
 * on the source record because it is what the plan is bound to: it is written
 * when a binding is confirmed, and it goes when the plan does.
 *
 * It carries only what `GatewayIdentity` carries: a version string and sorted
 * native Agent ids. No display name, no host, no alias, no address.
 */
export interface ConnectedAgentProjectionPlan {
  projectionVersion: typeof AGENT_PROJECTION_VERSION;
  mappings: readonly ConnectedAgentMapping[];
  boundIdentities: Readonly<Record<string, GatewayIdentity>>;
}

export interface ConnectedAgentProjectionPlanStore {
  read(): ConnectedAgentProjectionPlan;
  write(plan: ConnectedAgentProjectionPlan): void;
}

export const EMPTY_PROJECTION_PLAN: ConnectedAgentProjectionPlan = {
  projectionVersion: AGENT_PROJECTION_VERSION,
  mappings: [],
  boundIdentities: {},
};

/**
 * Exawatt's own id for a source-native Agent.
 *
 * Derived, not random, so a reconnect, a relaunch, or a reinstall that
 * rebuilds a plan from the same source produces the same coworker rather than
 * a duplicate. It is a digest of the source-qualified key, so it carries no
 * hostname, alias, or native name, and it is safe in a URL.
 */
export function deriveRemoteAgentId(
  configuredSourceId: string,
  nativeAgentId: string
): string {
  const digest = createHash('sha256')
    .update(sourceAgentKey({ configuredSourceId, nativeAgentId }))
    .digest('hex');
  return `remote-${digest.slice(0, 24)}`;
}

/**
 * Read the persisted bound identities. Fails closed per source, exactly as a
 * mapping row does: an unreadable entry costs that source its drift check,
 * never the whole file. What an identity is, and what makes two of them the
 * same installation, belongs to `gateway-identity`; this only decides how many
 * rows a file may carry.
 */
function parseBoundIdentities(
  value: unknown
): Readonly<Record<string, GatewayIdentity>> {
  if (!isRecord(value)) return {};
  const identities: Record<string, GatewayIdentity> = {};
  for (const [sourceId, candidate] of Object.entries(value).slice(
    0,
    MAX_MAPPINGS
  )) {
    if (!validText(sourceId, MAX_ID_LENGTH)) continue;
    const identity = normalizeGatewayIdentity(candidate);
    if (identity === null) continue;
    identities[sourceId] = identity;
  }
  return identities;
}

/**
 * Parse one persisted mapping. Fails closed per row: a hand-edited or
 * partially written file must cost the operator the coworkers it corrupted,
 * never the whole roster.
 */
function parseMapping(value: unknown): ConnectedAgentMapping | null {
  if (!isRecord(value)) return null;
  if (
    !validText(value.configuredSourceId, MAX_ID_LENGTH) ||
    !validText(value.nativeAgentId, MAX_ID_LENGTH) ||
    !validText(value.exawattAgentId, MAX_ID_LENGTH) ||
    !validText(value.projectId, MAX_ID_LENGTH)
  ) {
    return null;
  }
  const override = value.displayNameOverride;
  if (override !== null && !validText(override)) return null;
  return {
    configuredSourceId: value.configuredSourceId,
    nativeAgentId: value.nativeAgentId,
    exawattAgentId: value.exawattAgentId,
    projectId: value.projectId,
    displayNameOverride: override === null ? null : override,
    projectLabel: validText(value.projectLabel)
      ? value.projectLabel
      : value.projectId,
  };
}

/**
 * Drop unreadable rows, then drop collisions. Two mappings for one native
 * Agent, or two coworkers claiming one Exawatt Agent id, are fatal to the
 * kernel; resolving them here keeps a bad row from taking the roster with it.
 */
function normalizeMappings(
  rows: readonly unknown[]
): readonly ConnectedAgentMapping[] {
  const bySourceAgent = new Map<string, ConnectedAgentMapping>();
  const claimedIds = new Set<string>();
  for (const row of rows) {
    const mapping = parseMapping(row);
    if (!mapping) continue;
    const key = sourceAgentKey(mapping);
    if (bySourceAgent.has(key)) continue;
    if (claimedIds.has(mapping.exawattAgentId)) continue;
    claimedIds.add(mapping.exawattAgentId);
    bySourceAgent.set(key, mapping);
  }
  return [...bySourceAgent.values()];
}

/** The plan on disk. */
export class FileConnectedAgentProjectionPlanStore implements ConnectedAgentProjectionPlanStore {
  private readonly file: string;

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, PLAN_FILE);
  }

  read(): ConnectedAgentProjectionPlan {
    // Missing or corrupt is an empty plan, never a crash on boot.
    const parsed = readJsonFile(this.file);
    if (!isRecord(parsed)) return EMPTY_PROJECTION_PLAN;
    // A file written before bound identities existed simply has none, which
    // reads as "never seen" and is the right answer for a source Exawatt has
    // no history with.
    const boundIdentities = parseBoundIdentities(parsed.boundIdentities);
    const rows = parsed.mappings;
    if (!Array.isArray(rows)) {
      return { ...EMPTY_PROJECTION_PLAN, boundIdentities };
    }
    return {
      projectionVersion: AGENT_PROJECTION_VERSION,
      mappings: normalizeMappings(rows.slice(0, MAX_MAPPINGS)),
      boundIdentities,
    };
  }

  write(plan: ConnectedAgentProjectionPlan): void {
    writeJsonFileAtomic(this.file, {
      schemaVersion: PLAN_SCHEMA_VERSION,
      projectionVersion: AGENT_PROJECTION_VERSION,
      mappings: plan.mappings,
      boundIdentities: plan.boundIdentities,
    });
  }
}
