/**
 * Which Project and which Agent the board is ABOUT (ENG-031 W4).
 *
 * The camera rig picks a Project for the Team framing and an Agent for the
 * closest framing; the scrollytelling panels highlight the same two and name
 * them in their copy. Those picks have to be the SAME pick, or the panel says
 * "Battery Dispatch" while the camera flies to Device Telemetry.
 *
 * So the choice lives here, in a pure module with no three.js in it: the R3F
 * rig imports it for its framings, the highlight resolver imports it for its
 * emphasis, and the panel reads the resolved subject's own label. One decision,
 * three consumers.
 */
import type { HeroBoardCapture } from './capture-types';
import { HERO_STATUS_ORDER } from './capture-types';

export interface HeroBoardSubjects {
  /** The Project the Team altitude frames: the one carrying the most Agents. */
  teamZone: number;
  /** One Agent inside it that needs a human, because that is the Agent the
   *  page is arguing about. Falls back to any Agent in the Project. */
  agentUnit: number;
}

export function heroBoardSubjects(
  capture: HeroBoardCapture
): HeroBoardSubjects {
  let teamZone = 0;
  for (let index = 0; index < capture.zones.length; index += 1) {
    if (
      capture.zones[index]!.agentCount > capture.zones[teamZone]!.agentCount
    ) {
      teamZone = index;
    }
  }

  const needsYou = HERO_STATUS_ORDER.indexOf('blocked');
  let agentUnit = capture.units.findIndex(
    unit => unit.zone === teamZone && unit.status === needsYou
  );
  if (agentUnit < 0) {
    agentUnit = capture.units.findIndex(unit => unit.zone === teamZone);
  }
  return { teamZone, agentUnit: Math.max(0, agentUnit) };
}
