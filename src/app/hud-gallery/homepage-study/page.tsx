import { Suspense } from 'react';
import localFont from 'next/font/local';
import { HomepageStudy } from './study';

// Manrope remains a study alternative to the selected Hanken face.
const manrope = localFont({
  src: './fonts/Manrope-Variable-Latin.woff2',
  variable: '--study-manrope',
  weight: '200 800',
  display: 'swap',
  preload: false,
});

// useSearchParams needs a Suspense boundary so the route is not forced into
// client-side rendering at build time.
export default function HomepageStudyPage() {
  return (
    <Suspense>
      <HomepageStudy fontVariables={manrope.variable} />
    </Suspense>
  );
}
