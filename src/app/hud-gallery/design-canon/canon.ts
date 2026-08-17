/**
 * Content for the design canon briefing at `/hud-gallery/design-canon`.
 *
 * This is a READING surface for an external design partner, so it is data
 * rather than prose embedded in JSX: every claim on the page carries the
 * canonical document that owns it, and a stale claim is a one-line edit.
 *
 * Nothing here is a new decision. Every entry is a restatement of
 * `docs/engineering/design-system.md`, `docs/product/marketing.md`,
 * `docs/engineering/decisions/`, the ENG-004/031/032/036 project docs, or the
 * measured research passes those documents were promoted from. When canon
 * moves, this file follows it; it never leads.
 */

export type CanonState = 'canon' | 'open' | 'retired';

export interface CanonSection {
  id: string;
  title: string;
  /** One line under the heading. The conclusion, not a preamble. */
  lede: string;
  /** Canonical documents that own this section's claims. */
  sources: string[];
}

export interface Rule {
  state: CanonState;
  /** The rule, stated as a rule. */
  claim: string;
  /** Why it is the rule. Evidence, operator quote, or the defect that taught it. */
  because: string;
}

export interface LinkRef {
  label: string;
  url: string;
  note: string;
}

export interface LinkGroup {
  id: string;
  title: string;
  lede: string;
  links: LinkRef[];
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

export const SECTIONS: CanonSection[] = [
  {
    id: 'product',
    title: 'What you are designing',
    lede: 'One command surface at three altitudes, aimed at a fleet size no interface in the category serves yet.',
    sources: ['docs/product/vision.md', 'docs/engineering/decisions/0023'],
  },
  {
    id: 'kernel',
    title: 'The kernel',
    lede: 'Type, spacing, colour, status and voice are already decided and measured. Cite a rung or amend the document.',
    sources: ['docs/engineering/design-system.md'],
  },
  {
    id: 'themes',
    title: 'Appearance',
    lede: 'Three presets ship. A theme owns colour, typography and a bounded material recipe, and nothing else.',
    sources: [
      'docs/engineering/projects/theming-and-visual-identity.md (ENG-032)',
    ],
  },
  {
    id: 'board',
    title: 'The Fleet board',
    lede: 'A tactical board with an RTS control grammar. The comp governs control and legibility, never the aesthetic.',
    sources: [
      'docs/engineering/decisions/0007, 0023, 0024',
      'docs/engineering/projects/spatial-operations-board.md (ENG-004)',
    ],
  },
  {
    id: 'site',
    title: 'The public site',
    lede: 'Measured against 16 premium sites. The board is the page, and the vision costs zero words.',
    sources: [
      'docs/engineering/projects/website-overhaul.md (ENG-031)',
      'docs/product/marketing.md',
    ],
  },
  {
    id: 'references',
    title: 'References and comparisons',
    lede: 'Every external reference the canon actually cites, grouped by the job it does.',
    sources: [
      'docs/references/README.md',
      'docs/research/market/2026-08-14-website-design-research.md',
    ],
  },
  {
    id: 'open',
    title: 'Open, and yours',
    lede: 'What is deliberately unshaped, in the order it was named.',
    sources: [
      'docs/research/partner-conversations/2026-08-13-eve-chen-design-scoping.md',
      'docs/engineering/roadmap.md',
    ],
  },
  {
    id: 'workbench',
    title: 'Live studies',
    lede: 'The gallery renders the system. Prototype here before anything reaches a production surface.',
    sources: ['AGENTS.md', 'docs/engineering/design-system.md'],
  },
];

/* -------------------------------------------------------------------------- */
/* Product frame                                                               */
/* -------------------------------------------------------------------------- */

export interface Altitude {
  key: string;
  name: string;
  looking: string;
  renderer: string;
}

export const ALTITUDES: Altitude[] = [
  {
    key: 'near',
    name: 'Agent',
    looking: 'One live Agent, its terminal, its work.',
    renderer: 'DOM and xterm',
  },
  {
    key: 'middle',
    name: 'Team',
    looking: 'Your Projects and the Agents working them, together.',
    renderer: 'DOM, same document as Agent',
  },
  {
    key: 'far',
    name: 'Fleet',
    looking: 'All of it, at population scale.',
    renderer: 'WebGL through React Three Fiber',
  },
];

export const PRODUCT_RULES: Rule[] = [
  {
    state: 'canon',
    claim: 'Zoom changes information resolution, not glyph scale.',
    because:
      'Each altitude shows different data about the same fleet. A literal zoom of one scene was rejected in decision 0007 and again in 0023.',
  },
  {
    state: 'canon',
    claim:
      'The ladder is singular to group to everything, in plain language: Agent, Team, Fleet.',
    because:
      'Vision principle 6, mom-friendly language with power-user depth. Brand-native names (Console, Grid, Field) were considered and rejected by the operator.',
  },
  {
    state: 'canon',
    claim: 'Position and identity carry across an altitude change. Content does not.',
    because:
      'Team to Fleet crosses DOM to WebGL. Cards crossfade into nodes in place, then the camera pulls back. A directional cut is the guaranteed fallback and falling back is a normal outcome, not an error.',
  },
  {
    state: 'canon',
    claim: 'Keyboard-first is a hard requirement, and DOM owns accessibility.',
    because:
      'WebGL is not in the accessibility tree. Dense text, focus order, controls and errors stay DOM-owned; every selectable unit on the board keeps a focusable DOM equivalent.',
  },
  {
    state: 'canon',
    claim: 'Demo Mode is first class, forever.',
    because:
      'The same UI and command layers run over a lower data-source layer, so the product can be shown without live agents. Anything you design must read correctly in both.',
  },
  {
    state: 'canon',
    claim: 'The whole map is visible, including what is not built yet.',
    because:
      'Vision principle 8. Forthcoming capability wears the readiness grammar: muted presence with an explanation, never fake data and never a simulated live capability.',
  },
  {
    state: 'open',
    claim: 'How to visualise thousands.',
    because:
      'The operator: "I\'m not in love with this UI paradigm, there needs to be some way to visualize thousands." Measured ceiling today is about 11 parallel agents with Exawatt against 5 or 6 without. The target is thousands, and the argument is enterprise ROI scaling rather than ambition.',
  },
];

/* -------------------------------------------------------------------------- */
/* Kernel: type, spacing, colour, status, motion, voice                        */
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
    size: '9 / 1',
    utility: 'text-chrome-nano',
    use: 'Ordinals and symbolic glyphs in the densest chrome. Always mono, never words.',
  },
  {
    rung: 'chrome-micro',
    size: '10 / 14',
    utility: 'text-chrome-micro',
    use: 'Uppercase tracked micro-labels. Never the primary reading path.',
  },
  {
    rung: 'chrome-meta',
    size: '11 / 16',
    utility: 'text-chrome-meta',
    use: 'Secondary metadata lines in chrome.',
  },
  {
    rung: 'chrome-label',
    size: '12 / 16',
    utility: 'text-chrome-label',
    use: 'Standard chrome labels, small buttons, chips.',
  },
  {
    rung: 'chrome-title',
    size: '13 / 18',
    utility: 'text-chrome-title',
    use: 'Row and panel titles in chrome.',
  },
  {
    rung: 'body',
    size: '14 / 20',
    utility: 'text-sm',
    use: 'The default reading and control size.',
  },
  {
    rung: 'reading',
    size: '15',
    utility: 'text-reading',
    use: 'Expository prose on settings and consumption surfaces.',
  },
  {
    rung: 'title',
    size: '16',
    utility: 'text-base',
    use: 'Emphasised in-surface titles.',
  },
  {
    rung: 'section',
    size: '18',
    utility: 'text-lg',
    use: 'Section headings.',
  },
  {
    rung: 'surface-title',
    size: '20',
    utility: 'text-surface-title',
    use: "A surface's h1.",
  },
  {
    rung: 'display',
    size: '22',
    utility: 'text-display',
    use: 'Hero numbers and top-level headings on dense surfaces.',
  },
  {
    rung: 'marketing',
    size: '24+',
    utility: 'text-2xl to text-4xl',
    use: 'Marketing and site pages only, never app chrome.',
  },
  {
    rung: 'site-closing',
    size: '72',
    utility: 'text-7xl',
    use: 'The homepage closing band only. The largest type on the page, once.',
  },
];

