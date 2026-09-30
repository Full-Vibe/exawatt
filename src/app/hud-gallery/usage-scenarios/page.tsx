import { Suspense } from 'react';
import { UsageScenariosStudy } from './study';

export default function UsageScenariosPage() {
  // The study reads its scenario, hour and burn from the URL so every state
  // is one deep link away (the eval screenshots each by address).
  return (
    <Suspense fallback={null}>
      <UsageScenariosStudy />
    </Suspense>
  );
}
