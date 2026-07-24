import { KeySwitchStudy } from '@/components/hud/webgl/keyswitch-study';

export default function KeyswitchEvalPage() {
  return (
    <main className="min-h-screen bg-[#070a0c] p-6">
      <KeySwitchStudy evalMode />
    </main>
  );
}
