# Bundled font provenance

Exawatt redistributes the font binaries below under the SIL Open Font
License, Version 1.1. The application loads these committed files directly;
building or running Exawatt does not fetch fonts from Google Fonts or another
font service.

## Exact artifacts

| File                                           | Use                                                       | Exact distribution source                                                                               | SHA-256                                                            |
| ---------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/app/fonts/Exo2-Variable-Latin.woff2`      | Exo 2, normal, variable weight 100–900, Latin subset      | [Google Fonts Exo 2 v26](https://fonts.gstatic.com/s/exo2/v26/7cHmv4okm5zmbtYoK-4.woff2)                | `4a259dde317e08aa5d37e6eb684e222ae833516b2a0fccba36ee5e36224f16be` |
| `src/app/fonts/Geist-Variable-Latin.woff2`     | Geist Sans, normal, variable weight 100–900, Latin subset | [Google Fonts Geist v5](https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwcGFU.woff2)                 | `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1` |
| `src/app/fonts/GeistMono-Variable-Latin.woff2` | Geist Mono, normal, variable weight 100–900, Latin subset | [Google Fonts Geist Mono v6](https://fonts.gstatic.com/s/geistmono/v6/or3nQ6H-1_WfwkMZI_qYFrcdmg.woff2) | `684ad5b531f81d43c1e8c7038262d5db7cdc1f68006e04d6c7769efa8d33c8cc` |
| `public/fonts/Exo2-Medium.ttf`                 | Exo 2 Medium for Troika/R3F scene text                    | [Google Fonts Exo 2 v26](https://fonts.gstatic.com/s/exo2/v26/7cH1v4okm5zmbvwkAx_sfcEuiD8jjPKcPg.ttf)   | `956d939727817620d6b8c3b459d8086151bd6c2b6a48258d134f60a0dcb2b6d2` |

The three application webfonts are the same Google Fonts family revisions and
Latin subset selected by the former `next/font/google` declarations. The
Google Fonts CSS declarations used to resolve the versioned files were:

- `https://fonts.googleapis.com/css2?family=Exo+2:wght@100..900&display=swap`
- `https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap`
- `https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&display=swap`

All four exact artifacts and their hashes were verified on 2026-08-16.

## Authors, upstream source, and licenses

Exo 2 is Copyright 2013 The Exo 2 Project Authors. Its canonical source is
[`googlefonts/Exo-2.0` at `f83ea8a02d3e1d6963ab6e910038521f27e283a2`](https://github.com/googlefonts/Exo-2.0/tree/f83ea8a02d3e1d6963ab6e910038521f27e283a2).
The exact license text is in [`Exo-2-OFL-1.1.txt`](./Exo-2-OFL-1.1.txt), copied
from the Google Fonts catalog at
[`352f6b7d9d6cc4fa9e242b931291d31b21a6dc84`](https://github.com/google/fonts/blob/352f6b7d9d6cc4fa9e242b931291d31b21a6dc84/ofl/exo2/OFL.txt).

Geist Sans and Geist Mono are Copyright 2024 The Geist Project Authors. Their
canonical source is [`vercel/geist-font` release `v1.7.2`](https://github.com/vercel/geist-font/releases/tag/v1.7.2),
tagged at `a73329da8fc62afc917f796555202e4997f79b7c`. The exact shared license text
is in [`Geist-OFL-1.1.txt`](./Geist-OFL-1.1.txt), copied from that release.

Both families are licensed under the SIL Open Font License, Version 1.1. No
font binary was modified.
