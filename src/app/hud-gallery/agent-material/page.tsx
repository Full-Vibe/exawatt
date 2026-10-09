import { Suspense } from 'react';
import { AgentMaterialStudy } from './study';

// useSearchParams needs a Suspense boundary so the route is not forced into
// client-side rendering at build time.
export default function AgentMaterialPage() {
  return (
    <Suspense>
      <AgentMaterialStudy />
    </Suspense>
  );
}
