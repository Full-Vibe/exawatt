import { NextResponse } from 'next/server';

/** Dev-only identity endpoint (ENG-022): the Electron eval harness checks
 *  which checkout the dev server it was pointed at actually serves. With
 *  parallel agent worktrees, a stale EXA_BASE silently tests the WRONG
 *  tree — the harness refuses a mismatch instead. 404 outside dev. */
export function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.json({
    repoRoot: process.cwd(),
    distributionDigest:
      process.env.NEXT_PUBLIC_EXAWATT_DISTRIBUTION_SHA256 ?? null,
    // The commit this server started from (BUG-246), so a landing can tell a
    // server that predates a rebase from one serving the tree it gates.
    sourceHead: process.env.EXAWATT_DEV_SOURCE_HEAD ?? null,
  });
}
