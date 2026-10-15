/**
 * The bus message contract as the renderer reads it (ENG-029 C4, decision
 * `0052`): P3's B1 contract in `packages/core/src/bus/`, re-exported under
 * the names the renderer uses. `BusMessage` is a logged `MessageRecord`.
 */
export {
  BUS_OPERATOR_ID,
  type BusDeliveryState,
  type BusEndpoint,
  type BusLedgerRead,
  type BusSender,
  type BusSendRequest,
  type BusSendResult,
  type MessageRecord as BusMessage,
} from '@exawatt/core';
