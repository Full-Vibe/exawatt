'use client';

import { WebglStatusLightsScene } from '@/components/hud/webgl/scenes';

export default function StatusLightsEvalPage() {
  return (
    <main className="flex h-screen items-center justify-center bg-[#04060b] p-8">
      <WebglStatusLightsScene evalMode />
    </main>
  );
}
