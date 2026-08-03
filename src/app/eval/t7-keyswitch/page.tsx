import { KeySwitchStudy } from '@/components/hud/webgl/keyswitch-study';

export default function KeyswitchEvalPage() {
  return (
    <main className="min-h-screen bg-hud-deep px-6 pb-6 pt-20">
      <KeySwitchStudy evalMode />
    </main>
  );
}
