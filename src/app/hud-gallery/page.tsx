import Link from 'next/link';

const BLOCKS = [
  ['frame', 'HudFrame — chamfered panels + glow'],
  ['brackets', 'CornerBrackets — focus L-marks'],
  ['label', 'Label / Readout — type atoms'],
  ['statbar', 'StatBar — segmented metric bar'],
  ['ringgauge', 'RingGauge — radial arc gauge'],
  ['statuspill', 'StatusPill — agent status chip'],
  ['all', 'All blocks composed'],
];

export default function HudGalleryIndex() {
  return (
    <div
      className="min-h-screen p-10 font-sans"
      style={{ background: '#04060B', color: '#DCEBFF' }}
    >
      <h1 className="font-display text-2xl font-bold uppercase tracking-[0.12em]">
        HUD Component Gallery
      </h1>
      <p className="mt-1 text-sm" style={{ color: '#8AA0BE' }}>
        Isolation harness — each block on the HUD backdrop, for screenshot review.
      </p>
      <ul className="mt-6 grid max-w-xl gap-2">
        {BLOCKS.map(([slug, label]) => (
          <li key={slug}>
            <Link
              href={`/hud-gallery/${slug}`}
              className="block border px-4 py-2 font-ui uppercase tracking-[0.08em] transition hover:brightness-125"
              style={{ borderColor: 'rgba(80,230,255,0.3)', color: '#19E6FF' }}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
