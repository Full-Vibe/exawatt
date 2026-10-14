'use client';

/**
 * The sound of pressing an agent (ENG-031 W15i, operator 2026-10-13: "add
 * the keyswitch sound effect for clicking-to-select a given agent (from the
 * Keyswitch material studies)"). It is the keyswitch study's Frosted thock,
 * the profile the shipped Agent Start key plays, synthesized on the spot: a
 * press on the way down, a quieter release on the way up.
 *
 * Only ever from a pointer gesture. The audio context is made on the first
 * one, which is what lets a browser start it, and closed with the page.
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  KEYSWITCH_VARIANT_SOUND_PROFILES,
  playKeySwitchSound,
  type KeySwitchSoundPhase,
} from '@/components/hud/webgl/keyswitch-audio';

const PROFILE = KEYSWITCH_VARIANT_SOUND_PROFILES['reference-frost'];

type AudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
    __EXA_DISABLE_KEYSWITCH_AUDIO__?: boolean;
  };

export function usePressSound(
  enabled: boolean
): (phase: KeySwitchSoundPhase) => void {
  const context = useRef<AudioContext | null>(null);

  useEffect(
    () => () => {
      const active = context.current;
      context.current = null;
      if (active && active.state !== 'closed')
        void active.close().catch(() => undefined);
    },
    []
  );

  return useCallback(
    (phase: KeySwitchSoundPhase) => {
      if (!enabled || typeof window === 'undefined') return;
      const audioWindow = window as AudioWindow;
      if (audioWindow.__EXA_DISABLE_KEYSWITCH_AUDIO__) return;
      const Constructor =
        audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
      if (!Constructor) return;
      try {
        const active =
          context.current ?? new Constructor({ latencyHint: 'interactive' });
        context.current = active;
        if (active.state === 'suspended')
          void active.resume().catch(() => undefined);
        playKeySwitchSound(active, PROFILE, phase);
      } catch {
        // no sound is never an error
      }
    },
    [enabled]
  );
}
