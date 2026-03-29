// Server-only exports — requires Node.js filesystem access
// Never import this in browser/client code
export { readGatewayToken, readGatewayConfig } from './oc/auth';
export type { OCGatewayConfig } from './oc/auth';
