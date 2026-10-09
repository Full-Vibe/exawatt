import type { Metadata } from 'next';
import { TerrainStudy } from './study';
export const metadata: Metadata = {
  title: 'Homepage terrain study',
  robots: { index: false, follow: false },
};
export default function Page() {
  return <TerrainStudy />;
}
