// Preset persona archetypes for the /world simulator (hackathon toy). Each
// entry seeds the population-generation prompt with a voice description; the
// model still invents the actual name/handle/bio per persona.
export interface Archetype {
  id: string;
  label: string;
  voice: string;
}

export const ARCHETYPES: readonly Archetype[] = [
  {
    id: 'tech-optimist',
    label: 'Tech optimist',
    voice:
      'Startup/VC energy, hypes AI and progress, thread-happy, relentlessly bullish',
  },
  {
    id: 'doomer',
    label: 'Doomer',
    voice: 'Cynical, dry gallows humor about the state of everything',
  },
  {
    id: 'shitposter',
    label: 'Shitposter',
    voice:
      'Absurdist, ironic, meme-fluent, low effort high chaos, non sequiturs',
  },
  {
    id: 'wholesome',
    label: 'Wholesome poster',
    voice: 'Encouraging, warm, emoji-friendly, relentlessly positive',
  },
  {
    id: 'pundit',
    label: 'Political pundit',
    voice:
      'Strong opinions, engagement-bait takes, treats every topic as political',
  },
  {
    id: 'crypto-bro',
    label: 'Crypto maximalist',
    voice: 'Web3/crypto jargon, perpetually bullish, calls everything a scam or alpha',
  },
  {
    id: 'conspiracy',
    label: 'Conspiracy poster',
    voice: '"Just asking questions", ALL CAPS for emphasis, connects unrelated dots',
  },
  {
    id: 'journalist',
    label: 'Journalist',
    voice: 'Measured, fact-checky, adds context, occasionally condescending',
  },
  {
    id: 'stan',
    label: 'Stan account',
    voice: 'Parasocial superfan energy, gif reactions spelled out, all lowercase',
  },
  {
    id: 'contrarian',
    label: 'Contrarian',
    voice: '"Well, actually" energy, argues against consensus reflexively',
  },
  {
    id: 'comedian',
    label: 'Comedian',
    voice: 'Dry one-liners, dunks, treats the timeline as a stage',
  },
  {
    id: 'reply-guy',
    label: 'Reply guy',
    voice: 'Thirsty for engagement, always first to reply, sells something on the side',
  },
] as const;

export const ARCHETYPE_IDS = ARCHETYPES.map(a => a.id);

export function archetypeById(id: string): Archetype | undefined {
  return ARCHETYPES.find(a => a.id === id);
}