export const TYPE_RULES: Rule[] = [
  {
    state: 'canon',
    claim: 'New code never introduces a bracketed pixel font size.',
    because:
      'The founding audit measured 17 hardcoded sizes; a day later it was 23. If a rung is missing, the scale gets amended first.',
  },
  {
    state: 'canon',
    claim:
      'Uppercase is legal only on mono micro-labels at 11px or below with wide tracking.',
    because:
      'Never on sentences or headings. All-caps everywhere plus a wide space-font is exactly what made the early product read cheap.',
  },
  {
    state: 'canon',
    claim: 'A sentence is never set in mono.',
    because:
      'Tracked uppercase mono reads as diagnostic output, and every sentence beside it was written for a person.',
  },
  {
    state: 'canon',
    claim: 'A label a stranger must read to understand the surface is a typographic element.',
    because:
      'The marketing board shipped its Project names at the 10px mono micro rung and the operator read them as "mono-spaced and too small". They are now the 18px section rung.',
  },
  {
    state: 'canon',
    claim: 'Two weights do the work: medium for labels and controls, semibold for titles.',
    because: 'Bold is rare and stays rare.',
  },
];

export const SPACING_RULES: Rule[] = [
  {
    state: 'canon',
    claim:
      'Tailwind 4px grid, with the steps in real use being 2, 4, 6, 8, 10, 12, 16, 20, 24 and 32.',
    because:
      'Arbitrary bracketed spacing is as off-scale as a bracketed font size.',
  },
  {
    state: 'canon',
    claim:
      'Default answers for a new surface: card padding p-4 operational or px-5 py-4 for prose, siblings gap-2, sections space-y-6, page gutter px-8.',
    because: 'Measured from what the shipped app already does correctly.',
  },
  {
    state: 'canon',
    claim:
      'Radii: 4px is the chrome default, 6px buttons and inputs, 8px panels and cards, full for pills and dots.',
    because:
      'Larger radii are rare and stay rare. HUD panels may use the 12px chamfer instead, and chamfer never mixes with rounded corners on one element.',
  },
];

export interface ColorChannel {
  channel: string;
  owns: string;
  neverOwns: string;
}

export const COLOR_CHANNELS: ColorChannel[] = [
  {
    channel: 'Semantic chrome',
    owns: 'Ground, surfaces, text hierarchy, borders, focus, and the one action accent.',
    neverOwns: 'Status meaning or Project identity.',
  },
  {
    channel: 'Status',
    owns: 'The five D40 signal roles: Off, Active, Result, Needs you, Fault.',
    neverOwns: 'A second action vocabulary. Themes may repaint the roles, never redefine or reprioritise them.',
  },
  {
    channel: 'Consumption',
    owns: 'The calm to mid to warm to hot ramp, plus three hatch meanings: unreported, projection, expiry.',
    neverOwns:
      'Status. The ramp is deliberately disjoint so a hot meter can never read as an Agent needing you.',
  },
  {
    channel: 'Project identity',
    owns: 'Thin vertical bars, zone edges, emblems.',
    neverOwns: 'A lamp, a status, or a button colour. Identity only.',
  },
  {
    channel: 'Agent Source identity',
    owns: 'The harness glyph inside a fixed dark instrument plate.',
    neverOwns:
      'Any text-bearing ancestor. A brand colour on a name is a contrast regression, and the Air preset is the oracle for it.',
  },
];

export interface StatusState {
  state: string;
  meaning: string;
  priority: string;
}

export const STATUS_PROTOCOL: StatusState[] = [
  { state: 'Off', meaning: 'Idle, new, or quietly waiting.', priority: '0' },
  { state: 'Active', meaning: 'Reasoning, streaming, tools.', priority: '1' },
  { state: 'Result', meaning: 'Turn finished, result waiting.', priority: '2' },
  {
    state: 'Needs you',
    meaning: 'Approval, question, credential, or Decision.',
    priority: '3',
  },
  {
    state: 'Fault',
    meaning: 'Failed, or intervention required.',
    priority: '4',
  },
];

