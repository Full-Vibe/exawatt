import { Suspense } from 'react';
import { FoldCloseStudy } from './study';

// `useSearchParams` needs a Suspense boundary so the route is not forced into
// client-side rendering at build time.
export default function FoldCloseStudyPage() {
  return (
    <Suspense>
      <FoldCloseStudy />
    </Suspense>
  );
}
