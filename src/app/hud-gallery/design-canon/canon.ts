/**
 * Content for the design canon briefing at `/hud-gallery/design-canon`.
 *
 * This is a READING surface for an external design partner, and its budget is
 * the point: about a thousand words, top-of-tree only. The first version ran to
 * 4,400 and the operator would not send it. A rule earns a line here only if a
 * designer would build something different without it; everything else lives in
 * the document named beside the section and is one click away.
 *
 * Nothing here is a new decision. Every entry restates
 * `docs/engineering/design-system.md`, `docs/product/marketing.md`,
 * `docs/engineering/decisions/`, or the ENG-004/031/032/036 project docs. When
 * canon moves, this file follows it; it never leads.
 */

export type CanonState = 'canon' | 'open';

export interface CanonSection {
  id: string;
  title: string;
  /** One line under the heading. The conclusion, not a preamble. */
  lede: string;
  /** The canonical document that owns this section. */
  source: string;
}

export interface Rule {
  state: CanonState;
  /** The rule, stated as a rule, in one line. */
  claim: string;
  /** Evidence tag. A few words, or nothing. */
  note?: string;
}

export interface LinkRef {
  label: string;
  url: string;
  /** The job it does. Six words at most. */
  note?: string;
}

export interface LinkGroup {
  id: string;
  title: string;
  links: LinkRef[];
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

export const SECTIONS: CanonSection[] = [
  {
    id: 'product',
    title: 'The product',
    lede: 'One surface, three altitudes, aimed at a fleet size nothing else serves yet.',
    source: 'docs/product/vision.md',
  },
  {
    id: 'kernel',
    title: 'The kernel',
    lede: 'Decided and measured. Cite a rung, or amend the document in the same change.',
    source: 'docs/engineering/design-system.md',
  },
  {
    id: 'board',
    title: 'The Fleet board',
    lede: 'An RTS control grammar on a tactical board. The comp is control, never aesthetic.',
    source: 'decisions 0007, 0023, 0024',
  },
  {
    id: 'site',
    title: 'The public site',
    lede: 'Measured against 16 premium sites. The board is the page.',
    source: 'docs/engineering/projects/website-overhaul.md',
  },
  {
    id: 'references',
    title: 'References',
    lede: 'Everything the canon cites, grouped by the job it does.',
    source: 'docs/references/README.md',
  },
  {
    id: 'open',
    title: 'Open, and yours',
    lede: 'Unshaped on purpose. Here a design decision changes the product instead of matching it.',
    source: 'docs/engineering/roadmap.md',
  },
];

/* -------------------------------------------------------------------------- */
/* The product                                                                 */
/* -------------------------------------------------------------------------- */

export interface Altitude {
  name: string;
  looking: string;
  renderer: string;
}

export const ALTITUDES: Altitude[] = [
  {
    name: 'Agent',
    looking: 'One live Agent and its work.',
    renderer: 'DOM, xterm',
  },
  {
    name: 'Team',
    looking: 'Your Projects and the Agents on them.',
    renderer: 'DOM',
  },
  {
    name: 'Fleet',
    looking: 'All of it, at population scale.',
    renderer: 'WebGL, React Three Fiber',
  },
];

export const PRODUCT_RULES: Rule[] = [
  {
    state: 'canon',
    claim: 'Zoom changes information resolution, not glyph scale.',
  },
  {
    state: 'canon',
    claim:
      'Identity and position carry across an altitude change. Content does not.',
    note: 'a directional cut is the honest fallback',
  },
  {
    state: 'canon',
    claim:
      'WebGL renders the agent world. DOM renders the chrome and owns accessibility.',
    note: 'keyboard-first is a hard requirement',
  },
];

/* -------------------------------------------------------------------------- */
/* The kernel                                                                  */
/* -------------------------------------------------------------------------- */

export interface TypeRung {
  rung: string;
  size: string;
  utility: string;
  use: string;
}

export const TYPE_SCALE: TypeRung[] = [
  {
    rung: 'nano',
    size: '9',
    utility: 'text-chrome-nano',
    use: 'Mono ordinals only',
  },
  {
    rung: 'chrome-micro',
    size: '10',
    utility: 'text-chrome-micro',
    use: 'Tracked micro-labels',
  },
  {
    rung: 'chrome-meta',
    size: '11',
    utility: 'text-chrome-meta',
    use: 'Metadata lines',
  },
  {
    rung: 'chrome-label',
    size: '12',
    utility: 'text-chrome-label',
    use: 'Labels, chips, small buttons',
  },
  {
    rung: 'chrome-title',
    size: '13',
    utility: 'text-chrome-title',
    use: 'Row and panel titles',
  },
  {
    rung: 'body',
    size: '14',
    utility: 'text-sm',
    use: 'Default reading and controls',
  },
  { rung: 'reading', size: '15', utility: 'text-reading', use: 'Prose' },
  { rung: 'title', size: '16', utility: 'text-base', use: 'In-surface titles' },
  { rung: 'section', size: '18', utility: 'text-lg', use: 'Section headings' },
  {
    rung: 'surface-title',
    size: '20',
    utility: 'text-surface-title',
    use: 'A surface h1',
  },
  { rung: 'display', size: '22', utility: 'text-display', use: 'Hero numbers' },
  {
    rung: 'marketing',
    size: '24+',
    utility: 'text-2xl · text-4xl',
    use: 'Site pages only',
  },
  {
    rung: 'site-closing',
    size: '72',
    utility: 'text-7xl',
    use: 'The homepage close, once',
  },
];

export interface ColorChannel {
  channel: string;
  owns: string;
  never: string;
}

export const COLOR_CHANNELS: ColorChannel[] = [
  {
    channel: 'Chrome',
    owns: 'Ground, text, borders, focus, one action accent',
    never: 'Status or identity',
  },
  {
    channel: 'Status',
    owns: 'The five signal roles below',
    never: 'A second action vocabulary',
  },
  {
    channel: 'Consumption',
    owns: 'The calm to hot burn ramp',
    never: 'Status. A hot meter must never read as needing you',
  },
  {
    channel: 'Project identity',
    owns: 'Bars, zone edges, emblems',
    never: 'A lamp, a status, a button',
  },
  {
    channel: 'Agent Source',
    owns: 'The harness glyph on its plate',
    never: 'Any text-bearing element',
  },
];

export interface StatusState {
  state: string;
  meaning: string;
}

export const STATUS_PROTOCOL: StatusState[] = [
  { state: 'Off', meaning: 'Reported at rest: idle, new, quietly waiting' },
  { state: 'Active', meaning: 'Reasoning, streaming, tools' },
  { state: 'Result', meaning: 'Turn finished, result waiting' },
  { state: 'Needs you', meaning: 'Approval, question, credential, Decision' },
  { state: 'Fault', meaning: 'Failed, or intervention required' },
  { state: 'Unreported', meaning: 'The source has said nothing. Not idle' },
];

export const KERNEL_RULES: Rule[] = [
  {
    state: 'canon',
    claim: 'No bracketed pixel size. A missing rung amends the scale first.',
    note: '17 sizes became 23 in one day',
  },
  {
    state: 'canon',
    claim: 'Uppercase only on mono micro-labels. A sentence is never mono.',
  },
  {
    state: 'canon',
    claim: 'Only Active moves. Human gates and faults never pulse.',
    note: 'a fault that flashes trains people to ignore it',
  },
  {
    state: 'canon',
    claim: 'Every state carries three of shape, icon, colour and text.',
    note: 'hue never signals alone',
  },
  {
    state: 'canon',
    claim: 'An absence is never rendered as the quietest available claim.',
    note: 'unreported is its own mark and word',
  },
  {
    state: 'canon',
    claim: 'The interface demonstrates. It does not narrate.',
    note: 'nouns and values, never a thesis sentence',
  },
  {
    state: 'canon',
    claim: 'The reader is never the bottleneck. The tools are.',
    note: 'today 10 agents, tomorrow 10,000',
  },
];

export interface Preset {
  id: string;
  role: string;
}

export const PRESETS: Preset[] = [
  { id: 'Classic', role: 'The shipped dark product, kept for compatibility' },
  { id: 'Air', role: 'Light, airy, selectively translucent. The new default' },
  { id: 'Night', role: 'A calm dark sibling to Air, not a neon reskin' },
];

export const THEME_RULES: Rule[] = [
  {
    state: 'canon',
    claim:
      'A theme owns colour, type and material. Never motion, spacing, density or layout.',
  },
  {
    state: 'canon',
    claim:
      'Glass sits above content, never on it, and always has an opaque fallback.',
  },
];

/* -------------------------------------------------------------------------- */
/* The board                                                                   */
/* -------------------------------------------------------------------------- */

export const BOARD_RULES: Rule[] = [
  {
    state: 'canon',
    claim:
      'Instrument first, stage second: where do I look, then how much is running.',
  },
  {
    state: 'canon',
    claim: 'Top-down orthographic. No free orbit, no immersive world.',
    note: 'tried, and it read as piles of shapes',
  },
  {
    state: 'canon',
    claim:
      'Drag selects, scroll pans, arrows walk units, selection fills one panel.',
    note: 'operator: StarCraft, manipulating units on the map',
  },
  {
    state: 'canon',
    claim: 'The comp is the control model, not the aesthetic.',
    note: 'operator, unprompted: not too militaristic',
  },
  {
    state: 'canon',
    claim: 'Structure organises. Attention overlays and never relocates.',
    note: 'spatial memory needs stable positions',
  },
];

/* -------------------------------------------------------------------------- */
/* The site                                                                    */
/* -------------------------------------------------------------------------- */

export interface Measurement {
  metric: string;
  value: string;
  source: string;
}

export const SITE_MEASUREMENTS: Measurement[] = [
  {
    metric: 'Words above the fold',
    value: 'Under 26',
    source: 'Linear 19, Cursor 10, Palantir 6',
  },
  {
    metric: 'Words on the page',
    value: '320 to 520',
    source: 'the graphic argues, so prose need not',
  },
  {
    metric: 'Screens per chapter',
    value: '1.0 to 1.4',
    source: 'one idea per screen',
  },
  {
    metric: 'Closing type',
    value: '3x to 7x a heading',
    source: 'loudness is spent at the end',
  },
  {
    metric: 'Hero idle motion',
    value: 'Under 5% of pixels per second',
    source: 'GitHub 0%, Vercel 0.6%, Lusion 46%',
  },
  {
    metric: 'Hero DPR',
    value: '1.5',
    source: 'sharpness is the first thing given up',
  },
];

export const SITE_RULES: Rule[] = [
  {
    state: 'canon',
    claim:
      'The altitude ladder is the narrative, so the vision costs zero words.',
  },
  {
    state: 'canon',
    claim:
      'Every panel is a lens over the same board, never a section that replaces it.',
  },
  {
    state: 'canon',
    claim: 'Density and crop carry scale. A counter does not.',
    note: 'Palantir bleeds past all four edges',
  },
  {
    state: 'canon',
    claim: 'Only the state that needs a human is loud.',
  },
  {
    state: 'canon',
    claim: 'Below 768px the layout stacks. It does not shrink.',
    note: 'the phone is a demo surface, not a fallback',
  },
  {
    state: 'canon',
    claim:
      'Copy leads with direction, and never claims a present tense that is false.',
  },
];

/* -------------------------------------------------------------------------- */
/* References                                                                  */
/* -------------------------------------------------------------------------- */

export const LINK_GROUPS: LinkGroup[] = [
  {
    id: 'ref-moodboard',
    title: 'The moodboard',
    links: [
      {
        label: 'Minority Report, Imaginary Forces',
        url: 'https://imaginaryforces.com/project/minority-report',
        note: 'the register, never the likeness',
      },
      {
        label: 'HUDS+GUIS on Minority Report',
        url: 'https://www.hudsandguis.com/home/2010/12/05/minority-report',
      },
      { label: 'HUDS+GUIS', url: 'https://www.hudsandguis.com/' },
      {
        label: 'Sci-Fi Interfaces',
        url: 'https://scifiinterfaces.com/',
      },
      {
        label: '14 top sci-fi designs',
        url: 'https://www.sitepoint.com/14-top-sci-fi-designs-to-inspire-your-next-interface/',
      },
      {
        label: 'The gestural sequence',
        url: 'https://www.youtube.com/watch?v=NwVBzx0LMNQ',
      },
      {
        label: 'The liquid-glass reference',
        url: 'https://www.instagram.com/p/Dba9zHDDEco/',
        note: 'operator: light, airy, high-tech',
      },
    ],
  },
  {
    id: 'ref-games',
    title: 'Command surfaces',
    links: [
      {
        label: 'StarCraft and Command & Conquer',
        url: 'https://en.wikipedia.org/wiki/Real-time_strategy',
        note: 'the control grammar',
      },
      {
        label: 'Supreme Commander',
        url: 'https://en.wikipedia.org/wiki/Supreme_Commander_(video_game)',
      },
      {
        label: 'Homeworld',
        url: 'https://en.wikipedia.org/wiki/Homeworld',
      },
      {
        label: 'EVE Online',
        url: 'https://www.eveonline.com/',
      },
      {
        label: 'Stellaris',
        url: 'https://www.paradoxinteractive.com/games/stellaris',
      },
      {
        label: 'XCOM',
        url: 'https://en.wikipedia.org/wiki/XCOM_(video_game)',
      },
      {
        label: 'Factorio',
        url: 'https://www.factorio.com/',
      },
    ],
  },
  {
    id: 'ref-tools',
    title: 'Tools and register',
    links: [
      {
        label: 'Linear',
        url: 'https://linear.app/',
      },
      {
        label: 'Raycast',
        url: 'https://www.raycast.com/',
      },
      {
        label: 'Granola',
        url: 'https://www.granola.ai/',
        note: 'product as a framed object',
      },
      {
        label: 'Stripe Press',
        url: 'https://press.stripe.com/',
      },
      {
        label: 'Arc',
        url: 'https://arc.net/',
        note: 'one video, one sentence',
      },
      {
        label: 'Apple MacBook Pro',
        url: 'https://www.apple.com/macbook-pro/',
      },
      {
        label: 'Berkeley Graphics',
        url: 'https://berkeleygraphics.com/',
      },
      {
        label: 'Teenage Engineering',
        url: 'https://teenage.engineering/',
      },
      {
        label: 'Datadog',
        url: 'https://www.datadoghq.com/',
      },
      {
        label: 'Grafana',
        url: 'https://grafana.com/',
        note: 'timeline panels',
      },
    ],
  },
  {
    id: 'ref-category',
    title: 'The category, measured',
    links: [
      {
        label: 'Conductor',
        url: 'https://conductor.build/',
      },
      {
        label: 'Superset',
        url: 'https://superset.sh/',
        note: 'ships our thesis in our words',
      },
      {
        label: 'Cursor',
        url: 'https://cursor.com/',
        note: 'the list UI we argue against',
      },
      {
        label: 'Grok agent dashboard',
        url: 'https://x.ai/news/agent-dashboard',
      },
      {
        label: 'Palantir',
        url: 'https://www.palantir.com/',
        note: 'the best thousands-scale board',
      },
      {
        label: 'Anduril',
        url: 'https://www.anduril.com/',
      },
      {
        label: 'Warp',
        url: 'https://www.warp.dev/',
      },
      {
        label: 'Zed',
        url: 'https://zed.dev/',
      },
      {
        label: 'Ghostty',
        url: 'https://ghostty.org/',
        note: '25 words, one screen',
      },
      {
        label: 'Vercel',
        url: 'https://vercel.com/',
        note: 'the reduced-motion pattern',
      },
    ],
  },
  {
    id: 'ref-3d',
    title: 'Live 3D on the web',
    links: [
      {
        label: 'Cloudflare network',
        url: 'https://www.cloudflare.com/network/',
        note: 'the structural template',
      },
      {
        label: 'How we built the GitHub globe',
        url: 'https://github.blog/2020-12-21-how-we-built-the-github-globe/',
      },
      { label: 'Stripe globe', url: 'https://stripe.com/blog/globe' },
      {
        label: 'COBE',
        url: 'https://cobe.vercel.app/',
        note: '5kB, one shader',
      },
      {
        label: 'R3F performance',
        url: 'https://r3f.docs.pmnd.rs/advanced/scaling-performance',
      },
      {
        label: 'Codrops case studies',
        url: 'https://tympanus.net/codrops/',
      },
      { label: 'Modal', url: 'https://modal.com/', note: 'the CTA pattern' },
    ],
  },
  {
    id: 'ref-appearance',
    title: 'Appearance systems',
    links: [
      {
        label: 'VS Code themes',
        url: 'https://code.visualstudio.com/docs/configure/themes',
      },
      {
        label: 'VS Code theme colours',
        url: 'https://code.visualstudio.com/api/references/theme-color',
      },
      {
        label: 'Zed themes',
        url: 'https://zed.dev/docs/themes',
      },
      {
        label: 'Zed appearance',
        url: 'https://zed.dev/docs/appearance',
        note: 'auto over a light and dark pair',
      },
      {
        label: 'JetBrains UI themes',
        url: 'https://www.jetbrains.com/help/idea/user-interface-themes.html',
      },
      {
        label: 'GitHub theme settings',
        url: 'https://docs.github.com/en/get-started/accessibility/managing-your-theme-settings',
      },
      {
        label: 'Figma themes and contrast',
        url: 'https://help.figma.com/hc/en-us/articles/5576781786647-Change-themes-in-Figma',
      },
      {
        label: 'Figma interface scale',
        url: 'https://help.figma.com/hc/en-us/articles/360049549913-Adjust-the-scale-of-the-Figma-UI',
      },
      {
        label: 'Apple materials',
        url: 'https://developer.apple.com/design/human-interface-guidelines/materials',
        note: 'glass above content, with fallbacks',
      },
      {
        label: 'Windows Acrylic',
        url: 'https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic',
      },
      {
        label: 'Electron nativeTheme',
        url: 'https://www.electronjs.org/docs/latest/api/native-theme',
      },
      {
        label: 'Electron window customization',
        url: 'https://www.electronjs.org/docs/latest/tutorial/window-customization',
      },
      {
        label: 'xterm ITheme',
        url: 'https://xtermjs.org/docs/api/terminal/interfaces/itheme/',
      },
      {
        label: 'three.js colour management',
        url: 'https://threejs.org/manual/en/color-management.html',
      },
      {
        label: 'WCAG 2.2',
        url: 'https://www.w3.org/TR/WCAG22/',
      },
      {
        label: 'Design Tokens format',
        url: 'https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/',
      },
      {
        label: 'CSS user preferences',
        url: 'https://www.w3.org/TR/mediaqueries-5/#mf-user-preferences',
      },
      {
        label: 'CSS forced colours',
        url: 'https://www.w3.org/TR/css-color-adjust-1/',
      },
      {
        label: 'Next.js fonts',
        url: 'https://nextjs.org/docs/app/getting-started/fonts',
      },
      {
        label: 'Chromium local fonts',
        url: 'https://developer.chrome.com/docs/capabilities/web-apis/local-fonts',
      },
    ],
  },
  {
    id: 'ref-evidence',
    title: 'Evidence and cautions',
    links: [
      {
        label: 'Map layouts improve recall',
        url: 'https://www2.cs.arizona.edu/~kobourov/recall.pdf',
        note: 'why zones hold position',
      },
      {
        label: 'The frequency of PewPew maps',
        url: 'https://pylos.co/',
        note: 'the failure we design against',
      },
      {
        label: 'Electricity Maps',
        url: 'https://www.electricitymaps.com/',
      },
      {
        label: 'GridStatus',
        url: 'https://www.gridstatus.io/',
      },
      {
        label: 'Fly.io',
        url: 'https://fly.io/',
      },
      {
        label: 'Samsara',
        url: 'https://www.samsara.com/',
      },
      {
        label: 'Oxide',
        url: 'https://oxide.computer/',
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Open                                                                        */
/* -------------------------------------------------------------------------- */

export interface OpenItem {
  title: string;
  detail: string;
  where: string;
}

export const OPEN_ITEMS: OpenItem[] = [
  {
    title: 'The New Agent flow',
    detail:
      'The surface is drawn. The flow, from deciding to work to an Agent running, is not.',
    where: '/hud-gallery/agent-launcher',
  },
  {
    title: 'Homepage positioning',
    detail:
      'It communicates a feeling, not a what and why. Read cold by developers, VCs, founders.',
    where: '/v2',
  },
  {
    title: 'Visualising thousands',
    detail:
      'The control grammar is settled. The picture at four orders of magnitude is not.',
    where: 'the Fleet altitude',
  },
  {
    title: 'Ground, accent, display face',
    detail:
      'Free choices. Off-white plus grotesk plus floating window is the 2026 uniform.',
    where: 'ENG-031, ENG-032',
  },
  {
    title: 'A visual language for goals',
    detail: 'Seven treatments of one tile. Nothing picked.',
    where: '/hud-gallery/goal-visuals',
  },
  {
    title: 'Isometric, and motion on the board',
    detail:
      'A direction, not a decision. It has to survive the board rules above.',
    where: 'ENG-004',
  },
];

export interface WorkbenchRoute {
  href: string;
  title: string;
}

export const WORKBENCH_ROUTES: WorkbenchRoute[] = [
  { href: '/hud-gallery', title: 'The atoms, DOM beside WebGL' },
  {
    href: '/hud-gallery/hero-board',
    title: 'The marketing board, 173 live agents',
  },
  { href: '/hud-gallery/goal-visuals', title: 'Goal visual languages' },
  { href: '/hud-gallery/agent-launcher', title: 'New Agent launcher' },
  { href: '/hud-gallery/fold-close', title: 'Fold and close copy' },
  { href: '/hud-gallery/altitude-scroll', title: 'The pinned altitude scroll' },
  { href: '/v2', title: 'The proposed homepage' },
  { href: '/architecture', title: 'The architecture map' },
];