export const STATUS_RULES: Rule[] = [
  {
    state: 'canon',
    claim: 'Only Active moves. The half-fill turns once every 2.4 seconds.',
    because:
      'Human gates and faults never pulse. A calm attention mark is a static amber dot in a circle with a tooltip, not an alarm.',
  },
  {
    state: 'canon',
    claim:
      'Every state carries at least three of shape, icon, colour and text.',
    because:
      'Hue never carries the signal alone. Colour-only signalling was retired precisely because it is not learnable.',
  },
  {
    state: 'canon',
    claim: 'Glyphs render in a fixed box, so a state change never nudges a row.',
    because:
      'Constant footprint. The same rule applies to any reserved control: it keeps its box even when its visible state disappears.',
  },
  {
    state: 'canon',
    claim: 'Do not invent new status marks.',
    because:
      'The protocol owns the vocabulary, the priority and the derivation. A theme owns only the paint.',
  },
];

export const MOTION_RULES: Rule[] = [
  {
    state: 'canon',
    claim:
      'House easing is cubic-bezier(0.22, 1, 0.36, 1); interaction transitions run 160 to 260ms.',
    because: 'Measured from what shipped and survived operator review.',
  },
  {
    state: 'canon',
    claim: 'Every animation has a reduced-motion gate. No exception exists today.',
    because:
      'Do not create the first. Motion also parks under low power and on hidden tabs.',
  },
  {
    state: 'canon',
    claim: 'A theme never owns motion, spacing, geometry or density.',
    because:
      'It owns colour, application typography and a bounded material recipe. It may not rearrange or resize the interface.',
  },
  {
    state: 'canon',
    claim:
      'Motion state a media query must be able to override travels as a CSS custom property, never an inline style.',
    because:
      'An inline opacity outranked the reduced-motion utility, and a scroll-driven fade left a phone with two invisible panels.',
  },
];

export const VOICE_RULES: Rule[] = [
  {
    state: 'canon',
    claim:
      'Every string is written for a production user of a top-tier product. The interface demonstrates, it does not narrate.',
    because:
      'Operator, 2026-08-03: "We need to always be designing for production audiences, not spewing documentation text into the app."',
  },
  {
    state: 'canon',
    claim: 'Nouns, values, states and short labels. No thesis sentences, no rhetorical framing, no self-reference.',
    because:
      'A surface never explains what it is or why it exists. When tempted to explain, show the product state that answers the question.',
  },
  {
    state: 'canon',
    claim: 'Generated text leads with the conclusion in its first line.',
    because:
      'A first-time viewer of the Team and Roadmap altitudes said "there\'s a lot of good info here, but I don\'t even know where to look." That is a hierarchy defect, so the fix is ranking, not deleting.',
  },
  {
    state: 'canon',
    claim: 'The reader is never the bottleneck. The tools are.',
    because:
      'Copy never tells a user what they cannot do. Trajectory, today 10 and tomorrow 10,000, is what makes a big number honest.',
  },
  {
    state: 'canon',
    claim: 'Honesty is the content, apology is not the tone.',
    because:
      'A disclosure page written as a warning label scared off users. Headings state a fact or a control, and every outbound behaviour names its switch.',
  },
  {
    state: 'canon',
    claim: 'Never trade a true safety signal for a warmer sentence.',
    because:
      'De-apologising once rewrote the one true permissions warning into a false reassurance. Tone is negotiable, facts are not.',
  },
  {
    state: 'canon',
    claim: 'No em dashes in public-facing copy.',
    because: 'Operator standing rule. It reads as machine-written.',
  },
];

/* -------------------------------------------------------------------------- */
/* Appearance                                                                  */
/* -------------------------------------------------------------------------- */

export interface Preset {
  id: string;
  role: string;
  typography: string;
}

export const PRESETS: Preset[] = [
  {
    id: 'exawatt-classic-dark',
    role: 'Compatibility rendering of the shipped dark product.',
    typography: 'Exo 2 shell and body, Geist for UI and display, Geist Mono for data.',
  },
  {
    id: 'exawatt-air-light',
    role: 'The light, airy, selectively translucent direction.',
    typography: 'System shell and UI, Geist display, Geist Mono data.',
  },
  {
    id: 'exawatt-night-dark',
    role: 'A calmer dark sibling to Air. Not a neon reskin of Classic.',
    typography: 'Geist shell, UI and display, Geist Mono data.',
  },
];

export const THEME_RULES: Rule[] = [
  {
    state: 'canon',
    claim:
      'Appearance is one app-global personal preference. Switching Workspace, Project, Agent or Session never switches it.',
    because:
      'Auto follows the OS across a remembered light and dark pair; Manual pins one preset. The Zed and GitHub model, not a fourth theme called Auto.',
  },
  {
    state: 'canon',
    claim:
      'Theme payloads are declarative data. No JavaScript, no CSS payload, no URL, no font binary.',
    because:
      'The desktop renderer is privileged. This is the trust boundary a future theme marketplace would publish into.',
  },
  {
    state: 'canon',
    claim:
      'Glass is a sparse functional layer for controls and navigation above content, never a content-layer decoration.',
    because:
      "Apple's own guidance, and the only reading of the operator's liquid-glass reference that survives contact with dense operations UI. Every translucent role carries an opaque fallback that still passes contrast.",
  },
  {
    state: 'canon',
    claim:
      'OS contrast, forced colours, inversion and reduced transparency are automatic inputs, not saved preferences.',
    because:
      'They may simplify paint. They never change layout or semantic state.',
  },
  {
    state: 'canon',
    claim:
      'Home and the public Architecture map sit outside the app appearance canvas.',
    because:
      'Incident 0004: a fixed public surface inherited an app preference and reflowed the same heading under each theme. Public surfaces name their face as a literal, and a typography-stability eval holds the line.',
  },
];

/* -------------------------------------------------------------------------- */
/* Board                                                                       */
/* -------------------------------------------------------------------------- */

