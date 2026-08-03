export type ArchitectureZoomKey =
  | 'system'
  | 'layers'
  | 'object-model'
  | 'modules';

export type ArchitectureLayerKey = 'ui' | 'coordination' | 'infrastructure';

export type ArchitectureStatus = 'implemented' | 'active-build' | 'designed';

export interface ArchitectureLayer {
  key: ArchitectureLayerKey;
  label: string;
  summary: string;
  color: string;
  accent: string;
}

export interface ArchitectureNode {
  id: string;
  label: string;
  summary: string;
  layer?: ArchitectureLayerKey;
  parentId?: string;
  status?: ArchitectureStatus;
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

export interface ArchitectureBand {
  layer: ArchitectureLayerKey;
  y: number;
  height: number;
}

export interface ArchitectureZoomLevel {
  key: ArchitectureZoomKey;
  label: string;
  title: string;
  summary: string;
  canvas: {
    width: number;
    height: number;
  };
  bands?: ArchitectureBand[];
  nodes: ArchitectureNode[];
  connections: ArchitectureConnection[];
}

export const architectureManifest = {
  title: 'Exawatt Architecture',
  summary:
    'Exawatt is a command interface for managing agent fleets across local, hosted, and third-party harnesses.',
  lastReviewed: '2026-07-27',
  layers: [
    {
      key: 'ui',
      label: 'UI Layer',
      summary:
        'Surfaces for fleet overview, initiative allocation, agent focus, source configuration, artifact review, and approvals.',
      color: 'rgba(14,165,150,0.08)',
      accent: '#0ea596',
    },
    {
      key: 'coordination',
      label: 'Coordination & Intelligence Layer',
      summary:
        'Canonical objects, memory, translation, governance, assurance, and resource context.',
      color: 'rgba(126,87,194,0.08)',
      accent: '#8b5cf6',
    },
    {
      key: 'infrastructure',
      label: 'Agent Infrastructure Layer',
      summary:
        'Agent sources, gateways, harnesses, credentials, local runtimes, and hosted control planes.',
      color: 'rgba(214,158,46,0.08)',
      accent: '#d69e2e',
    },
  ] satisfies ArchitectureLayer[],
  zoomLevels: [
    {
      key: 'system',
      label: 'System',
      title: 'System Boundary',
      summary:
        'Exawatt sits between people directing work and the agent sources that execute it.',
      canvas: { width: 1120, height: 620 },
      nodes: [
        {
          id: 'people',
          label: 'Developers, founders, operators',
          summary:
            'People who need to direct, inspect, and trust work across agent fleets.',
          x: 60,
          y: 250,
          width: 245,
          height: 86,
        },
        {
          id: 'exawatt',
          label: 'Exawatt',
          summary:
            'A source-agnostic command and coordination layer that makes agent authority, activity, and assurance legible.',
          x: 420,
          y: 220,
          width: 280,
          height: 120,
        },
        {
          id: 'local-sources',
          label: 'Local harnesses',
          summary:
            'OpenClaw and other agent runtimes reachable from the local machine.',
          layer: 'infrastructure',
          x: 830,
          y: 110,
          width: 230,
          height: 78,
        },
        {
          id: 'hosted-sources',
          label: 'Hosted harnesses',
          summary:
            'Remote OpenClaw, hosted VPS agents, and managed execution environments.',
          layer: 'infrastructure',
          x: 830,
          y: 245,
          width: 230,
          height: 78,
        },
        {
          id: 'third-party-sources',
          label: 'Third-party harnesses',
          summary:
            'Codex, Claude Code, custom harnesses, and partner agent sources.',
          layer: 'infrastructure',
          x: 830,
          y: 380,
          width: 230,
          height: 78,
        },
      ],
      connections: [
        { from: 'people', to: 'exawatt' },
        { from: 'exawatt', to: 'local-sources' },
        { from: 'exawatt', to: 'hosted-sources' },
        { from: 'exawatt', to: 'third-party-sources' },
      ],
    },
    {
      key: 'layers',
      label: 'Layers',
      title: 'Three-Layer Architecture',
      summary:
        'The UI layer sits above source-agnostic coordination, which sits above replaceable agent infrastructure.',
      canvas: { width: 1120, height: 720 },
      bands: [
        { layer: 'ui', y: 60, height: 160 },
        { layer: 'coordination', y: 275, height: 190 },
        { layer: 'infrastructure', y: 520, height: 150 },
      ],
      nodes: [
        {
          id: 'ui-layer',
          label: 'UI Layer',
          summary:
            'Modular surfaces for fleet state, initiative allocation, focused control, artifact review, and approvals.',
          layer: 'ui',
          x: 115,
          y: 94,
          width: 890,
          height: 92,
        },
        {
          id: 'coordination-layer',
          label: 'Coordination & Intelligence Layer',
          summary:
            'Canonical objects, translation, decisions, policy, approvals, consumption, and truthful activity assurance.',
          layer: 'coordination',
          x: 115,
          y: 318,
          width: 890,
          height: 104,
        },
        {
          id: 'agent-infrastructure-layer',
          label: 'Agent Infrastructure Layer',
          summary:
            'Local OpenClaw, hosted OpenClaw, Codex, Claude Code, custom harnesses, gateways, and credentials.',
          layer: 'infrastructure',
          x: 115,
          y: 555,
          width: 890,
          height: 82,
        },
      ],
      connections: [
        {
          from: 'ui-layer',
          to: 'coordination-layer',
          label: 'canonical model',
        },
        {
          from: 'coordination-layer',
          to: 'agent-infrastructure-layer',
          label: 'source adapters',
        },
      ],
    },
    {
      key: 'object-model',
      label: 'Object Model',
      title: 'Canonical Nouns',
      summary:
        'The public architecture is organized around durable Exawatt objects, not provider-specific terms.',
      canvas: { width: 1120, height: 900 },
      bands: [
        { layer: 'ui', y: 40, height: 170 },
        { layer: 'coordination', y: 240, height: 390 },
        { layer: 'infrastructure', y: 660, height: 190 },
      ],
      nodes: [
        {
          id: 'fleet-overview',
          label: 'Fleet Overview',
          summary:
            'A broad view of agent allocation, health, outcomes, risk, and resource use.',
          layer: 'ui',
          x: 80,
          y: 92,
          width: 215,
          height: 72,
        },
        {
          id: 'initiative-view',
          label: 'Initiative View',
          summary:
            'A durable goal frame for seeing where agents and sessions are allocated.',
          layer: 'ui',
          x: 325,
          y: 92,
          width: 215,
          height: 72,
        },
        {
          id: 'agent-focus',
          label: 'Agent Focus',
          summary:
            'A close-range surface for one agent, one session, and the work in progress.',
          layer: 'ui',
          x: 570,
          y: 92,
          width: 215,
          height: 72,
        },
        {
          id: 'review-surfaces',
          label: 'Review Surfaces',
          summary:
            'Places where people inspect intent, activity, artifacts, decisions, approvals, evidence, and outcomes.',
          layer: 'ui',
          x: 815,
          y: 92,
          width: 225,
          height: 72,
        },
        {
          id: 'workspace',
          label: 'Workspace',
          summary:
            'The boundary for people, initiatives, agents, context, secrets, spend, policies, and governance.',
          layer: 'coordination',
          x: 70,
          y: 300,
          width: 170,
          height: 68,
        },
        {
          id: 'initiative',
          label: 'Initiative',
          summary: 'A durable high-level goal or area of responsibility.',
          layer: 'coordination',
          x: 285,
          y: 300,
          width: 170,
          height: 68,
        },
        {
          id: 'agent',
          label: 'Agent',
          summary:
            'A durable worker identity or capability from any compatible source.',
          layer: 'coordination',
          x: 500,
          y: 300,
          width: 170,
          height: 68,
        },
        {
          id: 'session',
          label: 'Session',
          summary:
            'A durable execution episode that can span multiple local process incarnations.',
          layer: 'coordination',
          x: 715,
          y: 300,
          width: 170,
          height: 68,
        },
        {
          id: 'event',
          label: 'Event',
          summary:
            'A timestamped observation with explicit reported, observed, authorized, enforced, and verified provenance.',
          layer: 'coordination',
          x: 625,
          y: 430,
          width: 165,
          height: 68,
        },
        {
          id: 'artifact',
          label: 'Artifact',
          summary:
            'A produced or modified output: diff, screenshot, report, document, or deployment.',
          layer: 'coordination',
          x: 820,
          y: 430,
          width: 165,
          height: 68,
        },
        {
          id: 'decision',
          label: 'Decision',
          summary:
            'A durable choice or tradeoff scoped to the object it affects.',
          layer: 'coordination',
          x: 80,
          y: 535,
          width: 165,
          height: 68,
        },
        {
          id: 'context-signal',
          label: 'Context Signal',
          summary:
            'An internal or external input stream that can inform agent behavior.',
          layer: 'coordination',
          x: 285,
          y: 535,
          width: 165,
          height: 68,
        },
        {
          id: 'policy-budget',
          label: 'Policy / Budget',
          summary:
            'Layered rules and limits; managed Workspace ceilings can bound personal and Agent settings.',
          layer: 'coordination',
          x: 490,
          y: 535,
          width: 165,
          height: 68,
        },
        {
          id: 'consumption',
          label: 'Consumption',
          summary:
            'Normalized usage across cost, tokens, time, energy, tool calls, and compute.',
          layer: 'coordination',
          x: 695,
          y: 535,
          width: 165,
          height: 68,
        },
        {
          id: 'approval',
          label: 'Approval',
          summary:
            'A scoped, time-bounded human authorization checkpoint for high-impact work.',
          layer: 'coordination',
          x: 900,
          y: 535,
          width: 150,
          height: 68,
        },
        {
          id: 'context-group',
          label: 'Project / Context Group',
          summary:
            'A resolvable grouping lens over agents (by project, initiative, repository, signal, or similarity). Derived on demand, not a stored parent of Agent.',
          layer: 'coordination',
          x: 360,
          y: 410,
          width: 230,
          height: 66,
        },
        {
          id: 'agent-source',
          label: 'Agent Source / Harness',
          summary:
            'A provider/runtime boundary with one or more configured instances, each describing identity, connection truth, controls, activity, evidence, and enforcement ownership.',
          layer: 'infrastructure',
          x: 95,
          y: 705,
          width: 210,
          height: 70,
        },
        {
          id: 'gateway',
          label: 'Gateway',
          summary: 'A local or remote connection to a harness.',
          layer: 'infrastructure',
          x: 350,
          y: 705,
          width: 170,
          height: 70,
        },
        {
          id: 'secret-credential',
          label: 'Secret / Credential',
          summary:
            'Managed access material that agents can request or use under policy.',
          layer: 'infrastructure',
          x: 565,
          y: 705,
          width: 190,
          height: 70,
        },
        {
          id: 'harness-fleet',
          label: 'OpenClaw / Codex / Claude Code / Custom',
          summary:
            'The set of local, hosted, third-party, and custom execution backends.',
          layer: 'infrastructure',
          x: 800,
          y: 705,
          width: 245,
          height: 70,
        },
      ],
      connections: [
        { from: 'fleet-overview', to: 'workspace' },
        { from: 'initiative-view', to: 'initiative' },
        { from: 'agent-focus', to: 'agent' },
        { from: 'review-surfaces', to: 'artifact' },
        { from: 'workspace', to: 'initiative' },
        { from: 'initiative', to: 'agent' },
        { from: 'context-group', to: 'agent', style: 'dashed' },
        { from: 'agent', to: 'session' },
        { from: 'session', to: 'event' },
        { from: 'session', to: 'artifact' },
        { from: 'decision', to: 'initiative', style: 'dashed' },
        { from: 'context-signal', to: 'initiative', style: 'dashed' },
        { from: 'policy-budget', to: 'agent', style: 'dashed' },
        { from: 'consumption', to: 'policy-budget', style: 'dashed' },
        { from: 'approval', to: 'session', style: 'dashed' },
        { from: 'agent', to: 'agent-source' },
        { from: 'agent-source', to: 'gateway' },
        { from: 'gateway', to: 'harness-fleet' },
        { from: 'secret-credential', to: 'gateway', style: 'dashed' },
      ],
    },
    {
      key: 'modules',
      label: 'Modules',
      title: 'Public-Safe Implementation Map',
      summary:
        'This zoom shows repo-level architecture without exposing private environment, deployment, or credential details.',
      canvas: { width: 1120, height: 920 },
      bands: [
        { layer: 'ui', y: 40, height: 210 },
        { layer: 'coordination', y: 280, height: 320 },
        { layer: 'infrastructure', y: 630, height: 220 },
      ],
      nodes: [
        {
          id: 'next-app-shell',
          label: 'Next.js App Shell',
          summary:
            'Shared UI source packaged locally for privileged desktop use and delivered separately for hosted contexts.',
          layer: 'ui',
          status: 'implemented',
          x: 80,
          y: 95,
          width: 210,
          height: 74,
        },
        {
          id: 'fleet-ui',
          label: 'Fleet UI',
          summary:
            'Agent fleet list, detail, chat, activity, cron, and operational surfaces.',
          layer: 'ui',
          status: 'active-build',
          x: 330,
          y: 95,
          width: 210,
          height: 74,
        },
        {
          id: 'terminal-workspace',
          label: 'Terminal + Session Overview',
          summary:
            'Elastic two-row Project/Initiative ribbon, inert Project selection, intent-safe Agent drafts, semantically merged parent/delegated attention, keyboard-complete actions, grouped exposé, and direct live-or-stopped Session control.',
          layer: 'ui',
          status: 'implemented',
          x: 205,
          y: 180,
          width: 230,
          height: 74,
        },
        {
          id: 'spatial-operations-board',
          label: 'Spatial Operations Board',
          summary:
            'R3F tactical board with stable catalog-backed Project zones, including zero-Agent state, semantic zoom, anchored live and dotted stopped Agents, attention, and exact Session handoff.',
          layer: 'ui',
          status: 'implemented',
          x: 455,
          y: 180,
          width: 230,
          height: 74,
        },
        {
          id: 'command-navigation',
          label: 'Command Navigation',
          summary:
            'Typed Terminal, Sessions, and Spatial route service with registry-derived gestures, context restore, and finite reduced-motion-safe handoffs.',
          layer: 'ui',
          status: 'implemented',
          x: 705,
          y: 180,
          width: 230,
          height: 74,
        },
        {
          id: 'consumption-surface',
          label: 'Consumption Surface',
          summary:
            'Expository capacity, attribution, and cost-per-outcome narrative with the unit ladder, stated assurance, and visibly unbuilt allocation affordances.',
          layer: 'ui',
          status: 'active-build',
          x: 945,
          y: 180,
          width: 175,
          height: 74,
        },
        {
          id: 'architecture-map',
          label: 'Architecture Map',
          summary:
            'The living public architecture map rendered from the architecture manifest.',
          layer: 'ui',
          status: 'active-build',
          x: 580,
          y: 95,
          width: 210,
          height: 74,
        },
        {
          id: 'review-ui',
          label: 'Review UI',
          summary:
            'Public-safe label for artifact, approval, and outcome review surfaces.',
          layer: 'ui',
          status: 'designed',
          x: 830,
          y: 95,
          width: 210,
          height: 74,
        },
        {
          id: 'architecture-manifest',
          label: 'Architecture Manifest',
          summary:
            'Typed data source for /architecture and its canonical map levels.',
          layer: 'coordination',
          status: 'implemented',
          x: 80,
          y: 335,
          width: 220,
          height: 76,
        },
        {
          id: 'fleet-provider',
          label: 'Fleet Provider',
          summary:
            'React provider and hooks for UI-facing fleet state plus the source Project catalog, refreshed by authoritative workspace changes.',
          layer: 'coordination',
          status: 'implemented',
          x: 342,
          y: 335,
          width: 190,
          height: 76,
        },
        {
          id: 'ui-model',
          label: 'UI Model',
          summary:
            'Pure typed selectors, view models, spatial layout data, and command contracts shared by UI regimes.',
          layer: 'coordination',
          status: 'active-build',
          x: 80,
          y: 475,
          width: 220,
          height: 76,
        },
        {
          id: 'source-adapters',
          label: 'Agent Source Registry + Adapters',
          summary:
            'One generated declaration contract plus Electron-main runtime observations power Settings and the Terminal composer. Observed, declared, and simulated evidence stay distinct; registry failure is fail-closed; OpenClaw uses a protocol probe; and Electron revalidates every Agent launch without exposing provider credentials.',
          layer: 'coordination',
          status: 'active-build',
          x: 572,
          y: 335,
          width: 220,
          height: 76,
        },
        {
          id: 'canonical-docs',
          label: 'Canonical Docs',
          summary:
            'Product concepts, engineering architecture, roadmap, and decisions.',
          layer: 'coordination',
          status: 'implemented',
          x: 832,
          y: 335,
          width: 210,
          height: 76,
        },
        {
          id: 'decision-context-layer',
          label: 'Decision / Context Layer',
          summary:
            'Scoped decisions, approvals, context, policy hierarchy, evidence, assurance, and consumption controls.',
          layer: 'coordination',
          status: 'designed',
          x: 342,
          y: 475,
          width: 245,
          height: 76,
        },
        {
          id: 'initiative-model',
          label: 'Initiative Model',
          summary:
            'High-level product frame for durable goals and agent allocation.',
          layer: 'coordination',
          status: 'designed',
          x: 645,
          y: 475,
          width: 210,
          height: 76,
        },
        {
          id: 'context-label-engine',
          label: 'Session Context Inference',
          summary:
            'Bounded operator evidence, authenticated hosted structured inference, stale-response rejection, and durable last-good labels.',
          layer: 'coordination',
          status: 'implemented',
          x: 80,
          y: 575,
          width: 245,
          height: 76,
        },
        {
          id: 'feedback-intake',
          label: 'Product Feedback Intake',
          summary:
            'Authenticated general reports, label votes/corrections, the ⌘⇧F quick-capture bar with pre-captured screenshots, and the operator reinflation triage loop draining rows into canonical repo state.',
          layer: 'coordination',
          status: 'implemented',
          x: 365,
          y: 575,
          width: 235,
          height: 76,
        },
        {
          id: 'consumption-spine',
          label: 'Consumption Spine',
          summary:
            'Source-agnostic usage contract, local-log adapters behind an injected filesystem port, idempotent merge, and scoped rollups with assurance and delegated split.',
          layer: 'coordination',
          status: 'implemented',
          x: 645,
          y: 575,
          width: 235,
          height: 76,
        },
        {
          id: 'electron-shell',
          label: 'Electron Shell',
          summary:
            'Immediate launch frame, trusted operator-input/context IPC, reload-safe renderer-projected menu availability, authoritative recovery-ledger events, native-network PKCE, serialized workspace/history, durable provider identity, atomic delivery, and signed updates.',
          layer: 'infrastructure',
          status: 'implemented',
          x: 75,
          y: 685,
          width: 180,
          height: 74,
        },
        {
          id: 'openclaw-client',
          label: 'OpenClaw Client',
          summary:
            'Core OpenClaw JSON-RPC client, adapters, and fleet manager primitives.',
          layer: 'infrastructure',
          status: 'implemented',
          x: 295,
          y: 685,
          width: 200,
          height: 74,
        },
        {
          id: 'demo-harness',
          label: 'Demo Harness',
          summary:
            'A swappable harness that emits the same activity and assurance shapes with simulated provenance.',
          layer: 'infrastructure',
          status: 'active-build',
          x: 535,
          y: 685,
          width: 185,
          height: 74,
        },
        {
          id: 'supabase-data',
          label: 'Supabase Data + Artifacts',
          summary:
            'Auth, inference quota, RLS-owned product feedback, private feedback images, hosted app data, and the anonymous signed desktop update channel.',
          layer: 'infrastructure',
          status: 'implemented',
          x: 760,
          y: 685,
          width: 185,
          height: 74,
        },
        {
          id: 'hosted-runtime',
          label: 'Hosted Runtime',
          summary:
            'VPS and hosted control-plane infrastructure for remote harnesses.',
          layer: 'infrastructure',
          status: 'designed',
          x: 430,
          y: 785,
          width: 220,
          height: 74,
        },
      ],
      connections: [
        { from: 'next-app-shell', to: 'fleet-provider' },
        { from: 'next-app-shell', to: 'terminal-workspace' },
        { from: 'next-app-shell', to: 'spatial-operations-board' },
        { from: 'next-app-shell', to: 'command-navigation' },
        { from: 'command-navigation', to: 'terminal-workspace' },
        { from: 'command-navigation', to: 'spatial-operations-board' },
        { from: 'command-navigation', to: 'consumption-surface' },
        { from: 'consumption-surface', to: 'consumption-spine' },
        { from: 'consumption-spine', to: 'demo-harness' },
        { from: 'consumption-spine', to: 'source-adapters', style: 'dashed' },
        { from: 'fleet-ui', to: 'ui-model' },
        { from: 'terminal-workspace', to: 'fleet-provider' },
        { from: 'terminal-workspace', to: 'electron-shell' },
        { from: 'terminal-workspace', to: 'context-label-engine' },
        { from: 'terminal-workspace', to: 'feedback-intake' },
        { from: 'spatial-operations-board', to: 'ui-model' },
        { from: 'architecture-map', to: 'architecture-manifest' },
        { from: 'review-ui', to: 'decision-context-layer', style: 'dashed' },
        { from: 'fleet-provider', to: 'source-adapters' },
        { from: 'next-app-shell', to: 'source-adapters' },
        {
          from: 'canonical-docs',
          to: 'architecture-manifest',
          style: 'dashed',
        },
        {
          from: 'decision-context-layer',
          to: 'initiative-model',
          style: 'dashed',
        },
        { from: 'source-adapters', to: 'openclaw-client' },
        { from: 'source-adapters', to: 'demo-harness' },
        { from: 'source-adapters', to: 'hosted-runtime', style: 'dashed' },
        { from: 'electron-shell', to: 'openclaw-client' },
        { from: 'electron-shell', to: 'supabase-data' },
        { from: 'electron-shell', to: 'context-label-engine' },
        { from: 'context-label-engine', to: 'supabase-data' },
        { from: 'feedback-intake', to: 'supabase-data' },
        { from: 'demo-harness', to: 'supabase-data', style: 'dashed' },
      ],
    },
  ] satisfies ArchitectureZoomLevel[],
  principles: [
    'UI surfaces speak Exawatt nouns, not provider-specific vocabulary.',
    'DOM and Spatial Operations Board regimes share typed view models and command contracts.',
    'Terminal Focus, Session Overview, and Spatial Command form one navigation continuum while keeping separate renderer boundaries.',
    'Open Project identity spans Terminal, Sessions, and Spatial even before an Agent or Session exists; Agents join catalog-backed groups by stable source identity.',
    'Terminal projects current Session tabs as Initiative-shaped work: selected Projects expand, manual inactive disclosure persists, dormant empties stable-partition to the tail, and subagent work aggregates instead of multiplying top-level tabs.',
    'Open Session identity spans Terminal, Sessions, and Spatial; PTYs add live runtime state but do not define whether a Session-backed Agent exists.',
    'Logical Sessions survive local process death through explicit, deterministic rehydration; local processes do not outlive Exawatt.',
    'Agent turn state is semantic main-process truth: finished is sticky across passive PTY redraws and only explicit operator engagement opens the next turn; shell activity remains output-driven.',
    'What a harness reports about itself outranks what Exawatt infers from its bytes, in both directions and at the source: quiescence never concludes a turn ended, delegated, or unblocked while the source says otherwise.',
    'Waiting on the operator is its own reported fact, independent of turn state and of delegation: an Agent asking a question is mid-turn, producing nothing, and answerable only by a human.',
    'Independent attention sources compose semantically: human gates outrank quiet results, and one merged projection drives markers, availability, and navigation.',
    'Attention records what the operator has not yet seen; the status light records what is currently true. Focusing a Session changes the first and never the second.',
    'Session context labels follow submitted operator intent, never PTY output volume; one hosted inference path improves a durable last-good label while failures retain it.',
    'Product feedback is explicit authenticated evidence with row ownership and private attachments; inference evidence is not persisted as feedback automatically.',
    'Agent sources are replaceable harnesses behind explicit adapters.',
    'A new Agent launch shows and pins the source-resolved model/effort pair; per-Agent overrides do not rewrite harness configuration, and dominant environment constraints stay explicit.',
    'Recent conversation discovery is Project-scoped, local-first, and source-neutral; exact identity reconciles Exawatt Session history with harness history before optional hosted title augmentation.',
    'Launch permission policy is source-agnostic and provider-enforced today; adapters translate visible personal Project defaults without silent escalation.',
    'Activity assurance is composable: reported, observed, authorized, enforced, and verified are independent claims, and unknowns stay visible.',
    'Future managed Workspace ceilings cannot be bypassed by personal settings or YOLO; later mediation fits behind existing source and coordination contracts.',
    'Demo behavior is a swappable harness path, not a separate product architecture.',
    'Governance, memory, and resource context live above individual providers.',
  ],
  dynamicRange: [
    {
      label: 'Microscope',
      summary:
        'Inspect one agent, one session, tool history, blockers, diffs, and approvals.',
    },
    {
      label: 'Mission Control',
      summary:
        'See fleet allocation, initiatives, outcomes, risk, policy, and consumption.',
    },
  ],
};
