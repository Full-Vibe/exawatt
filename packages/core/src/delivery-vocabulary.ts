/**
 * The delivery queue's persisted vocabulary, old names to new (ENG-022).
 *
 * `agent:land` writes `metrics.jsonl` events and ticket results under the
 * common Git directory, and two readers consume them: the delivery scripts
 * (`scripts/lib/delivery-state.mjs`) and the Roadmap lens in the Electron
 * main process (`electron/main/roadmap/roadmap-landings.ts`). Records written
 * before 2026-10-18, when the required checks were renamed the landing
 * checks, keep their old names, so both readers map them through this one
 * table at their read boundary and nothing past it knows the old words.
 * Writers only ever write the new names.
 *
 * The delivery scripts load this file as source (`@exawatt/core/delivery-vocabulary`
 * resolves to it under the `import` condition), so it holds erasable
 * TypeScript only and imports nothing. It is one of the delivery suite's
 * declared core entry points (`CORE_DELIVERY_ENTRIES`).
 */

/** Event `type` values, old to new. */
const LEGACY_DELIVERY_EVENT_TYPES: ReadonlyMap<string, string> = new Map([
  ['floor_check', 'landing_check'],
]);

/** Record field names, old to new. */
const LEGACY_DELIVERY_RECORD_FIELDS: ReadonlyMap<string, string> = new Map([
  ['exactFloorSha', 'exactLandingCheckSha'],
]);

/**
 * A persisted delivery record (a metric event or a ticket result) in today's
 * names. A record that carries both names keeps the new name's value.
 */
export function normalizeDeliveryRecord<T>(record: T): T {
  if (!record || typeof record !== 'object' || Array.isArray(record))
    return record;
  let normalized = record as Record<string, unknown>;
  const type =
    typeof normalized.type === 'string'
      ? LEGACY_DELIVERY_EVENT_TYPES.get(normalized.type)
      : undefined;
  if (type) normalized = { ...normalized, type };
  for (const [legacy, current] of LEGACY_DELIVERY_RECORD_FIELDS) {
    if (!(legacy in normalized)) continue;
    const { [legacy]: value, ...rest } = normalized;
    normalized = { ...rest, [current]: rest[current] ?? value };
  }
  return normalized as T;
}
