'use client';

/**
 * The selected engine's own lines in the setup drawer (ENG-003 S5.3.1): what
 * its sign-in step will meet in the Shell, and the disclosure its declaration
 * owes the reader. Nothing for an engine that declares neither.
 */

import {
  SourceDisclosureText,
  type SourceCardStep,
} from '@/components/agent-sources/source-card';
import { agentSourceDeclaration } from '@/generated/agent-source-declarations';
import type { AgentSourceAdapterId } from '@exawatt/core';

export function launcherSourceLines(
  adapterId: AgentSourceAdapterId,
  step: SourceCardStep | null
): React.ReactNode {
  const note = step?.kind === 'shell-sign-in' ? step.note : null;
  const disclosure = agentSourceDeclaration(adapterId).disclosure;
  if (!note && !disclosure) return null;
  return (
    <>
      {note ? <p data-source-step-note>{note}</p> : null}
      {disclosure ? (
        <p data-source-disclosure>
          <SourceDisclosureText adapterId={adapterId} />
        </p>
      ) : null}
    </>
  );
}
