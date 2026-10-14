import Image from 'next/image';
import { heroBoardTheme } from '@/components/site/hero-board/hero-board-theme';

/** The figure's shape on the page: an ellipse round the face and the two lit
 *  hands, and the picture gone to the ground at its edge. */
const VIGNETTE =
  'radial-gradient(ellipse 44% 32% at 50% 40%, black 40%, transparent 100%)';

/**
 * The homepage footer's backdrop (ENG-031 W15m): the gesture photograph that
 * opened the band homepage, behind the footer's links (operator 2026-10-14:
 * "Maybe we can keep Tom Cruise but put him under / behind the footer
 * content at the bottom"). The asset and its use are a recorded, accepted
 * operator decision (`docs/product/marketing.md`); this only decides how it is
 * composed.
 *
 * A quiet backdrop to a footer of the ordinary size, never a scene of its own
 * (operator 2026-10-14: "more subtly behind the footer section as the footer
 * section would otherwise normally be laid out. Right now it looks like it's
 * a whole new site"). The picture is the gesture alone, the face between the
 * two lit hands, small enough that the head and both hands stand inside a
 * one-row footer: centred across it, rising from the foot of the page, dimmed,
 * and its edges dissolved so there is no frame to it. The ground it dissolves
 * into is the story's own (the canvas colour of the story's theme,
 * `scroll-experience.tsx`), so the last scene runs into the footer with no
 * seam. Lazy: it is the last thing on the page.
 */
export function FooterGesture() {
  const ground = heroBoardTheme('classic').canvas;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10"
      style={{ background: ground }}
      data-footer-gesture
    >
      {/* the figure rises from the foot of the page: the photograph is cut
          at the chest, 58% down it, by the footer's bottom edge */}
      <div
        className="absolute bottom-0 left-1/2 aspect-[3/2] w-[130vw] -translate-x-1/2 translate-y-[42%] sm:w-[80vw] lg:w-[41rem]"
        style={{ maskImage: VIGNETTE, WebkitMaskImage: VIGNETTE }}
      >
        <Image
          src="/images/hero-bg.png"
          alt=""
          fill
          sizes="(min-width: 1024px) 41rem, (min-width: 640px) 80vw, 130vw"
          className="object-cover opacity-50"
        />
      </div>
    </div>
  );
}
