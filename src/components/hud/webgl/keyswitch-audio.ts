export type KeySwitchSoundPhase = 'press' | 'release';

export const KEYSWITCH_VARIANT_SOUND_PROFILES = {
  'reference-frost': 'frosted-thock',
  'optic-clear': 'crystal-click',
  'smoke-low': 'graphite-thock',
  'opal-pillow': 'opal-clack',
  'original-optic': 'glass-tick',
  'original-satin': 'satin-knock',
  'original-smoke': 'smoke-clunk',
} as const;

export type KeySwitchSoundProfileId =
  (typeof KEYSWITCH_VARIANT_SOUND_PROFILES)[keyof typeof KEYSWITCH_VARIANT_SOUND_PROFILES];

interface KeySwitchSoundProfile {
  id: KeySwitchSoundProfileId;
  label: string;
  description: string;
  bodyFrequency: number;
  tickFrequency: number;
  noiseFrequency: number;
  bodyGain: number;
  tickGain: number;
  noiseGain: number;
  durationSeconds: number;
  filterQ: number;
  seed: number;
}

export const KEYSWITCH_SOUND_PROFILES: Readonly<
  Record<KeySwitchSoundProfileId, KeySwitchSoundProfile>
> = {
  'frosted-thock': {
    id: 'frosted-thock',
    label: 'Frosted thock',
    description: 'Soft polymer body with a restrained upper click.',
    bodyFrequency: 118,
    tickFrequency: 1_680,
    noiseFrequency: 1_120,
    bodyGain: 0.048,
    tickGain: 0.018,
    noiseGain: 0.015,
    durationSeconds: 0.105,
    filterQ: 0.82,
    seed: 11,
  },
  'crystal-click': {
    id: 'crystal-click',
    label: 'Crystal click',
    description: 'Bright optical snap with a short glassy tail.',
    bodyFrequency: 208,
    tickFrequency: 3_040,
    noiseFrequency: 2_420,
    bodyGain: 0.03,
    tickGain: 0.026,
    noiseGain: 0.012,
    durationSeconds: 0.072,
    filterQ: 1.7,
    seed: 23,
  },
  'graphite-thock': {
    id: 'graphite-thock',
    label: 'Graphite thock',
    description: 'Low, damped impact with very little top-end chatter.',
    bodyFrequency: 82,
    tickFrequency: 890,
    noiseFrequency: 680,
    bodyGain: 0.057,
    tickGain: 0.012,
    noiseGain: 0.011,
    durationSeconds: 0.125,
    filterQ: 0.68,
    seed: 37,
  },
  'opal-clack': {
    id: 'opal-clack',
    label: 'Opal clack',
    description: 'Rounded midrange knock with a warm plate return.',
    bodyFrequency: 146,
    tickFrequency: 1_390,
    noiseFrequency: 1_040,
    bodyGain: 0.046,
    tickGain: 0.019,
    noiseGain: 0.017,
    durationSeconds: 0.11,
    filterQ: 0.9,
    seed: 41,
  },
  'glass-tick': {
    id: 'glass-tick',
    label: 'Glass tick',
    description: 'A fast, clear optical strike with minimal body resonance.',
    bodyFrequency: 232,
    tickFrequency: 3_580,
    noiseFrequency: 2_820,
    bodyGain: 0.026,
    tickGain: 0.03,
    noiseGain: 0.01,
    durationSeconds: 0.064,
    filterQ: 2.1,
    seed: 53,
  },
  'satin-knock': {
    id: 'satin-knock',
    label: 'Satin knock',
    description: 'Muted shell contact with a dry, controlled return.',
    bodyFrequency: 104,
    tickFrequency: 1_180,
    noiseFrequency: 860,
    bodyGain: 0.044,
    tickGain: 0.014,
    noiseGain: 0.013,
    durationSeconds: 0.096,
    filterQ: 0.74,
    seed: 67,
  },
  'smoke-clunk': {
    id: 'smoke-clunk',
    label: 'Smoke clunk',
    description: 'Dense low-frequency bottom-out with a mechanical return.',
    bodyFrequency: 72,
    tickFrequency: 730,
    noiseFrequency: 570,
    bodyGain: 0.061,
    tickGain: 0.011,
    noiseGain: 0.014,
    durationSeconds: 0.138,
    filterQ: 0.61,
    seed: 79,
  },
};

