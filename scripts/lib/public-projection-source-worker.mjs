#!/usr/bin/env node

/**
 * The child `projectPublicHistory` hands a render to when the source commit
 * carries a projector other than the one the caller loaded. It runs from that
 * commit's extracted `scripts/` tree, so the projection below is the commit's
 * own; options arrive as JSON on stdin and the result leaves as JSON on stdout.
 */
import { projectPublicHistory } from './public-projection.mjs';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const options = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const result = await projectPublicHistory({
  ...options,
  useRunningProjector: true,
});
process.stdout.write(JSON.stringify(result) + '\n');
