// No 'use client' directive: only imported by client workspace components.

/**
 * Canonical harness brand marks (operator request, 2026-07-03). Inline SVG, no
 * external fetches, no `id` attributes, so any of these can be inlined
 * anywhere without collisions.
 *
 * EVERY MARK IS REAL VENDOR PATH DATA (ENG-031 W10). Three of them were not:
 * OpenAI's was Tabler's line-art interpretation, and OpenCode's and Grok's
 * were reductions drawn against the vendors' favicons. They are the vendors'
 * own geometry now, reproduced byte for byte.
 *
 * PROVENANCE AND USAGE TERMS LIVE IN `LICENSES/brand/harness-marks.md`, per
 * mark: origin URL, licence of the path data, the vendor's own trademark
 * language, and the date each was fetched. Read it before changing one.
 *
 * These are third-party trademarks used NOMINATIVELY, to identify the product
 * that runs an Agent. Exawatt claims no affiliation or endorsement. Anthropic,
 * OpenAI and xAI each forbid altering their mark, recolouring included; that
 * file records the deviation and the remedy.
 */
import type { CSSProperties } from 'react';
import type { PtyHarness } from '@/types/electron';

export function ClaudeIcon({
  size = 12,
  style,
}: {
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      data-slot="harness-glyph"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      style={style}
      aria-hidden="true"
    >
      <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
    </svg>
  );
}

export function OpenAIIcon({
  size = 12,
  style,
}: {
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      data-slot="harness-glyph"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      fillRule="evenodd"
      style={style}
      aria-hidden="true"
    >
      <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" />
    </svg>
  );
}

/** opencode's square frame mark, the vendor's own geometry normalised into the
 *  24x24 box the other glyphs use. https://opencode.ai */
export function OpenCodeIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      data-slot="harness-glyph"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden="true"
    >
      <path d="M16 6H8v12h8V6zm4 16H4V2h16v20z" />
    </svg>
  );
}

/** xAI's Grok glyph, the vendor's own geometry. https://x.ai */
export function GrokIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      data-slot="harness-glyph"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden="true"
    >
      <path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" />
    </svg>
  );
}

/** Official OpenClaw pixel lobster, reduced from the source's 16×16 grid.
 *  https://github.com/openclaw/openclaw/blob/main/docs/assets/pixel-lobster.svg */
export function OpenClawIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      data-slot="harness-glyph"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <g fill="#3a0a0d">
        <path d="M1 5h1v3H1zM2 4h1v1H2zM2 8h1v1H2zM3 3h1v1H3zM3 9h1v1H3zM4 2h1v1H4zM4 10h1v1H4zM5 2h6v1H5zM11 2h1v1h-1zM12 3h1v1h-1zM12 9h1v1h-1zM13 4h1v1h-1zM13 8h1v1h-1zM14 5h1v3h-1zM5 11h6v1H5zM4 12h1v1H4zM11 12h1v1h-1zM3 13h1v1H3zM12 13h1v1h-1zM5 14h6v1H5z" />
      </g>
      <g fill="#ff4f40">
        <path d="M5 3h6v1H5zM4 4h8v1H4zM3 5h10v3H3zM4 8h8v1H4zM5 9h6v1H5zM5 12h6v1H5zM6 13h4v1H6z" />
      </g>
      <g fill="#ff775f">
        <path d="M1 6h2v1H1zM2 5h1v1H2zM2 7h1v1H2zM13 6h2v1h-2zM13 5h1v1h-1zM13 7h1v1h-1z" />
      </g>
      <g fill="#081016">
        <path d="M6 5h1v1H6zM9 5h1v1H9z" />
      </g>
      <g fill="#f5fbff">
        <path d="M6 4h1v1H6zM9 4h1v1H9z" />
      </g>
    </svg>
  );
}

/** the icon column of the harness registry (see harnesses.ts); shell has
 *  no brand mark */
export function HarnessGlyph({
  harness,
  size = 12,
}: {
  harness: PtyHarness;
  size?: number;
}) {
  if (harness === 'claude') return <ClaudeIcon size={size} />;
  if (harness === 'codex') return <OpenAIIcon size={size} />;
  if (harness === 'opencode') return <OpenCodeIcon size={size} />;
  if (harness === 'grok') return <GrokIcon size={size} />;
  return null;
}