export const BOARD_RULES: Rule[] = [
  {
    state: 'canon',
    claim:
      'The board is an instrument and a stage, ranked: situational awareness first, scale awe and command second.',
    because:
      'It is not a map of org structure. Structure and belonging were considered as the organising idea and not chosen.',
  },
  {
    state: 'canon',
    claim:
      'Top-down orthographic is the clarity-first default. A shallow fixed angle is an alternate presentation. No free orbit.',
    because:
      'The immersive free-camera world was tried and killed: sparse Projects became tiny islands, depth competed with labels, and decorative world-building did not improve command decisions.',
  },
  {
    state: 'canon',
    claim:
      'RTS control grammar: drag draws a selection box, scroll pans, arrows walk units, selection populates one command panel.',
    because:
      'Operator: "I\'m envisioning Starcraft manipulating units on the map." Adopted coherently rather than piecemeal.',
  },
  {
    state: 'canon',
    claim: 'The RTS comp governs control and legibility, never the aesthetic.',
    because:
      'Operator, unprompted, twice: "not that I want it to be, like, too militaristic" and "it doesn\'t have to be geeky and game-like though. I\'m just giving you kind of the UI motif."',
  },
  {
    state: 'canon',
    claim:
      'Structure organises; attention overlays and never relocates. A callout is anchored to its subject.',
    because:
      'Projects hold stable positions so spatial memory survives. The audit found the hero blocked callout floating top-centre while its subject sat two rows away.',
  },
  {
    state: 'canon',
    claim: 'Zoom decides individuality, and mass stays legible at every step.',
    because:
      'Agents are drawn individually by default and agglomerate only when very zoomed out. An aggregate that hides how much is running defeats the purpose.',
  },
  {
    state: 'canon',
    claim: 'Work visibly happens, without adding resting animation.',
    because:
      'Liveness rides the existing rule that only Active moves, plus genuine state transitions: a turn completing, an agent arriving or leaving.',
  },
  {
    state: 'canon',
    claim: 'The board must be learnable without a manual.',
    because:
      'The audit counted at least five fills against three named header states with no legend on screen. A surface that encodes status in colour owes the viewer a way to learn it.',
  },
  {
    state: 'canon',
    claim: 'Agents are hex or octagon tiles; Projects are circular population boundaries.',
    because:
      'Operator direction, amended at gallery review 2026-08-03. Zones size to their population, with no empty pools.',
  },
  {
    state: 'open',
    claim: 'The isometric direction, and any animated treatment of it.',
    because:
      'Recorded as an open design direction after the 2026-08-13 scoping call, deliberately not shaped. The Escher exchange in the same conversation was a joke and is not a direction.',
  },
];

/* -------------------------------------------------------------------------- */
/* Site                                                                        */
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
    source: 'Linear 19, Cursor 10, Raycast 26, Conductor 23, Palantir 6',
  },
  {
    metric: 'Total words, picture-led page',
    value: '320 to 520',
    source:
      'The 1,200 to 1,700 band holds for pages that argue in prose. A page whose argument is a graphic that changes does not need to re-establish context in sentences.',
  },
  {
    metric: 'Screens per chapter',
    value: '1.0 to 1.4',
    source: 'No exception across the 16-site cohort. One idea per screen.',
  },
  {
    metric: 'Closing CTA type',
    value: '3x to 7x the section heading, 10 words or fewer',
    source: 'Loudness is spent at the end, never the beginning.',
  },
  {
    metric: 'Scroll-jacking',
    value: 'Zero',
    source: 'No GSAP ScrollTrigger or Locomotive detected across all 16 sites.',
  },
  {
    metric: 'Hero idle motion',
    value: 'Under 2 of 255 mean delta, under 5% of pixels per second',
    source:
      'GitHub 0.0%, Vercel 0.6%, Spline 1.4%, Stripe 9 to 20%, Lusion 46%. Above 10% is showreel territory.',
  },
  {
    metric: 'Hero device pixel ratio',
    value: '1.5',
    source:
      'GitHub, Vercel, Modal, Warp, Lusion and Oryzo all cap there on desktop and mobile. Sharpness is the first thing experts give up.',
  },
  {
    metric: 'Antialiasing on the hero canvas',
    value: 'Off',
    source:
      'Both Stripe and GitHub independently reported this the single largest win, compensated in shader.',
  },
];

export const SITE_RULES: Rule[] = [
  {
    state: 'canon',
    claim: 'The altitude ladder is the narrative, and the vision costs zero words.',
    because:
      'The three altitudes are inherently a camera move, so the scroll that travels them is at once the most cinematic device available and the clearest explanation of the product. No site in the reference study has this.',
  },
  {
    state: 'canon',
    claim:
      'The board is the page. Every panel is a lens over the same graphic, not a section that replaces it.',
    because:
      'Operator: "I don\'t see why we shouldn\'t keep it onscreen to help communicate some of the other points too, like security, spend." A highlight says which marks lead; a lens says what the marks mean.',
  },
  {
    state: 'canon',
    claim: 'Every lens reads the product\'s own data and the product\'s own colours.',
    because:
      'A harness is the same colour on the homepage as it is in the launcher. There is no second derivation of anything on the site.',
  },
  {
    state: 'canon',
    claim: 'A mechanism list belongs in the docs. A panel keeps one kicker, one two-sentence claim, one line of real state.',
    because:
      'The assembled page reached 1,216 words, inside the measured band, and the operator would not read it. Cut volume, never register.',
  },
  {
    state: 'canon',
    claim: 'The page is a band system: a band is data plus one component.',
    because:
      'Open source, security, privacy, observability and cost may each be promoted to a first-class concept later, and promoting one must never be a page rewrite.',
  },
  {
    state: 'canon',
    claim: 'Cinema in the visual layer, plain English in the text layer, never both loud at once.',
    because:
      "Palantir's fold is a movie with six words on it. The failure mode is a movie with a poetic sentence on it, which is two mysteries stacked.",
  },
  {
    state: 'canon',
    claim: 'Below 768px the layout stacks. It does not shrink.',
    because:
      'The phone is a demo surface the operator holds up at conferences, not a fallback. Scrollytelling that overlays type on a graphic is a wide-viewport layout.',
  },
  {
    state: 'canon',
    claim: 'Reduced motion gets the same composition, frozen, with zero layout shift.',
    because:
      "Vercel's pattern is the cleanest measured: canvas count drops to zero and a static substitute with an identical silhouette takes its place.",
  },
  {
    state: 'canon',
    claim: 'The 3D key switch comes off the site, and CTAs stay flat DOM.',
    because:
      'Nothing in the measured set makes the primary conversion action a 3D mesh.',
  },
  {
    state: 'canon',
    claim: 'Build the command register. Never the likeness.',
    because:
      'The Minority Report reference is delivered by handing the reader the board, not by showing them somebody else at one. A stock gestural-HUD image is the generic-AI sameness the research names.',
  },
  {
    state: 'canon',
    claim: 'Aspiration is half the message.',
    because:
      'Operator: a page pinned to today\'s feature set is out of date tomorrow. The future tense is a first-class register. The narrow exception: never a false specific claim about present behaviour, above all on trust surfaces.',
  },
  {
    state: 'canon',
    claim: 'One fixed register on the marketing site. No dynamic dark mode.',
    because: 'The complexity is not worth the bug surface.',
  },
  {
    state: 'open',
    claim: 'Ground, accent, and the display face.',
    because:
      'Geist Sans is the interim, not the answer. Warm off-white with a neutral grotesk and a floating app window is the single most crowded look of 2026, which makes dark the contrarian move among AI companies. Whatever is chosen must be self-hosted and survive the public-surface boundary.',
  },
];

