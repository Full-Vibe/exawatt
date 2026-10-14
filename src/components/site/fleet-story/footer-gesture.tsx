import Image from 'next/image';

/** The story's stage ground, which the photograph rises out of. */
const NIGHT = '#04060b';

/**
 * The homepage footer's backdrop (ENG-031 W15m): the gesture photograph that
 * opened the band homepage, now under the footer's links (operator
 * 2026-10-14: "Maybe we can keep Tom Cruise but put him under / behind the
 * footer content at the bottom"). The asset and its use are a recorded,
 * accepted operator decision (`docs/product/marketing.md`); this only decides
 * how it is composed.
 *
 * The picture rises out of the story's night at its top edge, so the last
 * scene and the footer are one ground, and sinks back into it under the
 * links, so the type reads on the dark rather than on the figure. Beside the
 * links on a wide screen it spans the footer; on a phone, where the links
 * stack into a tall column, it is a band across the footer's top, whole
 * rather than cropped to a face, and the links start where it fades. Lazy:
 * it is the last thing on the page.
 */
export function FooterGesture() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10"
      style={{ background: NIGHT }}
      data-footer-gesture
    >
      <div className="absolute inset-x-0 top-0 h-[86vw] md:inset-y-0 md:h-auto">
        <Image
          src="/images/hero-bg.png"
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-[center_30%]"
        />
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to bottom, ${NIGHT} 0%, ${NIGHT}00 24%, ${NIGHT}00 46%, ${NIGHT}d9 76%, ${NIGHT} 100%)`,
          }}
        />
      </div>
    </div>
  );
}
