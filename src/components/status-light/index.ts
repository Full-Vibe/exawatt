export {
  AGENT_STATUS_LIGHT_STATE,
  STATUS_LIGHT_ACTIVE_ROTATION_SECONDS,
  STATUS_LIGHT_META,
  STATUS_LIGHT_STATES,
  deriveStatusLightState,
  statusLightStateForAgentStatus,
  statusLightWord,
} from './protocol';
export type { StatusLightSignals, StatusLightState } from './protocol';
export { StatusLight, StatusLightMark } from './status-light';
export type { StatusLightSize } from './status-light';
export {
  AgentTabStatusSpecimens,
  SessionStatusSpecimens,
  StatusLightDomSpecimens,
  StatusLightProtocolLegend,
} from './specimens';
