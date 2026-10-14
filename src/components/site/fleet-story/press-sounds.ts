/**
 * The sounds of pressing an agent, one per material (ENG-031, operator
 * 2026-10-14: "add some sound effect options... other cool sound effects to
 * use for the different materials"). A press plays on the way down and a
 * quieter release on the way up, as the keyswitch study's Frosted thock does
 * (W15i), which stays the homepage's sound and Matte's.
 *
 * Every sound is synthesized on the spot from a few voices: a tone (an
 * oscillator, with a pitch glide or a wobble), filtered noise (the contact),
 * and a struck metal (two oscillators in frequency modulation, the classic
 * bell and clink). Each voice rises over a millisecond or more, never a step
 * from silence, which clicks, and decays exponentially. The levels sit with
 * the thock's, so switching sounds never jumps in loudness, and the bright
 * ones sit a little under it, because the ear hears them louder.
 */

import {
  KEYSWITCH_VARIANT_SOUND_PROFILES,
  playKeySwitchSound,
  type KeySwitchSoundPhase,
} from '@/components/hud/webgl/keyswitch-audio';
import type { CrustMaterialId } from './visuals/crust-materials';

export type PressSoundId =
  | 'thock'
  | 'blop'
  | 'tick'
  | 'tink'
  | 'clink'
  | 'bubble'
  | 'droplet';

/** What a visual is told to play: a sound by name, `true` for the
 *  homepage's own (the Frosted thock), or `false` for none. */
export type PressSoundSetting = boolean | PressSoundId;

export const PRESS_SOUNDS: { id: PressSoundId; name: string; note: string }[] =
  [
    {
      id: 'thock',
      name: 'Thock',
      note: "The keyswitch study's Frosted thock: a soft polymer key. Matte's, and the homepage's.",
    },
    {
      id: 'blop',
      name: 'Blop',
      note: "Gummy's: a soft wet squish going down, a wobbly spring back up.",
    },
    {
      id: 'tick',
      name: 'Tick',
      note: "Acrylic's: a crisp tap on a hard plastic slab.",
    },
    {
      id: 'tink',
      name: 'Tink',
      note: "Glazed's: a fingernail on a glazed ceramic tile, with a short ring.",
    },
    {
      id: 'clink',
      name: 'Clink',
      note: "Anodized's: a small struck metal clink over the slab's weight.",
    },
    {
      id: 'bubble',
      name: 'Bubble',
      note: 'A bubble popping at the surface, and a smaller one after it.',
    },
    {
      id: 'droplet',
      name: 'Droplet',
      note: 'A drop falling into still water, and a tiny one after.',
    },
  ];

/** The sound each material makes when pressed. */
export const MATERIAL_SOUND: Record<CrustMaterialId, PressSoundId> = {
  matte: 'thock',
  glazed: 'tink',
  gummy: 'blop',
  acrylic: 'tick',
  anodized: 'clink',
};

/** The sound a setting plays, or none. */
export function resolvePressSound(
  setting: PressSoundSetting
): PressSoundId | null {
  if (setting === true) return 'thock';
  if (setting === false) return null;
  return setting;
}

interface Envelope {
  /** Seconds after the strike the voice starts. */
  at?: number;
  /** A linear rise to the peak, seconds; a millisecond or more. */
  attack: number;
  /** The peak gain. */
  gain: number;
  /** The decay after the peak: an exponential time constant, seconds. */
  decay: number;
}

interface ToneVoice extends Envelope {
  kind: 'tone';
  wave: 'sine' | 'triangle';
  freq: number;
  /** Where the pitch glides to, and over how long. */
  to?: number;
  glide?: number;
  /** A wobble in pitch, fading with the voice: how fast, how far (Hz). */
  wobble?: { rate: number; depth: number };
}

interface NoiseVoice extends Envelope {
  kind: 'noise';
  filter: 'lowpass' | 'bandpass' | 'highpass';
  freq: number;
  /** Where the filter sweeps to, and over how long. */
  to?: number;
  sweep?: number;
  q: number;
  seed: number;
}

interface MetalVoice extends Envelope {
  kind: 'metal';
  freq: number;
  /** The modulator's frequency as a share of the carrier's. An irrational
   *  share is what makes it sound struck rather than played. */
  ratio: number;
  /** How bright the strike is, fading into a plain ring at `indexDecay`. */
  index: number;
  indexDecay: number;
}

