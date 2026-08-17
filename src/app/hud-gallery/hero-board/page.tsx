import { Suspense } from 'react';
import { HeroBoardStudy } from './study';

// useSearchParams needs a Suspense boundary so the route is not forced into
// client-side rendering at build time.
export default function HeroBoardStudyPage() {
  return (
    <Suspense>
      <HeroBoardStudy />
    </Suspense>
  );
}
