export type ArchitectureStatus = 'built' | 'partial' | 'planned';

export type ArchitectureLayerKey =
  | 'experience'
  | 'command'
  | 'source'
  | 'signals'
  | 'infrastructure';

export interface ArchitectureLayer {
  key: ArchitectureLayerKey;
  label: string;
  y0: number;
  y1: number;
  color: string;
  accent: string;
}

export interface ArchitectureNode {
  id: string;
  label: string;
  sublabel?: string;
  layer: ArchitectureLayerKey;
  status: ArchitectureStatus;
  description: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArchitectureConnection {
  from: string;
  to: string;
  label?: string;
  style?: 'solid' | 'dashed';
}

export interface WorkstreamItem {
  text: string;
  done: boolean;
  priority: 'now' | 'next' | 'later' | 'done';
}

export interface Workstream {
  lane: string;
  title: string;
  accent: string;
  owner: string;
  deps: string;
  items: WorkstreamItem[];
}

export interface OpenQuestion {
  question: string;
  context: string;
  tag: string;
  tagColor: string;
}

export const architectureManifest = {
  title: 'Exawatt Architecture',
  summary:
    'Electron desktop app and future hosted interface layer for commanding agents from any compatible source. Local OpenClaw is the first target; Demo Mode is first-class and uses the same UI layers.',
  lastReviewed: '2026-05-24',
  canvas: {
    width: 1120,
    height: 1080,
  },
  layers: [
    {
      key: 'experience',
      label: 'Experience Layer — App Surfaces',
      y0: 40,
      y1: 205,
      color: 'rgba(14,165,150,0.05)',
      accent: '#0ea596',
    },
    {
      key: 'command',
      label: 'Command Layer — Canonical Product Model',
      y0: 225,
      y1: 430,
      color: 'rgba(99,102,241,0.05)',
      accent: '#6366f1',
    },
    {
      key: 'source',
      label: 'Source Layer — Harnesses & Adapters',
      y0: 450,
      y1: 650,
      color: 'rgba(234,179,8,0.04)',
      accent: '#d4a017',
    },
    {
      key: 'signals',
      label: 'Signal & Governance Layer',
      y0: 670,
      y1: 845,
      color: 'rgba(168,85,247,0.04)',
      accent: '#a855f7',
    },
    {
      key: 'infrastructure',
      label: 'Infrastructure Layer — Runtime & Persistence',
      y0: 865,
      y1: 1040,
      color: 'rgba(239,68,68,0.04)',
      accent: '#ef4444',
    },
  ] satisfies ArchitectureLayer[],
  nodes: [
    {
      id: 'electron',
      label: 'Electron Desktop',
      sublabel: 'Primary app shell',
      layer: 'experience',
      status: 'partial',
      description:
        'Native desktop shell wrapping the Exawatt UI. The initial target is local OpenClaw control with future support for hosted and multi-source fleets.',
      x: 75,
      y: 82,
      width: 210,
      height: 64,
    },
    {
      id: 'web-ui',
      label: 'Next.js UI',
      sublabel: 'Fleet · Focus · Cron · Docs',
      layer: 'experience',
      status: 'built',
      description:
        'React/Next.js interface layer used by desktop and web surfaces. It should remain source-agnostic and render normalized Exawatt concepts.',
      x: 335,
      y: 82,
      width: 220,
      height: 64,
    },
    {
      id: 'demo-mode',
      label: 'Demo Mode',
      sublabel: 'First-class scenario source',
      layer: 'experience',
      status: 'partial',
      description:
        'Investor/user demo mode that exercises the same UI through a lower-level data-source layer. Current implementation includes the legacy Supabase demo flow.',
      x: 610,
      y: 82,
      width: 220,
      height: 64,
    },
    {
      id: 'public-docs',
      label: 'Public Guides',
      sublabel: 'Concepts · Initiatives · Sources',
      layer: 'experience',
      status: 'planned',
      description:
        'Public-facing product education generated from docs/product. Future app routes should expose these guides directly.',
      x: 880,
      y: 82,
      width: 190,
      height: 64,
    },
    {
      id: 'workspace',
      label: 'Workspace',
      sublabel: 'Users · agents · policy boundary',
      layer: 'command',
      status: 'planned',
      description:
        'Boundary for people, agents, initiatives, context, secrets, spend, policies, and governance.',
      x: 85,
      y: 270,
      width: 185,
      height: 60,
    },
    {
      id: 'initiative',
      label: 'Initiative',
      sublabel: 'Durable high-level goal',
      layer: 'command',
      status: 'planned',
      description:
        'Strategic container for ongoing agent work, such as maintaining a codebase or growing an investor pipeline.',
      x: 315,
      y: 270,
      width: 185,
      height: 60,
    },
    {
      id: 'agent',
      label: 'Agent',
      sublabel: 'Durable worker identity',
      layer: 'command',
      status: 'partial',
      description:
        'Source-agnostic worker identity backed by OpenClaw, Codex, Claude Code, a custom harness, or Demo Mode.',
      x: 545,
      y: 270,
      width: 185,
      height: 60,
    },
    {
      id: 'session',
      label: 'Session',
      sublabel: 'Execution episode',
      layer: 'command',
      status: 'built',
      description:
        'Canonical term for one execution episode. Provider terms such as run, thread, or process should normalize to Session.',
      x: 775,
      y: 270,
      width: 185,
      height: 60,
    },
    {
      id: 'decisions',
      label: 'Scoped Decisions',
      sublabel: 'Workspace · Initiative · Agent',
      layer: 'command',
      status: 'planned',
      description:
        'Durable decisions attach to many scopes, not just agents. They improve future work and support trust/auditability.',
      x: 210,
      y: 350,
      width: 225,
      height: 58,
    },
    {
      id: 'artifacts',
      label: 'Events & Artifacts',
      sublabel: 'Messages · tools · outputs',
      layer: 'command',
      status: 'partial',
      description:
        'Events record what happened. Artifacts are outputs such as diffs, screenshots, reports, documents, and deployments.',
      x: 525,
      y: 350,
      width: 225,
      height: 58,
    },
    {
      id: 'source-adapters',
      label: 'Agent Source Adapters',
      sublabel: 'Normalize provider APIs',
      layer: 'source',
      status: 'partial',
      description:
        'Adapter boundary for local OpenClaw, remote OpenClaw, Codex, Claude Code, Demo Scenario Source, and custom harnesses.',
      x: 105,
      y: 500,
      width: 235,
      height: 62,
    },
    {
      id: 'local-oc',
      label: 'Local OpenClaw',
      sublabel: 'First live target',
      layer: 'source',
      status: 'partial',
      description:
        'Local OpenClaw gateway is the first pseudo-parity target for Exawatt desktop.',
      x: 390,
      y: 500,
      width: 190,
      height: 62,
    },
    {
      id: 'remote-harnesses',
      label: 'Remote Harnesses',
      sublabel: 'Hosted OC · Codex · Claude Code',
      layer: 'source',
      status: 'planned',
      description:
        'Future source targets including hosted OpenClaw, Codex, Claude Code, and custom agent harnesses.',
      x: 630,
      y: 500,
      width: 230,
      height: 62,
    },
    {
      id: 'demo-source',
      label: 'Demo Scenario Source',
      sublabel: 'Supabase · traces · generated',
      layer: 'source',
      status: 'partial',
      description:
        'Pluggable demo data source. Current implementation preserves the legacy Supabase task simulation.',
      x: 905,
      y: 500,
      width: 190,
      height: 62,
    },
    {
      id: 'context-signals',
      label: 'Context Signals',
      sublabel: 'PostHog · Slack · email · GitHub',
      layer: 'signals',
      status: 'planned',
      description:
        'External/internal input streams that inform agent behavior and can be many-to-many across Initiatives and Agents.',
      x: 100,
      y: 720,
      width: 220,
      height: 62,
    },
    {
      id: 'secrets',
      label: 'Secrets & Config',
      sublabel: 'Buy-vs-build research',
      layer: 'signals',
      status: 'planned',
      description:
        'Managed credentials and configuration. Roadmap includes explicit research before choosing vendor or in-house approach.',
      x: 365,
      y: 720,
      width: 210,
      height: 62,
    },
    {
      id: 'consumption',
      label: 'Consumption',
      sublabel: 'Cost · tokens · energy · time',
      layer: 'signals',
      status: 'planned',
      description:
        'Normalized resource tracking for cost, tokens, energy, time, tool calls, and compute.',
      x: 620,
      y: 720,
      width: 210,
      height: 62,
    },
    {
      id: 'policies',
      label: 'Policies & Approvals',
      sublabel: 'Budgets · controls · gates',
      layer: 'signals',
      status: 'planned',
      description:
        'Human and system controls for budgets, approvals, allowed tools, dangerous actions, and governance.',
      x: 875,
      y: 720,
      width: 210,
      height: 62,
    },
    {
      id: 'supabase',
      label: 'Supabase',
      sublabel: 'Auth · Postgres · RLS',
      layer: 'infrastructure',
      status: 'built',
      description:
        'Auth and app data store. Also powers the current legacy Supabase demo task flow.',
      x: 140,
      y: 920,
      width: 190,
      height: 62,
    },
    {
      id: 'local-machine',
      label: 'Local Machine',
      sublabel: 'Electron · gateway · agents',
      layer: 'infrastructure',
      status: 'partial',
      description:
        'Desktop runtime where Exawatt, local OpenClaw, and local agent processes run today.',
      x: 400,
      y: 920,
      width: 210,
      height: 62,
    },
    {
      id: 'hetzner',
      label: 'Hosted VPS',
      sublabel: 'Hetzner first',
      layer: 'infrastructure',
      status: 'planned',
      description:
        'First planned remote infrastructure target for hosted OpenClaw and remote harness control.',
      x: 680,
      y: 920,
      width: 190,
      height: 62,
    },
  ] satisfies ArchitectureNode[],
  connections: [
    { from: 'electron', to: 'web-ui', label: 'wraps' },
    { from: 'web-ui', to: 'workspace' },
    { from: 'web-ui', to: 'agent' },
    { from: 'demo-mode', to: 'demo-source' },
    { from: 'workspace', to: 'initiative' },
    { from: 'initiative', to: 'agent' },
    { from: 'agent', to: 'session' },
    { from: 'session', to: 'artifacts' },
    { from: 'decisions', to: 'initiative', style: 'dashed', label: 'scoped' },
    { from: 'decisions', to: 'agent', style: 'dashed', label: 'scoped' },
    { from: 'agent', to: 'source-adapters' },
    { from: 'source-adapters', to: 'local-oc' },
    { from: 'source-adapters', to: 'remote-harnesses', style: 'dashed' },
    { from: 'source-adapters', to: 'demo-source' },
    { from: 'context-signals', to: 'initiative', style: 'dashed' },
    { from: 'secrets', to: 'policies', style: 'dashed' },
    { from: 'consumption', to: 'policies', style: 'dashed' },
    { from: 'policies', to: 'agent', style: 'dashed' },
    { from: 'local-oc', to: 'local-machine' },
    { from: 'demo-source', to: 'supabase' },
    { from: 'remote-harnesses', to: 'hetzner', style: 'dashed' },
  ] satisfies ArchitectureConnection[],
  workstreams: [
    {
      lane: 'A',
      title: 'Local OpenClaw Pseudo-Parity',
      accent: '#0ea596',
      owner: 'Desktop / frontend',
      deps: 'Electron shell, @exawatt/core',
      items: [
        { text: 'Agent/session list', done: false, priority: 'now' },
        { text: 'Focus/chat view with send/abort controls', done: false, priority: 'now' },
        { text: 'Cron/heartbeat visibility', done: false, priority: 'now' },
        { text: 'Tool/activity history', done: false, priority: 'next' },
        { text: 'Health/config visibility', done: false, priority: 'next' },
      ],
    },
    {
      lane: 'B',
      title: 'Unified Source Architecture',
      accent: '#6366f1',
      owner: 'Core / systems',
      deps: 'OpenClaw adapter, Demo Source',
      items: [
        { text: 'Normalize OpenClaw and Demo Mode into canonical concepts', done: false, priority: 'now' },
        { text: 'Model Agent Source / Harness registry', done: false, priority: 'next' },
        { text: 'Prepare remote OpenClaw and custom harness adapters', done: false, priority: 'next' },
        { text: 'Multi-source fleet aggregation', done: false, priority: 'later' },
      ],
    },
    {
      lane: 'C',
      title: 'Product Primitives',
      accent: '#eab308',
      owner: 'Product / app',
      deps: 'Canonical concepts',
      items: [
        { text: 'Initiative model and UI', done: false, priority: 'next' },
        { text: 'Scoped Decision model', done: false, priority: 'next' },
        { text: 'Context Signal model', done: false, priority: 'later' },
        { text: 'Consumption and budget controls', done: false, priority: 'later' },
      ],
    },
    {
      lane: 'D',
      title: 'Remote Harnesses',
      accent: '#ef4444',
      owner: 'Infra / backend',
      deps: 'Source architecture',
      items: [
        { text: 'Secrets/config buy-vs-build research', done: false, priority: 'next' },
        { text: 'Hetzner VPS OpenClaw control', done: false, priority: 'later' },
        { text: 'Hosted gateway registration and health', done: false, priority: 'later' },
        { text: 'Hosted Exawatt control plane', done: false, priority: 'later' },
      ],
    },
  ] satisfies Workstream[],
  openQuestions: [
    {
      question: 'How should Exawatt expose public guides in-app?',
      context:
        'The source of truth lives in docs/product, but public users should eventually read guides through app routes such as /docs and /docs/concepts.',
      tag: 'Docs',
      tagColor: '#0ea596',
    },
    {
      question: 'What is the first secrets/configuration provider?',
      context:
        'The roadmap requires explicit buy-vs-build research before selecting a vendor or implementing secrets management in-house.',
      tag: 'Security',
      tagColor: '#ef4444',
    },
    {
      question: 'How much OpenClaw configurability should pseudo-parity expose?',
      context:
        'The UI should be simpler than OpenClaw without becoming lossy for power users who need detailed control.',
      tag: 'Product',
      tagColor: '#6366f1',
    },
  ] satisfies OpenQuestion[],
};
