export { parseGatewayConfigText, readGatewayConfig } from './oc/gateway-config';
export type { OCGatewayConfig } from './oc/auth';
export {
  asConfigObject,
  describeUnreadableConfig,
  readConfigFile,
  readConfigFileSync,
  withoutByteOrderMark,
} from './config-file';
export type {
  ConfigFileGrammar,
  ConfigFileRead,
  ConfigFileUnreadableCause,
} from './config-file';
export {
  NodeConsumptionFileSystem,
  expandHome,
  defaultClaudeConsumptionRoot,
  defaultCodexConsumptionRoot,
  defaultGrokConsumptionRoot,
} from './consumption/node-fs';
export type { NodeConsumptionFsOptions } from './consumption/node-fs';