type Voice = ToneVoice | NoiseVoice | MetalVoice;

interface PressSoundDesign {
  press: Voice[];
  release: Voice[];
}

/** A voice is stopped this many decay constants after its peak: -60 dB. */
const TAIL = 7;

const tone = (voice: Omit<ToneVoice, 'kind'>): ToneVoice => ({
  kind: 'tone',
  ...voice,
});
const noise = (voice: Omit<NoiseVoice, 'kind'>): NoiseVoice => ({
  kind: 'noise',
  ...voice,
});
const metal = (voice: Omit<MetalVoice, 'kind'>): MetalVoice => ({
  kind: 'metal',
  ...voice,
});

/** Every sound but the thock, which is the keyswitch study's own. */
export const PRESS_SOUND_DESIGNS: Record<
  Exclude<PressSoundId, 'thock'>,
  PressSoundDesign
> = {
  // A jelly: a low round body that sinks in pitch as it squashes, with a
  // wobble that matches the tile's own; a wet squelch of noise falling
  // through a closing filter; and a little blip where it parts. Coming up,
  // it springs back with a rising wobble.
  blop: {
    press: [
      tone({
        wave: 'sine',
        freq: 210,
        to: 128,
        glide: 0.07,
        attack: 0.004,
        gain: 0.034,
        decay: 0.038,
        wobble: { rate: 19, depth: 14 },
      }),
      tone({
        wave: 'sine',
        freq: 480,
        to: 760,
        glide: 0.03,
        at: 0.008,
        attack: 0.003,
        gain: 0.01,
        decay: 0.018,
      }),
      noise({
        filter: 'lowpass',
        freq: 1600,
        to: 420,
        sweep: 0.06,
        q: 1.1,
        attack: 0.003,
        gain: 0.02,
        decay: 0.022,
        seed: 101,
      }),
    ],
    release: [
      tone({
        wave: 'sine',
        freq: 260,
        to: 470,
        glide: 0.04,
        attack: 0.003,
        gain: 0.02,
        decay: 0.03,
        wobble: { rate: 23, depth: 10 },
      }),
      noise({
        filter: 'lowpass',
        freq: 1100,
        q: 0.8,
        attack: 0.002,
        gain: 0.006,
        decay: 0.012,
        seed: 102,
      }),
    ],
  },
  // Hard plastic: the tap is a few milliseconds of bright noise, two short
  // partials above it, and the slab's own hollow body under it. Dry: acrylic
  // does not ring.
  tick: {
    press: [
      noise({
        filter: 'bandpass',
        freq: 3400,
        q: 0.9,
        attack: 0.001,
        gain: 0.05,
        decay: 0.0035,
        seed: 201,
      }),
      tone({
        wave: 'sine',
        freq: 2380,
        attack: 0.001,
        gain: 0.014,
        decay: 0.016,
      }),
      tone({
        wave: 'sine',
        freq: 3910,
        attack: 0.001,
        gain: 0.007,
        decay: 0.009,
      }),
      tone({
        wave: 'triangle',
        freq: 470,
        to: 400,
        glide: 0.03,
        attack: 0.0015,
        gain: 0.032,
        decay: 0.014,
      }),
    ],
    release: [
      noise({
        filter: 'bandpass',
        freq: 3900,
        q: 0.9,
        attack: 0.001,
        gain: 0.026,
        decay: 0.0028,
        seed: 202,
      }),
      tone({
        wave: 'sine',
        freq: 2760,
        attack: 0.001,
        gain: 0.008,
        decay: 0.011,
      }),
      tone({
        wave: 'triangle',
        freq: 540,
        to: 470,
        glide: 0.02,
        attack: 0.0015,
        gain: 0.016,
        decay: 0.01,
      }),
    ],
  },
  // Glazed ceramic: a pitched ring with the inharmonic partials a fired
  // tile has, the higher ones gone first, over a short thud of its mass. The
  // ring is short, so a run of clicks never piles up into a chime.
  tink: {
    press: [
      noise({
        filter: 'bandpass',
        freq: 2900,
        q: 0.7,
        attack: 0.001,
        gain: 0.014,
        decay: 0.003,
        seed: 301,
      }),
      tone({
        wave: 'sine',
        freq: 1870,
        attack: 0.0012,
        gain: 0.011,
        decay: 0.058,
      }),
      tone({
        wave: 'sine',
        freq: 2842,
        attack: 0.0012,
        gain: 0.0032,
        decay: 0.04,
      }),
      tone({
        wave: 'sine',
        freq: 4338,
        attack: 0.0012,
        gain: 0.0035,
        decay: 0.03,
      }),
      tone({
        wave: 'sine',
        freq: 240,
        to: 205,
        glide: 0.03,
        attack: 0.002,
        gain: 0.022,
        decay: 0.02,
      }),
    ],
    release: [
      noise({
        filter: 'bandpass',
        freq: 3400,
        q: 0.7,
        attack: 0.001,
        gain: 0.007,
        decay: 0.0025,
        seed: 302,
      }),
      tone({
        wave: 'sine',
        freq: 2230,
        attack: 0.0012,
        gain: 0.0055,
        decay: 0.036,
      }),
      tone({
        wave: 'sine',
        freq: 5174,
        attack: 0.0012,
        gain: 0.002,
        decay: 0.022,
      }),
    ],
  },
  // Anodized aluminium: a struck metal, bright at the strike and settling
  // into a plain ring, a partial above it, a hiss of contact, and the
  // slab's weight under it. Coming up, a lighter latch.
  clink: {
    press: [
      metal({
        freq: 1320,
        ratio: Math.SQRT2,
        index: 2.2,
        indexDecay: 0.028,
        attack: 0.001,
        gain: 0.012,
        decay: 0.05,
      }),
      tone({
        wave: 'sine',
        freq: 3643,
        attack: 0.001,
        gain: 0.0035,
        decay: 0.022,
      }),
      tone({
        wave: 'triangle',
        freq: 320,
        to: 270,
        glide: 0.04,
        attack: 0.0015,
        gain: 0.024,
        decay: 0.02,
      }),
      noise({
        filter: 'highpass',
        freq: 3600,
        q: 0.7,
        attack: 0.001,
        gain: 0.011,
        decay: 0.0022,
        seed: 401,
      }),
    ],
    release: [
      metal({
        freq: 1610,
        ratio: Math.SQRT2,
        index: 1.4,
        indexDecay: 0.018,
        attack: 0.001,
        gain: 0.0065,
        decay: 0.032,
      }),
      noise({
        filter: 'highpass',
        freq: 4200,
        q: 0.7,
        attack: 0.001,
        gain: 0.0055,
        decay: 0.0018,
        seed: 402,
      }),
    ],
  },
  // A bubble at the surface: the skin breaks (a tick of noise) and the
  // pocket of air rings up in pitch as it closes; a smaller one follows.
  bubble: {
    press: [
      noise({
        filter: 'bandpass',
        freq: 1600,
        q: 1.2,
        attack: 0.001,
        gain: 0.008,
        decay: 0.002,
        seed: 501,
      }),
      tone({
        wave: 'sine',
        freq: 300,
        to: 820,
        glide: 0.045,
        attack: 0.002,
        gain: 0.024,
        decay: 0.032,
      }),
      tone({
        wave: 'sine',
        freq: 430,
        to: 1050,
        glide: 0.03,
        at: 0.05,
        attack: 0.002,
        gain: 0.009,
        decay: 0.02,
      }),
    ],
    release: [
      tone({
        wave: 'sine',
        freq: 640,
        to: 1500,
        glide: 0.028,
        attack: 0.0015,
        gain: 0.01,
        decay: 0.018,
      }),
    ],
  },
  // A drop into still water: a soft plop, then the plink, a quick rise in
  // pitch as the cavity it opened closes, ringing a moment.
  droplet: {
    press: [
      tone({
        wave: 'sine',
        freq: 180,
        to: 150,
        glide: 0.02,
        attack: 0.002,
        gain: 0.02,
        decay: 0.014,
      }),
      tone({
        wave: 'sine',
        freq: 1050,
        to: 2450,
        glide: 0.022,
        at: 0.004,
        attack: 0.001,
        gain: 0.02,
        decay: 0.022,
      }),
      tone({
        wave: 'sine',
        freq: 2450,
        at: 0.026,
        attack: 0.004,
        gain: 0.0042,
        decay: 0.05,
      }),
    ],
    release: [
      tone({
        wave: 'sine',
        freq: 1500,
        to: 3000,
        glide: 0.016,
        attack: 0.001,
        gain: 0.0085,
        decay: 0.014,
      }),
    ],
  },
};