export const SCALE_RULES: Rule[] = [
  {
    state: 'canon',
    claim: 'Density and crop carry scale. A counter does not.',
    because: "Palantir's board bleeds past all four edges and shows no number anywhere.",
  },
  {
    state: 'canon',
    claim: 'Only the state that needs a human is loud.',
    because:
      'Uniform emphasis at density is a "pewpew map", the documented Norse and Kaspersky failure.',
  },
  {
    state: 'canon',
    claim: 'Under every big number, one plain sentence that resolves it.',
    because:
      'The shape is a grid operator\'s: "1,412 agents running / 3 need you / everything else is on track." Never write the threat.',
  },
  {
    state: 'canon',
    claim: 'Keep one named unit lit through the entire zoom-out, and keep the far view operable.',
    because:
      'Powers of Ten never loses the picnic; Frostpunk never loses the generator. A far view that is only a picture is a screensaver.',
  },
  {
    state: 'canon',
    claim: 'Every synthetic frame carries its own stamp inside the asset.',
    because: 'A cropped screenshot stays honest wherever it travels.',
  },
  {
    state: 'canon',
    claim: 'Warmth comes from a person and a real name in the frame, not from softening the data.',
    because:
      'Samsara leads with one operator at golden hour. Fly.io draws winged desktop towers. Neither dilutes the numbers.',
  },
  {
    state: 'canon',
    claim: 'Never let a count stand alone.',
    because:
      'A 2,000-agent swarm demo earned the headline "AI agents capable of shoddy code at scale" with an 88% CI failure rate as the retort.',
  },
];

/* -------------------------------------------------------------------------- */
/* References                                                                  */
/* -------------------------------------------------------------------------- */

