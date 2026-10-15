import { Suspense } from 'react';
import { StartScreenStudy } from './study';

/**
 * ENG-046 O0: the first-run Start screen across its five states, for
 * operator review before O2 and O5 wire it into production. Every control
 * is in the URL, so each state is one link and a screenshot away.
 */
export default function StartScreenStudyPage() {
  return (
    <Suspense fallback={null}>
      <StartScreenStudy />
    </Suspense>
  );
}