/** The output stage every designed sound goes through, as the keyswitch's
 *  goes through its own. */
const MASTER = 0.82;

const noiseCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/** Seeded white noise, so a sound is the same every time it plays. */
function noiseBuffer(
  context: BaseAudioContext,
  seconds: number,
  seed: number
): AudioBuffer {
  let byKey = noiseCache.get(context);
  if (!byKey) {
    byKey = new Map();
    noiseCache.set(context, byKey);
  }
  const key = `${seed}:${seconds}`;
  const hit = byKey.get(key);
  if (hit) return hit;
  const frames = Math.max(1, Math.ceil(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let state = seed >>> 0;
  for (let i = 0; i < frames; i += 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    samples[i] = (state / 0xffffffff) * 2 - 1;
  }
  byKey.set(key, buffer);
  return buffer;
}

/** When a voice has gone quiet, seconds after it starts. */
export function voiceLength(voice: Voice): number {
  return voice.attack + voice.decay * TAIL;
}

/** Rise, then decay: a linear attack from silence, then an exponential
 *  fall toward it. */
function shape(gain: AudioParam, start: number, voice: Voice) {
  gain.setValueAtTime(0, start);
  gain.linearRampToValueAtTime(voice.gain, start + voice.attack);
  gain.setTargetAtTime(0, start + voice.attack, voice.decay);
}

function playVoice(
  context: BaseAudioContext,
  out: AudioNode,
  voice: Voice,
  strike: number
) {
  const start = strike + (voice.at ?? 0);
  const end = start + voiceLength(voice);
  const amp = context.createGain();
  shape(amp.gain, start, voice);
  amp.connect(out);
  if (voice.kind === 'noise') {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer(context, voiceLength(voice), voice.seed);
    const filter = context.createBiquadFilter();
    filter.type = voice.filter;
    filter.frequency.setValueAtTime(voice.freq, start);
    if (voice.to !== undefined && voice.sweep)
      filter.frequency.exponentialRampToValueAtTime(
        voice.to,
        start + voice.sweep
      );
    filter.Q.setValueAtTime(voice.q, start);
    source.connect(filter).connect(amp);
    source.start(start);
    source.stop(end);
    return;
  }
  const osc = context.createOscillator();
  osc.type = voice.kind === 'metal' ? 'sine' : voice.wave;
  osc.frequency.setValueAtTime(voice.freq, start);
  osc.connect(amp);
  if (voice.kind === 'tone') {
    if (voice.to !== undefined && voice.glide)
      osc.frequency.exponentialRampToValueAtTime(voice.to, start + voice.glide);
    if (voice.wobble) {
      const lfo = context.createOscillator();
      const depth = context.createGain();
      lfo.frequency.setValueAtTime(voice.wobble.rate, start);
      depth.gain.setValueAtTime(voice.wobble.depth, start);
      depth.gain.setTargetAtTime(0, start, voice.decay);
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(start);
      lfo.stop(end);
    }
  } else {
    // frequency modulation: the deviation is the index times the
    // modulator's frequency, and the index fades, so the strike's
    // brightness settles into the carrier's ring
    const modulator = context.createOscillator();
    const deviation = context.createGain();
    const modFreq = voice.freq * voice.ratio;
    modulator.frequency.setValueAtTime(modFreq, start);
    deviation.gain.setValueAtTime(voice.index * modFreq, start);
    deviation.gain.setTargetAtTime(0, start, voice.indexDecay);
    modulator.connect(deviation).connect(osc.frequency);
    modulator.start(start);
    modulator.stop(end);
  }
  osc.start(start);
  osc.stop(end);
}

/**
 * Play a press sound. Call only from a pointer gesture, which is what lets a
 * browser start audio; idle motion stays silent.
 */
export function playPressSound(
  context: BaseAudioContext,
  id: PressSoundId,
  phase: KeySwitchSoundPhase
): void {
  if (id === 'thock') {
    // exactly the keyswitch study's Frosted thock, as the homepage plays it
    playKeySwitchSound(
      context as AudioContext,
      KEYSWITCH_VARIANT_SOUND_PROFILES['reference-frost'],
      phase
    );
    return;
  }
  const strike = context.currentTime + 0.003;
  const master = context.createGain();
  master.gain.setValueAtTime(MASTER, strike);
  master.connect(context.destination);
  for (const voice of PRESS_SOUND_DESIGNS[id][phase])
    playVoice(context, master, voice, strike);
}
