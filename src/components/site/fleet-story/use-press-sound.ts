'use client';

/**
 * The sound of pressing an agent (ENG-031 W15i, operator 2026-10-13: "add
 * the keyswitch sound effect for clicking-to-select a given agent (from the
 * Keyswitch material studies)"). The homepage plays its material's own sound
 * (`MATERIAL_SOUND`: Gummy's droplet); the material study can pick any of the
 * sounds in `press-sounds.ts`, each synthesized on the spot: a press on the
 * way down, a quieter release on the way up.
 *
 * Only ever from a pointer gesture. The audio context is made on the first
 * one, which is what lets a browser start it, and closed with the page.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { KeySwitchSoundPhase } from '@/components/hud/webgl/keyswitch-audio';
import {
  playPressSound,
  type PressSoundId,
  type PressSoundSetting,
} from './press-sounds';

type AudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
    __EXA_DISABLE_KEYSWITCH_AUDIO__?: boolean;
  };

/** How long after a preview's press its release plays, as a quick click. */
const PREVIEW_RELEASE_MS = 110;

/** The page's audio context, made on first use and closed with the page. */
function useAudio(): () => AudioContext | null {
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

  return useCallback(() => {
    if (typeof window === 'undefined') return null;
    const audioWindow = window as AudioWindow;
    if (audioWindow.__EXA_DISABLE_KEYSWITCH_AUDIO__) return null;
    const Constructor =
      audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
    if (!Constructor) return null;
    const active =
      context.current ?? new Constructor({ latencyHint: 'interactive' });
    context.current = active;
    if (active.state === 'suspended')
      void active.resume().catch(() => undefined);
    return active;
  }, []);
}

export function usePressSound(
  sound: PressSoundSetting
): (phase: KeySwitchSoundPhase) => void {
  const audio = useAudio();
  return useCallback(
    (phase: KeySwitchSoundPhase) => {
      if (!sound) return;
      try {
        const active = audio();
        if (active) playPressSound(active, sound, phase);
      } catch {
        // no sound is never an error
      }
    },
    [audio, sound]
  );
}

/** A whole click of a sound, press and release, to audition it. */
export function usePressSoundPreview(): (id: PressSoundId) => void {
  const audio = useAudio();
  return useCallback(
    (id: PressSoundId) => {
      try {
        const active = audio();
        if (!active) return;
        playPressSound(active, id, 'press');
        window.setTimeout(() => {
          try {
            if (active.state !== 'closed')
              playPressSound(active, id, 'release');
          } catch {
            // no sound is never an error
          }
        }, PREVIEW_RELEASE_MS);
      } catch {
        // no sound is never an error
      }
    },
    [audio]
  );
}