export const LINK_GROUPS: LinkGroup[] = [
  {
    id: 'ref-fui',
    title: 'The founding moodboard',
    lede: 'Where the HUD structure came from. Amended since: the type got de-geeked, and dark is no longer assumed.',
    links: [
      {
        label: 'Minority Report, Imaginary Forces concept art',
        url: 'https://imaginaryforces.com/project/minority-report',
        note: 'The operator\'s long-running reference for the product itself: "I want to be more like Tom Cruise manipulating my whole command fleet." The register, never the likeness.',
      },
      {
        label: 'HUDS+GUIS breakdown of Minority Report',
        url: 'https://www.hudsandguis.com/home/2010/12/05/minority-report',
        note: 'Information layered in space, direct manipulation, large-format displays.',
      },
      {
        label: 'HUDS+GUIS',
        url: 'https://www.hudsandguis.com/',
        note: 'Film and TV HUD breakdowns, general reference.',
      },
      {
        label: 'Sci-Fi Interfaces',
        url: 'https://scifiinterfaces.com/',
        note: 'Analysis rather than screenshots. Useful for why an interface reads as competent.',
      },
      {
        label: '14 top sci-fi designs',
        url: 'https://www.sitepoint.com/14-top-sci-fi-designs-to-inspire-your-next-interface/',
        note: 'Collected in the original reference sweep. Treat as raw stimulus, not direction.',
      },
      {
        label: 'Minority Report interface clip',
        url: 'https://www.youtube.com/watch?v=NwVBzx0LMNQ',
        note: 'The gestural sequence itself.',
      },
      {
        label: 'The operator\'s liquid-glass reference',
        url: 'https://www.instagram.com/p/Dba9zHDDEco/',
        note: 'Light, airy, high-tech, selectively glass-like. Supplied 2026-08-02 with "not meant to constrain us" attached.',
      },
    ],
  },
  {
    id: 'ref-games',
    title: 'Games and command surfaces',
    lede: 'Named for control grammar and for how they hold thousands of units legible.',
    links: [
      {
        label: 'StarCraft and Command & Conquer unit control',
        url: 'https://en.wikipedia.org/wiki/Real-time_strategy',
        note: 'The comp the operator named for the board: band select, re-vectoring, a selection panel. Control model only, and explicitly not the military aesthetic.',
      },
      {
        label: 'Supreme Commander strategic zoom',
        url: 'https://en.wikipedia.org/wiki/Supreme_Commander_(video_game)',
        note: 'The far view stays operable rather than becoming a picture. Cited in the visualising-thousands rules.',
      },
      {
        label: 'Homeworld sensors manager',
        url: 'https://en.wikipedia.org/wiki/Homeworld',
        note: 'A schematic altitude that is still a control surface.',
      },
      {
        label: 'EVE Online',
        url: 'https://www.eveonline.com/',
        note: 'Fleet management and overview panels holding 1000+ entities on screen.',
      },
      {
        label: 'Stellaris',
        url: 'https://www.paradoxinteractive.com/games/stellaris',
        note: 'Galaxy map with zoom levels and entity status at a glance. A model for fleet to individual transition.',
      },
      {
        label: 'XCOM',
        url: 'https://en.wikipedia.org/wiki/XCOM_(video_game)',
        note: 'Base view as the morning check-in: status cards, resource bars, personnel.',
      },
      {
        label: 'Factorio',
        url: 'https://www.factorio.com/',
        note: 'Information density done right. Every signal means something, no decoration for decoration\'s sake.',
      },
    ],
  },
  {
    id: 'ref-tools',
    title: 'Tools we are measured against',
    lede: 'The register for a surface an operator lives in all day.',
    links: [
      {
        label: 'Linear',
        url: 'https://linear.app/',
        note: 'The gold standard for a tool that does not waste your time. Also the README pattern: the thesis lives in one crafted artifact at its own URL.',
      },
      {
        label: 'Linear display options',
        url: 'https://linear.app/docs/display-options',
        note: 'Cited in the appearance research for how a dense tool exposes visual preference.',
      },
      {
        label: 'Raycast',
        url: 'https://www.raycast.com/',
        note: 'The register for copy that touches the product itself: compressed, keyboard-and-milliseconds intimacy.',
      },
      {
        label: 'Datadog',
        url: 'https://www.datadoghq.com/',
        note: 'Dense but readable dashboards. Its group labels also model rule one of scale: show the count inside the product chrome, never claim it.',
      },
      {
        label: 'Grafana',
        url: 'https://grafana.com/',
        note: 'Time-series panels and flexible layouts, for the activity and timeline views.',
      },
      {
        label: 'Berkeley Graphics',
        url: 'https://berkeleygraphics.com/',
        note: 'The artifact strategy: specifications as seduction. Market with engineering artifacts rather than adjectives.',
      },
      {
        label: 'Granola',
        url: 'https://www.granola.ai/',
        note: 'Product as a framed object, with real window chrome and a genuine shadow, cropped so it reads as a window onto something larger.',
      },
      {
        label: 'Stripe Press',
        url: 'https://press.stripe.com/',
        note: 'Editorial calm. Type does the work and motion is scarce.',
      },
      {
        label: 'Arc',
        url: 'https://arc.net/',
        note: 'One video, one screen, one sentence, in 270 words total.',
      },
      {
        label: 'Apple MacBook Pro page',
        url: 'https://www.apple.com/macbook-pro/',
        note: 'One band, one idea, full width.',
      },
      {
        label: 'Teenage Engineering',
        url: 'https://teenage.engineering/',
        note: 'The aesthetic ceiling, recorded with its caveat: it works because hardware photographs. A desktop app needs an equivalent visual object, which for us is the board.',
      },
    ],
  },
  {
    id: 'ref-competitors',
    title: 'The category, as measured',
    lede: 'Direct competitors and the sites the launch page was benchmarked against on 2026-08-14.',
    links: [
      {
        label: 'Conductor',
        url: 'https://conductor.build/',
        note: 'Nearest competitor. 7.2 screens, about 450 words, mono-first on white, deliberately unserious voice. Our scale positioning is a legible wedge against exactly that tone.',
      },
      {
        label: 'Superset',
        url: 'https://superset.sh/',
        note: 'Ships the control thesis and the 100-agent number in near-identical language. Noted, not routed around: overlap validates the direction and copy is judged on its own merits.',
      },
      {
        label: 'Cursor',
        url: 'https://cursor.com/',
        note: 'A static composited product screenshot as the hero. 1,656 words. Its agent list UI is the frame we are arguing against.',
      },
      {
        label: 'Grok agent dashboard',
        url: 'https://x.ai/news/agent-dashboard',
        note: 'The teammate framing the category is converging on, with the ceiling attached: the list UI caps at five to seven.',
      },
      {
        label: 'Palantir',
        url: 'https://www.palantir.com/',
        note: 'The mystery armature, and the closest reference found for showing thousands: a board where 38 of 40 cards are quiet and two carry a glow.',
      },
      {
        label: 'Anduril',
        url: 'https://www.anduril.com/',
        note: 'Epic-thesis mechanics: a claim about the world before any product claim. Also the cautionary number: 104 words, great feeling, no downloads.',
      },
      {
        label: 'Warp',
        url: 'https://www.warp.dev/',
        note: 'The cautionary middle at 534 words: vague and unclear at once.',
      },
      {
        label: 'Zed',
        url: 'https://zed.dev/',
        note: 'Pairs "Download now" with "Clone source", which is stronger and quieter than a star badge.',
      },
      {
        label: 'Ghostty',
        url: 'https://ghostty.org/',
        note: 'One screen, about 25 words, and it still communicates.',
      },
      {
        label: 'Vercel',
        url: 'https://vercel.com/',
        note: 'The cleanest reduced-motion fallback measured, and the shader hero that replaced a three.js one.',
      },
    ],
  },
  {
    id: 'ref-3d',
    title: 'Live 3D on the web',
    lede: 'The moat is empty because everyone priced it and declined. A janky live board is strictly worse than a screenshot.',
    links: [
      {
        label: 'Cloudflare network map',
        url: 'https://www.cloudflare.com/network/',
        note: 'The best structural template found: many identical small units, a few highlighted, DOM cards anchored to 3D positions, the object cropped by the fold, under 1MB.',
      },
      {
        label: 'How we built the GitHub globe',
        url: 'https://github.blog/2020-12-21-how-we-built-the-github-globe/',
        note: 'Still the best engineering write-up in the field, now a historical artifact: the globe is retired and its replacement has exactly zero idle motion.',
      },
      {
        label: 'Stripe globe write-up',
        url: 'https://stripe.com/blog/globe',
        note: 'The other canonical reference, also retired. Source of the antialias-off finding.',
      },
      {
        label: 'COBE',
        url: 'https://cobe.vercel.app/',
        note: '5kB, one fragment shader, about 60% faster than the three.js globe it replaced. The existence proof that a live 3D hero need not mean three.js.',
      },
      {
        label: 'React Three Fiber performance scaling',
        url: 'https://r3f.docs.pmnd.rs/advanced/scaling-performance',
        note: 'Our stack. Instanced meshes, demand frameloop, and where the budget actually goes.',
      },
      {
        label: 'Cerebrium case study, Codrops',
        url: 'https://tympanus.net/codrops/',
        note: 'Invisible infrastructure rendered as touchable 3D objects, one shared HDRI unifying every scene. The closest analogue to what we want, and they reverted from WebGPU over a 20-second shader compile.',
      },
      {
        label: 'Modal',
        url: 'https://modal.com/',
        note: 'The CTA pattern to copy: headline, subhead, two buttons, and the object begins immediately underneath, cropped by the next section.',
      },
    ],
  },
  {
    id: 'ref-appearance',
    title: 'Appearance systems and platform contracts',
    lede: 'Primary sources behind the theme contract. The recurring pattern is coordinated appearance settings, not one unlimited style payload.',
    links: [
      {
        label: 'VS Code themes',
        url: 'https://code.visualstudio.com/docs/configure/themes',
        note: 'The named product reference. Colour, file-icon and product-icon themes are separate systems: the word "theme" being singular does not make it one package.',
      },
      {
        label: 'VS Code colour theme authoring',
        url: 'https://code.visualstudio.com/api/extension-guides/color-theme',
        note: 'Live preview while moving through the picker, and sparse overrides on top of a named theme.',
      },
      {
        label: 'VS Code theme colour reference',
        url: 'https://code.visualstudio.com/api/references/theme-color',
        note: 'The full role vocabulary, for comparison against ours.',
      },
      {
        label: 'VS Code terminal appearance',
        url: 'https://code.visualstudio.com/docs/terminal/appearance',
        note: 'Terminal ANSI colours come from the theme but stay independently overridable, and terminal typography is a separate family.',
      },
      {
        label: 'Zed themes',
        url: 'https://zed.dev/docs/themes',
        note: 'A versioned declarative JSON schema, one family holding named light and dark themes.',
      },
      {
        label: 'Zed theme schema v0.2.0',
        url: 'https://zed.dev/schema/themes/v0.2.0.json',
        note: 'Explicitly includes UI roles and terminal ANSI roles.',
      },
      {
        label: 'Zed appearance',
        url: 'https://zed.dev/docs/appearance',
        note: 'Automatic mode over independently stored light and dark selections. This is the behaviour our Auto mode copies.',
      },
      {
        label: 'Zed visual customization',
        url: 'https://zed.dev/docs/visual-customization',
        note: 'Font settings sit adjacent to, not inside, the colour theme.',
      },
      {
        label: 'JetBrains UI themes',
        url: 'https://www.jetbrains.com/help/idea/user-interface-themes.html',
        note: 'UI theme distinct from editor colour scheme, with OS sync and explicit high contrast.',
      },
      {
        label: 'GitHub theme settings',
        url: 'https://docs.github.com/en/get-started/accessibility/managing-your-theme-settings',
        note: 'The other confirmation of the auto-over-a-pair model.',
      },
      {
        label: 'Figma themes and enhanced contrast',
        url: 'https://help.figma.com/hc/en-us/articles/5576781786647-Change-themes-in-Figma',
        note: 'Contrast as a layer over both themes, rather than doubling every preset into a high-contrast twin.',
      },
      {
        label: 'Figma interface scale',
        url: 'https://help.figma.com/hc/en-us/articles/360049549913-Adjust-the-scale-of-the-Figma-UI',
        note: 'Scale kept separate from light, dark and system appearance. Ours is 90 to 120% over named type rungs.',
      },
      {
        label: 'Apple materials guidance',
        url: 'https://developer.apple.com/design/human-interface-guidelines/materials',
        note: 'Glass as a functional layer above content, with required opaque and reduced-transparency alternatives.',
      },
      {
        label: 'Windows Acrylic guidance',
        url: 'https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic',
        note: 'Documents the automatic fallbacks a translucent surface owes: high contrast, transparency off, unsupported hardware, remote sessions, battery saver.',
      },
      {
        label: 'Electron nativeTheme',
        url: 'https://www.electronjs.org/docs/latest/api/native-theme',
        note: 'System, light and dark plus high contrast, inverted colours and differentiate-without-colour. Native menus and renderer tokens must not disagree.',
      },
      {
        label: 'Electron window customization',
        url: 'https://www.electronjs.org/docs/latest/tutorial/window-customization',
        note: 'Why "glass" cannot be one API in a portable payload: macOS vibrancy and Windows backdrop materials are different windows APIs, and the hosted renderer has neither.',
      },
      {
        label: 'xterm ITheme',
        url: 'https://xtermjs.org/docs/api/terminal/interfaces/itheme/',
        note: 'The terminal palette a theme must supply: background, foreground, cursor, selection and the ANSI 16.',
      },
      {
        label: 'three.js colour management',
        url: 'https://threejs.org/manual/en/color-management.html',
        note: 'Theme values enter WebGL through one colour-management-aware adapter. Copying linear values from DOM tokens produces mismatches.',
      },
      {
        label: 'WCAG 2.2',
        url: 'https://www.w3.org/TR/WCAG22/',
        note: '4.5:1 for text, 3:1 for large text and meaningful UI boundaries, and a non-colour channel for meaning.',
      },
      {
        label: 'Design Tokens Community Group format',
        url: 'https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/',
        note: 'Typed tokens, groups, aliases and modern colour spaces. A useful interchange reference; adopting it wholesale would be a product decision, not a default.',
      },
      {
        label: 'CSS user-preference media features',
        url: 'https://www.w3.org/TR/mediaqueries-5/#mf-user-preferences',
        note: 'Reduced motion, reduced transparency, contrast preference.',
      },
      {
        label: 'CSS forced colours',
        url: 'https://www.w3.org/TR/css-color-adjust-1/',
        note: 'What survives when the OS takes the palette away.',
      },
      {
        label: 'Next.js font optimization',
        url: 'https://nextjs.org/docs/app/getting-started/fonts',
        note: 'Self-hosted faces with no runtime network request and no layout shift. Any face you choose ships this way.',
      },
      {
        label: 'Chromium local font access',
        url: 'https://developer.chrome.com/docs/capabilities/web-apis/local-fonts',
        note: 'Why an arbitrary installed-font picker is out of scope: an explicit permission and a fingerprintable surface, Chromium desktop only.',
      },
    ],
  },
  {
    id: 'ref-evidence',
    title: 'Evidence and cautionary record',
    lede: 'Research the canon leans on, including the failures it is written to avoid.',
    links: [
      {
        label: 'Map-based visualizations increase recall accuracy',
        url: 'https://www2.cs.arizona.edu/~kobourov/recall.pdf',
        note: 'Saket, Scheidegger, Kobourov and Börner. Evidence that map-like organisation improves recall of where data lives, which is why Projects hold stable spatial addresses. It does not prove any particular grid or metaphor is correct.',
      },
      {
        label: 'The unbearable frequency of PewPew maps',
        url: 'https://pylos.co/',
        note: 'The documented failure our density rules exist to avoid: uniform emphasis at scale that communicates nothing.',
      },
      {
        label: 'Electricity Maps',
        url: 'https://www.electricitymaps.com/',
        note: 'A functional colour ramp where colour encodes a value rather than a brand. One of the three defensible colour strategies.',
      },
      {
        label: 'GridStatus',
        url: 'https://www.gridstatus.io/',
        note: 'The grid-operator register we write in: load, capacity, headroom, dispatch. Also the shape of resolving a big number with one plain sentence.',
      },
      {
        label: 'Fly.io, computers for agents',
        url: 'https://fly.io/',
        note: 'Warm rather than martial: a flock of hand-drawn winged desktop towers. Proof that the anti-militaristic constraint has solved precedents.',
      },
      {
        label: 'Samsara',
        url: 'https://www.samsara.com/',
        note: 'Warmth from a person and a real name in the frame, without softening the data.',
      },
      {
        label: 'Oxide Computer',
        url: 'https://oxide.computer/',
        note: 'Named machines rather than serial numbers. Identity at rack scale.',
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Open questions and workbench                                                */
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
      'Named by the operator as the easiest, highest-value place to start. The launcher surface itself was redrawn over five review rounds; what is open is the flow, from the moment you decide to start work to the moment an Agent is running.',
    where: 'ENG-016 D54. Bench: /hud-gallery/agent-launcher',
  },
  {
    title: 'Homepage positioning',
    detail:
      'The standing diagnosis: the site "communicates a feeling very well, but it definitely does not communicate a what and why." The audience is developers, VCs and founders receiving a link cold at launch.',
    where: 'ENG-031. Prototype: /v2',
  },
  {
    title: 'Visualising thousands',
    detail:
      'Explicitly unsolved and deliberately unshaped. Today the board holds a 173-agent fixture legibly. The RTS control grammar is decided; the representation at four orders of magnitude is not.',
    where: 'ENG-004. Surface: the Fleet altitude',
  },
  {
    title: 'Ground, accent and a display face',
    detail:
      'Free choices, with two measured hazards: warm off-white plus neutral grotesk plus floating app window is the 2026 uniform, and our current Exo 2 sits in the sci-fi and esports cohort. Any face must be self-hosted and survive the public-surface boundary.',
    where: 'ENG-031 and ENG-032',
  },
  {
    title: 'A visual language for goals',
    detail:
      'Six metaphor-led languages plus a plain graphic form, held against three constant goal identities. Nothing has been picked, and the study retires once one ships.',
    where: 'Bench: /hud-gallery/goal-visuals',
  },
  {
    title: 'Isometric, and motion on the board',
    detail:
      'Recorded as an open direction from the scoping call and not shaped further. It has to survive the same constraints as everything else on the board: legibility first, attention overlays without relocating, only Active moves.',
    where: 'ENG-004',
  },
];

export interface WorkbenchRoute {
  href: string;
  title: string;
  note: string;
}

export const WORKBENCH_ROUTES: WorkbenchRoute[] = [
  {
    href: '/hud-gallery',
    title: 'HUD gallery',
    note: 'The atoms, each DOM component beside its WebGL sibling, plus the status-light protocol legend.',
  },
  {
    href: '/hud-gallery/hero-board',
    title: 'Hero board',
    note: 'The marketing board over one frozen capture: 173 Agents, 10 Projects, 25 needing a human. It prints its own measured idle motion.',
  },
  {
    href: '/hud-gallery/goal-visuals',
    title: 'Goal visual languages',
    note: 'Seven treatments of the Team tile, three goals held constant. Open review candidate.',
  },
  {
    href: '/hud-gallery/agent-launcher',
    title: 'New Agent launcher',
    note: 'The production launcher driven through its states deterministically.',
  },
  {
    href: '/hud-gallery/fold-close',
    title: 'Fold and close copy',
    note: 'Four weightings of the operator\'s own frame for the front door, switchable independently.',
  },
  {
    href: '/hud-gallery/altitude-scroll',
    title: 'Pinned altitude scroll',
    note: 'The camera move that is the page spine, as a study.',
  },
  {
    href: '/hud-gallery/usage-directions',
    title: 'Usage directions',
    note: 'Three vendor-multiplexer directions over one real capture, six states each.',
  },
  {
    href: '/hud-gallery/roadmap-lab',
    title: 'Roadmap lab',
    note: 'The shipped strip and rail driven through the real parser against canned states.',
  },
  {
    href: '/v2',
    title: 'Proposed homepage',
    note: 'The real page rather than a study of it. This is where site work lands.',
  },
  {
    href: '/architecture',
    title: 'Architecture map',
    note: 'A living runtime map of the application, and a public surface in its own right.',
  },
];

/* -------------------------------------------------------------------------- */
/* Working agreement                                                           */
/* -------------------------------------------------------------------------- */

export const WORKING_AGREEMENT: Rule[] = [
  {
    state: 'canon',
    claim: 'Early options and directional alignment beat one finished comp.',
    because:
      'Agreed on the scoping call, with the operator\'s reason attached: "I\'m very opinionated sometimes, and I can be kind of stubborn on some things too."',
  },
  {
    state: 'canon',
    claim: 'The bar is B- to A-, or better.',
    because:
      'Operator: "everything\'s getting, like, a B-, and where possible, I want to upgrade that to an A-, or A+."',
  },
  {
    state: 'canon',
    claim: 'The gallery is where a new visual state is proven, with a real DOM and R3F sibling when both regimes are affected.',
    because:
      'Whole-screen generation garbles. Small verifiable pieces perfected in isolation do not. After acceptance the tokens percolate through Agent, Team and Fleet rather than becoming one-off treatments.',
  },
  {
    state: 'canon',
    claim: 'A change either cites a rung in the design system or amends it in the same change, with evidence.',
    because: 'Deliberate improvement is the point. Silent divergence is the failure.',
  },
  {
    state: 'retired',
    claim: 'Orbitron, all-caps everywhere, and heavy tracking.',
    because:
      'The original HUD read as a mobile-game skin. The structure now carries the character and the type stays a clean technical grotesk.',
  },
  {
    state: 'retired',
    claim: 'The immersive free-camera 3D world, and full-WebGL chrome.',
    because:
      'Depth competed with labels, and WebGL is not in the accessibility tree. WebGL renders the scalable agent world; DOM and SVG render the chrome over it.',
  },
];