function applyImpulseEnvelope(
  gain: AudioParam,
  startTime: number,
  peak: number,
  durationSeconds: number
) {
  gain.cancelScheduledValues(startTime);
  gain.setValueAtTime(0.0001, startTime);
  gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), startTime + 0.002);
  gain.exponentialRampToValueAtTime(0.0001, startTime + durationSeconds);
}

function createNoiseBuffer(
  context: AudioContext,
  durationSeconds: number,
  seed: number
) {
  const frameCount = Math.max(
    1,
    Math.ceil(context.sampleRate * durationSeconds)
  );
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let state = seed >>> 0;

  for (let index = 0; index < samples.length; index += 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    samples[index] = (state / 0xffffffff) * 2 - 1;
  }

  return buffer;
}

/**
 * Synthesizes a quiet mechanical impulse. Call only from a user gesture; idle
 * invitation motion intentionally stays silent.
 */
export function playKeySwitchSound(
  context: AudioContext,
  profileId: KeySwitchSoundProfileId,
  phase: KeySwitchSoundPhase
) {
  const profile = KEYSWITCH_SOUND_PROFILES[profileId];
  const now = context.currentTime + 0.003;
  const phaseGain = phase === 'press' ? 1 : 0.58;
  const phasePitch = phase === 'press' ? 1 : 1.16;
  const duration = profile.durationSeconds * (phase === 'press' ? 1 : 0.62);

  const master = context.createGain();
  master.gain.setValueAtTime(0.82, now);
  master.connect(context.destination);

  const body = context.createOscillator();
  const bodyGain = context.createGain();
  body.type = 'triangle';
  body.frequency.setValueAtTime(profile.bodyFrequency * phasePitch, now);
  body.frequency.exponentialRampToValueAtTime(
    Math.max(30, profile.bodyFrequency * phasePitch * 0.72),
    now + duration
  );
  applyImpulseEnvelope(
    bodyGain.gain,
    now,
    profile.bodyGain * phaseGain,
    duration
  );
  body.connect(bodyGain).connect(master);

  const tick = context.createOscillator();
  const tickGain = context.createGain();
  tick.type = 'sine';
  tick.frequency.setValueAtTime(profile.tickFrequency * phasePitch, now);
  tick.frequency.exponentialRampToValueAtTime(
    profile.tickFrequency * phasePitch * 0.76,
    now + Math.min(duration, 0.038)
  );
  applyImpulseEnvelope(
    tickGain.gain,
    now,
    profile.tickGain * phaseGain,
    Math.min(duration, 0.038)
  );
  tick.connect(tickGain).connect(master);

  const noise = context.createBufferSource();
  const noiseFilter = context.createBiquadFilter();
  const noiseGain = context.createGain();
  const noiseDuration = Math.min(duration, 0.045);
  noise.buffer = createNoiseBuffer(
    context,
    noiseDuration,
    profile.seed + (phase === 'press' ? 0 : 1)
  );
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.setValueAtTime(
    profile.noiseFrequency * phasePitch,
    now
  );
  noiseFilter.Q.setValueAtTime(profile.filterQ, now);
  applyImpulseEnvelope(
    noiseGain.gain,
    now,
    profile.noiseGain * phaseGain,
    noiseDuration
  );
  noise.connect(noiseFilter).connect(noiseGain).connect(master);

  body.start(now);
  body.stop(now + duration + 0.01);
  tick.start(now);
  tick.stop(now + Math.min(duration, 0.038) + 0.01);
  noise.start(now);
  noise.stop(now + noiseDuration + 0.01);
}
