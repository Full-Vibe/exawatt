import { describe, expect, it } from 'vitest';
import { playKeySwitchSound } from '@/components/hud/webgl/keyswitch-audio';
import {
  MATERIAL_SOUND,
  PRESS_SOUND_DESIGNS,
  PRESS_SOUNDS,
  playPressSound,
  resolvePressSound,
  voiceLength,
} from './press-sounds';
import { CRUST_MATERIALS } from './visuals/crust-materials';

/** A recording stand-in for an audio context: every node made, every
 *  automation call on every parameter, every start and stop, in order. */
function recorder() {
  const log: string[] = [];
  const sources: { started: number; stopped: number }[] = [];
  let id = 0;
  const param = (name: string) => {
    const p = {
      value: 0,
      setValueAtTime: (v: number, t: number) =>
        log.push(`${name}.set ${v} @${t.toFixed(4)}`),
      linearRampToValueAtTime: (v: number, t: number) =>
        log.push(`${name}.linear ${v} @${t.toFixed(4)}`),
      exponentialRampToValueAtTime: (v: number, t: number) =>
        log.push(`${name}.exp ${v} @${t.toFixed(4)}`),
      setTargetAtTime: (v: number, t: number, c: number) =>
        log.push(`${name}.target ${v} @${t.toFixed(4)} ~${c}`),
      cancelScheduledValues: (t: number) =>
        log.push(`${name}.cancel @${t.toFixed(4)}`),
    };
    return p;
  };
  const node = (kind: string) => {
    const name = `${kind}${(id += 1)}`;
    log.push(`make ${name}`);
    const source = { started: Number.NaN, stopped: Number.NaN };
    const n = {
      name,
      type: '',
      buffer: null as unknown,
      gain: param(`${name}.gain`),
      frequency: param(`${name}.frequency`),
      Q: param(`${name}.Q`),
      connect: (to: { name: string }) => {
        log.push(`${name} -> ${to.name}`);
        return to;
      },
      start: (t: number) => {
        source.started = t;
        log.push(`${name}.start @${t.toFixed(4)}`);
      },
      stop: (t: number) => {
        source.stopped = t;
        log.push(`${name}.stop @${t.toFixed(4)}`);
      },
    };
    if (kind === 'osc' || kind === 'noise') sources.push(source);
    return n;
  };
  const context = {
    currentTime: 0,
    sampleRate: 48_000,
    destination: { name: 'destination' },
    createGain: () => node('gain'),
    createOscillator: () => node('osc'),
    createBufferSource: () => node('noise'),
    createBiquadFilter: () => node('filter'),
    createBuffer: (_channels: number, frames: number) => {
      const data = new Float32Array(frames);
      return { getChannelData: () => data };
    },
  };
  return { context: context as unknown as AudioContext, log, sources };
}

describe('press sounds (ENG-031)', () => {
  it('gives every material a sound, and every sound a design', () => {
    for (const material of CRUST_MATERIALS)
      expect(
        PRESS_SOUNDS.some(sound => sound.id === MATERIAL_SOUND[material.id])
      ).toBe(true);
    expect(MATERIAL_SOUND.matte).toBe('thock');
    expect(new Set(PRESS_SOUNDS.map(sound => sound.id)).size).toBe(
      PRESS_SOUNDS.length
    );
    expect(new Set(PRESS_SOUNDS.map(sound => sound.name)).size).toBe(
      PRESS_SOUNDS.length
    );
    for (const sound of PRESS_SOUNDS)
      if (sound.id !== 'thock')
        expect(PRESS_SOUND_DESIGNS[sound.id]).toBeDefined();
  });

  it('keeps the homepage on the Frosted thock', () => {
    expect(resolvePressSound(true)).toBe('thock');
    expect(resolvePressSound(false)).toBeNull();
    expect(resolvePressSound('tink')).toBe('tink');
    for (const phase of ['press', 'release'] as const) {
      const ours = recorder();
      const keyswitch = recorder();
      playPressSound(ours.context, 'thock', phase);
      playKeySwitchSound(keyswitch.context, 'frosted-thock', phase);
      expect(ours.log).toEqual(keyswitch.log);
    }
  });

  it('designs every voice to start soft, stay quiet and end soon', () => {
    for (const [id, design] of Object.entries(PRESS_SOUND_DESIGNS)) {
      const total = { press: 0, release: 0 };
      for (const phase of ['press', 'release'] as const) {
        expect(design[phase].length, id).toBeGreaterThan(0);
        for (const voice of design[phase]) {
          // a step from silence clicks
          expect(voice.attack, id).toBeGreaterThanOrEqual(0.001);
          expect(voice.gain, id).toBeGreaterThan(0);
          expect(voice.gain, id).toBeLessThanOrEqual(0.05);
          expect(voice.decay, id).toBeGreaterThan(0);
          expect((voice.at ?? 0) + voiceLength(voice), id).toBeLessThan(0.5);
          const pitches = [voice.freq];
          if ('to' in voice && voice.to !== undefined) pitches.push(voice.to);
          if (voice.kind === 'metal')
            pitches.push(voice.freq * voice.ratio * (1 + voice.index));
          for (const hz of pitches) {
            expect(hz, id).toBeGreaterThanOrEqual(40);
            expect(hz, id).toBeLessThanOrEqual(9_000);
          }
          total[phase] += voice.gain;
        }
      }
      // a release is the quieter half of a click
      expect(total.release, id).toBeLessThan(total.press);
    }
  });

  it('stops every source it starts, from silence, into the speakers', () => {
    for (const sound of PRESS_SOUNDS) {
      if (sound.id === 'thock') continue;
      for (const phase of ['press', 'release'] as const) {
        const { context, log, sources } = recorder();
        playPressSound(context, sound.id, phase);
        expect(sources.length).toBeGreaterThan(0);
        for (const source of sources) {
          expect(source.started).toBeGreaterThan(0);
          expect(source.stopped).toBeGreaterThan(source.started);
        }
        expect(log.some(line => line.endsWith('-> destination'))).toBe(true);
        // every voice's envelope (the gains that rise to a peak) starts
        // from silence
        const envelopes = new Set(
          log
            .filter(line => /^gain\d+\.gain\.linear/.test(line))
            .map(line => line.split('.')[0])
        );
        expect(envelopes.size).toBeGreaterThan(0);
        for (const gain of envelopes) {
          const first = log.find(line => line.startsWith(`${gain}.gain.set`));
          expect(first, gain).toMatch(/\.set 0 @/);
        }
      }
    }
  });
});
