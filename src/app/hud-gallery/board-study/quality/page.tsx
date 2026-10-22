import { Suspense } from 'react';
import { QualityStudy } from './study';

export default function FleetQualityPage() {
  return (
    <Suspense>
      <QualityStudy />
    </Suspense>
  );
}
