import { Suspense } from 'react';
import { HomepageStudy } from './study';

// useSearchParams needs a Suspense boundary so the route is not forced into
// client-side rendering at build time.
export default function HomepageStudyPage() {
  return (
    <Suspense>
      <HomepageStudy />
    </Suspense>
  );
}
