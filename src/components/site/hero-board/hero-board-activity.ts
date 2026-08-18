/**
 * How busy each Project on the board is (ENG-031 W9).
 *
 * The operator's note on the labels: "remove the 'Needs you' inline labels,
 * replace that with 'N active' and show more activity." Ten captions each
 * ending in "need you" read as ten warning labels stacked over a picture whose
 * actual claim is that a fleet is WORKING. Needs-you has not gone anywhere: it
 * is the colour on the marks, it is the whole subject of the attention panel,
 * and it is the one number in the frame's own chip. It is simply no longer the
 * caption under every Project.
 *
 * ACTIVE MEANS NOT IDLE, and it means that in the product's own vocabulary
 * rather than in a definition invented here: every status is mapped through
 * `statusLightStateForAgentStatus`, and everything except `off` is an Agent
 * with work on it. Working and reviewing are `active`, a finished run is
 * `result`, one waiting on a person is `needs-you`, a failed one is `fault`.
 * All four are things happening; only an idle Agent is not.
 *
 * Pure, and separate from the overlay, so the definition the label prints is
 * the definition a test can hold onto.
 */
import { statusLightStateForAgentStatus } from '@/components/status-light/protocol';
import type { HeroBoardCapture } from './capture-types';
import { HERO_STATUS_ORDER } from './capture-types';

/** True when this status ordinal is an Agent with work on it. */
export function heroStatusIsActive(status: number): boolean {
  const name = HERO_STATUS_ORDER[status] ?? HERO_STATUS_ORDER[4]!;
  return statusLightStateForAgentStatus(name) !== 'off';
}

/**
 * Active Agents per Project, index-aligned with `capture.zones`.
 *
 * `live` is the scheduler's per-unit status array when the board is running,
 * so the number under a Project keeps up with the marks inside it. Omit it and
 * the frozen capture answers, which is what the first paint and the poster
 * path need.
 *
 * Writes into `into` when given, so the per-frame caller allocates nothing.
 */
export function heroActiveByZone(
  capture: HeroBoardCapture,
  live?: ArrayLike<number>,
  into?: Int32Array
): Int32Array {
  const counts = into ?? new Int32Array(capture.zones.length);
  counts.fill(0);
  for (let index = 0; index < capture.units.length; index += 1) {
    const unit = capture.units[index]!;
    const status = live?.[index] ?? unit.status;
    if (!heroStatusIsActive(status)) continue;
    counts[unit.zone] = (counts[unit.zone] ?? 0) + 1;
  }
  return counts;
}
