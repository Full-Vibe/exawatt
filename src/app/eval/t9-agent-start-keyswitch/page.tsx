'use client';

import { useState } from 'react';
import { AgentStartKeySwitchButton } from '@/components/hud/webgl/keyswitch-study';

export default function AgentStartKeyswitchEvalPage() {
  const [activationCount, setActivationCount] = useState(0);

  return (
    <main className="grid min-h-screen place-items-center overflow-hidden bg-[#05090c]">
      <section
        className="flex items-center gap-4 rounded border border-white/10 bg-[#0b1116] p-4"
        data-agent-start-keyswitch-eval
      >
        <span className="font-mono text-xs text-white/60">NEW AGENT</span>
        <AgentStartKeySwitchButton
          evalMode
          idleHint={false}
          onActivate={() => setActivationCount(count => count + 1)}
        />
        <output
          aria-label="Activation count"
          className="font-mono text-xs text-white/60"
        >
          {activationCount}
        </output>
      </section>
    </main>
  );
}
