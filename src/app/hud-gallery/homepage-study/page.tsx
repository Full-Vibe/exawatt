import { Suspense } from 'react';
import localFont from 'next/font/local';
import { HomepageStudy } from './study';

// Study-only faces. Keep the production homepage on its approved type until
// the operator chooses a direction here.
const manrope = localFont({
  src: './fonts/Manrope-Variable-Latin.woff2',
  variable: '--study-manrope',
  weight: '200 800',
  display: 'swap',
  preload: false,
});
const hanken = localFont({
  src: './fonts/HankenGrotesk-Variable-Latin.woff2',
  variable: '--study-hanken',
  weight: '100 900',
  display: 'swap',
  preload: false,
});

// useSearchParams needs a Suspense boundary so the route is not forced into
// client-side rendering at build time.
export default function HomepageStudyPage() {
  return (
    <Suspense>
      <HomepageStudy fontVariables={`${manrope.variable} ${hanken.variable}`} />
    </Suspense>
  );
}
