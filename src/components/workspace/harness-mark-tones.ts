/** Vendor-authored tones shared by DOM/story adapters and the tile renderer.
 * Unlisted roles use the surrounding ink; concept brands stay site-only. */
const TONES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  claude: { brand: '#D97757' },
  openclaw: {
    brand: '#ff4d4d',
    claws: '#f0453e',
    eye: '#050810',
    glint: '#00e5cc',
  },
};

export function harnessMarkTone(id: string, tone: string): string | null {
  return TONES[id]?.[tone] ?? null;
}
