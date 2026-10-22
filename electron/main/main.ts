import { app } from 'electron';
import { claimAppInstance } from './app-instance';
import { launchBuildIdentity } from './launch-identity';

/**
 * Electron main's entry. It settles which build this is and the profile it
 * runs over, then asks for that profile's instance lock (BUG-305). Only the
 * process that holds it evaluates the composition root, so a second copy over
 * the same profile hands itself to the running one and runs nothing of the
 * app: no profile write, no URL-scheme claim, no renderer server.
 */
const { identity } = launchBuildIdentity();
const isInstance = claimAppInstance(app, {
  platform: process.platform,
  report: line => console.error(line),
  productName: identity.productName,
  userData: app.getPath('userData'),
});
// Synchronous on purpose: a composition root that throws while it is being
// evaluated fails the launch the way it always has, not as a lost rejection.
if (isInstance) require('./composition-root');
