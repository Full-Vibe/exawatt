/**
 * The connected coworker's front door (ENG-033 H2).
 *
 * `RemoteAgentSurface` is the surface; `remote-agent-model` is the decision
 * logic behind it. A host mounts the surface with the Agent's identity, its
 * connection freshness, and what the source says this device may do.
 */

export {
  RemoteAgentSurface,
  electronRemoteAgentBridge,
} from './remote-agent-surface';
export { RemoteAgentPane } from './remote-agent-pane';
export type { RemoteAgentPaneProps } from './remote-agent-pane';
export {
  EMPTY_REMOTE_ROSTER,
  REMOTE_MISSING_COPY,
  projectCoworkers,
  resolveRemoteAgentTab,
  writeAuthorityFor,
} from './remote-agent-roster';
export type {
  RemoteAgentResolution,
  RemoteCoworkerTile,
  RemoteRoster,
} from './remote-agent-roster';
export { useRemoteCoworkers } from './use-remote-coworkers';
export type { RemoteCoworkers } from './use-remote-coworkers';
export type {
  ConversationReply,
  RemoteAgentBridge,
  RemoteAgentSurfaceProps,
  SendReply,
} from './remote-agent-surface';
export {
  CONVERSATION_PAGE_SIZE,
  COMPOSER_WITHHELD_REASONS,
  EMPTY_OUTBOX,
  EMPTY_WORK_STACK,
  NO_CONVERSATION_NOTE,
  REMOTE_CONNECTION_STATES,
  SEND_REFUSALS,
  SEND_REFUSAL_COPY,
  WRITE_AUTHORITY_COPY,
  WRITE_AUTHORITY_STATES,
  applyConversationUpdate,
  boundTurns,
  composerTargetFor,
  describeRemoteAgent,
  historyCarries,
  mergeTurns,
  normalizeSendRefusal,
  outboxReducer,
} from './remote-agent-model';
export type {
  ComposerState,
  ComposerWithheldReason,
  ConversationLoad,
  ConversationTurn,
  ConversationUpdate,
  FrontDoor,
  OutboundMessage,
  RemoteAgentInput,
  RemoteAgentPresentation,
  RemoteConnectionState,
  RemoteConnectionView,
  RemoteWorkStack,
  SendRefusal,
  WorkSection,
  WriteAuthority,
} from './remote-agent-model';
