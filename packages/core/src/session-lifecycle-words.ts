/**
 * Session lifecycle words (ENG-015 S6.4): each word is spelled once, here.
 *
 * `session-lifecycle.ts` in `@exawatt/ui-model` owns which word a Session
 * gets, with its line, tone and verb, and every renderer surface reads that
 * owner. The words themselves live in this package for the reason
 * `surface-names.ts` does: one of them crosses the process boundary. The
 * native Session menu names the paused Agents from Electron main, which
 * reaches `@exawatt/core` and not `@exawatt/ui-model`, so the command-verb
 * manifest used to spell its own word ("Resume Parked Agents") about the
 * same Agents every renderer surface called Paused.
 */
export const SESSION_LIFECYCLE_WORD = {
  draft: 'Draft',
  running: 'Running',
  resuming: 'Resuming',
  resumeFailed: 'Resume failed',
  interrupted: 'Interrupted',
  exited: 'Exited',
  closed: 'Closed',
  paused: 'Paused',
} as const;
