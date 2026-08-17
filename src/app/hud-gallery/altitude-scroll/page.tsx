import { Suspense } from 'react';
import { AltitudeScrollStudy } from './study';

// useSearchParams needs a Suspense boundary so the route is not forced into
// client-side rendering at build time.
export default function AltitudeScrollStudyPage() {
  return (
    <Suspense>
      <AltitudeScrollStudy />
    </Suspense>
  );
}
