import type { Metadata } from 'next';
import Link from 'next/link';
import {
  WORKSPACE_HUD as HUD,
  withThemeAlpha,
} from '@/components/workspace/workspace-theme';
import {
  ALTITUDES,
  BOARD_RULES,
  COLOR_CHANNELS,
  LINK_GROUPS,
  MOTION_RULES,
  OPEN_ITEMS,
  PRESETS,
  PRODUCT_RULES,
  SCALE_RULES,
  SECTIONS,
  SITE_MEASUREMENTS,
  SITE_RULES,
  SPACING_RULES,
  STATUS_PROTOCOL,
  STATUS_RULES,
  THEME_RULES,
  TYPE_RULES,
  TYPE_SCALE,
  VOICE_RULES,
  WORKBENCH_ROUTES,
  WORKING_AGREEMENT,
  type CanonSection,
  type CanonState,
  type Rule,
} from './canon';

export const metadata: Metadata = {
  title: 'Design canon',
};

const STATE_TONE: Record<CanonState, { color: string; label: string }> = {
  canon: { color: HUD.cyan, label: 'Decided' },
  open: { color: HUD.amber, label: 'Open' },
  retired: { color: HUD.idle, label: 'Retired' },
};

function StateChip({ state }: { state: CanonState }) {
  const tone = STATE_TONE[state];
  return (
    <span
      className="inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-mono text-chrome-micro uppercase tracking-[0.12em]"
      style={{
        color: tone.color,
        borderColor: withThemeAlpha(tone.color, 0.35),
        backgroundColor: withThemeAlpha(tone.color, 0.08),
      }}
    >
      {tone.label}
    </span>
  );
}

function Panel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${className}`}
      style={{
        borderColor: HUD.strokeFaint,
        backgroundColor: HUD.bg.panelFill,
      }}
    >
      {children}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="font-mono text-chrome-micro uppercase tracking-[0.16em]"
      style={{ color: HUD.textDim }}
    >
      {children}
    </p>
  );
}

function RuleList({ rules }: { rules: Rule[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {rules.map(rule => (
        <li key={rule.claim} className="flex flex-col gap-1.5">
          <div className="flex items-start gap-2">
            <StateChip state={rule.state} />
            <p className="text-sm font-medium" style={{ color: HUD.text }}>
              {rule.claim}
            </p>
          </div>
          <p
            className="max-w-[78ch] pl-1 text-chrome-title leading-relaxed"
            style={{ color: HUD.textDim }}
          >
            {rule.because}
          </p>
        </li>
      ))}
    </ul>
  );
}

function SectionHeader({ section }: { section: CanonSection }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-surface-title font-semibold" style={{ color: HUD.text }}>
        {section.title}
      </h2>
      <p className="max-w-[80ch] text-reading" style={{ color: HUD.text }}>
        {section.lede}
      </p>
      <p
        className="font-mono text-chrome-micro"
        style={{ color: withThemeAlpha(HUD.textDim, 0.8) }}
      >
        {section.sources.join('  ·  ')}
      </p>
    </div>
  );
}

function Section({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const section = SECTIONS.find(s => s.id === id);
  if (!section) return null;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-h`}
      className="scroll-mt-8 flex flex-col gap-5 border-t pt-8"
      style={{ borderColor: HUD.divider }}
    >
      <div id={`${id}-h`}>
        <SectionHeader section={section} />
      </div>
      {children}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="whitespace-nowrap px-3 py-2 text-left font-mono text-chrome-micro font-medium uppercase tracking-[0.12em]"
      style={{ color: HUD.textDim, borderColor: HUD.divider }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  mono = false,
  dim = false,
}: {
  children: React.ReactNode;
  mono?: boolean;
  dim?: boolean;
}) {
  return (
    <td
      className={`px-3 py-2 align-top ${mono ? 'font-mono text-chrome-label whitespace-nowrap' : 'text-chrome-title'}`}
      style={{ color: dim ? HUD.textDim : HUD.text }}
    >
      {children}
    </td>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="overflow-x-auto rounded-lg border"
      style={{ borderColor: HUD.strokeFaint }}
    >
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  );
}

export default function DesignCanonPage() {
  return (
    <main
      className="min-h-screen px-4 py-8 font-ui sm:px-6 lg:px-8"
      style={{
        background: `radial-gradient(120% 80% at 75% -10%, ${HUD.bg.hazeIndigo}, transparent 60%), ${HUD.bg.void}`,
        color: HUD.text,
      }}
    >
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8">
        <header className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <GroupLabel>HUD Gallery / Reference</GroupLabel>
              <h1
                className="text-display font-semibold tracking-tight"
                style={{ color: HUD.text }}
              >
                Design canon
              </h1>
            </div>
            <Link
              href="/hud-gallery"
              className="inline-flex min-h-11 items-center font-mono text-chrome-label underline underline-offset-4"
              style={{ color: HUD.cyan }}
            >
              Back to the gallery
            </Link>
          </div>

          <Panel>
            <div className="flex flex-col gap-3">
              <p className="max-w-[80ch] text-reading" style={{ color: HUD.text }}>
                Everything Exawatt has decided about how it looks, moves and
                speaks, in one place, with the evidence attached and the open
                questions marked.
              </p>
              <p
                className="max-w-[80ch] text-sm leading-relaxed"
                style={{ color: HUD.textDim }}
              >
                Two things make this page useful rather than tidy. The first is
                that a rule here is a rule the product already follows, measured
                from shipped code and operator review, so building against it
                costs nothing to land. The second is that everything genuinely
                undecided is labelled{' '}
                <span style={{ color: HUD.amber }}>Open</span> rather than
                quietly implied, because those are the places where a design
                decision changes the product instead of matching it.
              </p>
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <span className="flex items-center gap-2">
                  <StateChip state="canon" />
                  <span
                    className="text-chrome-meta"
                    style={{ color: HUD.textDim }}
                  >
                    settled, cite it
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <StateChip state="open" />
                  <span
                    className="text-chrome-meta"
                    style={{ color: HUD.textDim }}
                  >
                    deliberately unshaped
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <StateChip state="retired" />
                  <span
                    className="text-chrome-meta"
                    style={{ color: HUD.textDim }}
                  >
                    tried, killed, do not revive
                  </span>
                </span>
              </div>
            </div>
          </Panel>

          <nav aria-label="Sections" className="flex flex-wrap gap-2">
            {SECTIONS.map((section, index) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="inline-flex min-h-9 items-center gap-2 rounded border px-3 py-1.5 text-chrome-label"
                style={{
                  color: HUD.text,
                  borderColor: HUD.strokeFaint,
                  backgroundColor: HUD.fill,
                }}
              >
                <span
                  className="font-mono text-chrome-nano"
                  style={{ color: HUD.cyan }}
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                {section.title}
              </a>
            ))}
          </nav>
        </header>

        {/* 1. Product ------------------------------------------------------ */}
        <Section id="product">
          <Table>
            <thead>
              <tr style={{ borderBottom: `1px solid ${HUD.divider}` }}>
                <Th>Altitude</Th>
                <Th>What you are looking at</Th>
                <Th>Renderer</Th>
              </tr>
            </thead>
            <tbody>
              {ALTITUDES.map(altitude => (
                <tr
                  key={altitude.key}
                  style={{ borderTop: `1px solid ${HUD.divider}` }}
                >
                  <Td mono>{altitude.name}</Td>
                  <Td>{altitude.looking}</Td>
                  <Td dim>{altitude.renderer}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Panel>
            <RuleList rules={PRODUCT_RULES} />
          </Panel>
        </Section>

        {/* 2. Kernel ------------------------------------------------------- */}
        <Section id="kernel">
          <div className="flex flex-col gap-3">
            <GroupLabel>Type: the named scale, and nothing between the rungs</GroupLabel>
            <Table>
              <thead>
                <tr style={{ borderBottom: `1px solid ${HUD.divider}` }}>
                  <Th>Rung</Th>
                  <Th>px / line</Th>
                  <Th>Utility</Th>
                  <Th>Use for</Th>
                </tr>
              </thead>
              <tbody>
                {TYPE_SCALE.map(rung => (
                  <tr
                    key={rung.rung}
                    style={{ borderTop: `1px solid ${HUD.divider}` }}
                  >
                    <Td mono>{rung.rung}</Td>
                    <Td mono dim>
                      {rung.size}
                    </Td>
                    <Td mono dim>
                      {rung.utility}
                    </Td>
                    <Td>{rung.use}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Panel>
              <RuleList rules={TYPE_RULES} />
            </Panel>
          </div>

          <div className="flex flex-col gap-3">
            <GroupLabel>Spacing, radii, density</GroupLabel>
            <Panel>
              <RuleList rules={SPACING_RULES} />
            </Panel>
          </div>

          <div className="flex flex-col gap-3">
            <GroupLabel>
              Colour is five channels, and they never impersonate each other
            </GroupLabel>
            <Table>
              <thead>
                <tr style={{ borderBottom: `1px solid ${HUD.divider}` }}>
                  <Th>Channel</Th>
                  <Th>Owns</Th>
                  <Th>Never owns</Th>
                </tr>
              </thead>
              <tbody>
                {COLOR_CHANNELS.map(channel => (
                  <tr
                    key={channel.channel}
                    style={{ borderTop: `1px solid ${HUD.divider}` }}
                  >
                    <Td mono>{channel.channel}</Td>
                    <Td>{channel.owns}</Td>
                    <Td dim>{channel.neverOwns}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          <div className="flex flex-col gap-3">
            <GroupLabel>Status is a five-signal protocol</GroupLabel>
            <Table>
              <thead>
                <tr style={{ borderBottom: `1px solid ${HUD.divider}` }}>
                  <Th>State</Th>
                  <Th>Meaning</Th>
                  <Th>Priority</Th>
                </tr>
              </thead>
              <tbody>
                {STATUS_PROTOCOL.map(state => (
                  <tr
                    key={state.state}
                    style={{ borderTop: `1px solid ${HUD.divider}` }}
                  >
                    <Td mono>{state.state}</Td>
                    <Td>{state.meaning}</Td>
                    <Td mono dim>
                      {state.priority}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Panel>
              <RuleList rules={STATUS_RULES} />
            </Panel>
          </div>

          <div className="flex flex-col gap-3">
            <GroupLabel>Motion</GroupLabel>
            <Panel>
              <RuleList rules={MOTION_RULES} />
            </Panel>
          </div>

          <div className="flex flex-col gap-3">
            <GroupLabel>Voice</GroupLabel>
            <Panel>
              <RuleList rules={VOICE_RULES} />
            </Panel>
          </div>
        </Section>

        {/* 3. Appearance --------------------------------------------------- */}
        <Section id="themes">
          <Table>
            <thead>
              <tr style={{ borderBottom: `1px solid ${HUD.divider}` }}>
                <Th>Preset</Th>
                <Th>Role</Th>
                <Th>Typography today</Th>
              </tr>
            </thead>
            <tbody>
              {PRESETS.map(preset => (
                <tr
                  key={preset.id}
                  style={{ borderTop: `1px solid ${HUD.divider}` }}
                >
                  <Td mono>{preset.id}</Td>
                  <Td>{preset.role}</Td>
                  <Td dim>{preset.typography}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Panel>
            <RuleList rules={THEME_RULES} />
          </Panel>
        </Section>

        {/* 4. Board -------------------------------------------------------- */}
        <Section id="board">
          <Panel>
            <RuleList rules={BOARD_RULES} />
          </Panel>
        </Section>

        {/* 5. Site --------------------------------------------------------- */}
        <Section id="site">
          <div className="flex flex-col gap-3">
            <GroupLabel>
              Measured on 2026-08-14, headless Chromium at 1440x900
            </GroupLabel>
            <Table>
              <thead>
                <tr style={{ borderBottom: `1px solid ${HUD.divider}` }}>
                  <Th>Constraint</Th>
                  <Th>Value</Th>
                  <Th>Where it comes from</Th>
                </tr>
              </thead>
              <tbody>
                {SITE_MEASUREMENTS.map(measurement => (
                  <tr
                    key={measurement.metric}
                    style={{ borderTop: `1px solid ${HUD.divider}` }}
                  >
                    <Td>{measurement.metric}</Td>
                    <Td mono>{measurement.value}</Td>
                    <Td dim>{measurement.source}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <Panel>
            <RuleList rules={SITE_RULES} />
          </Panel>
          <div className="flex flex-col gap-3">
            <GroupLabel>Showing scale without lying about it</GroupLabel>
            <Panel>
              <RuleList rules={SCALE_RULES} />
            </Panel>
          </div>
        </Section>

        {/* 6. References --------------------------------------------------- */}
        <Section id="references">
          <div className="flex flex-col gap-8">
            {LINK_GROUPS.map(group => (
              <div key={group.id} id={group.id} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <h3
                    className="text-base font-semibold"
                    style={{ color: HUD.text }}
                  >
                    {group.title}
                  </h3>
                  <p
                    className="max-w-[80ch] text-chrome-title leading-relaxed"
                    style={{ color: HUD.textDim }}
                  >
                    {group.lede}
                  </p>
                </div>
                <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {group.links.map(link => (
                    <li key={link.url}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-full flex-col gap-1.5 rounded-lg border p-3 transition-colors"
                        style={{
                          borderColor: HUD.strokeFaint,
                          backgroundColor: HUD.bg.panelFill,
                        }}
                      >
                        <span
                          className="text-chrome-title font-medium underline underline-offset-4"
                          style={{ color: HUD.cyan }}
                        >
                          {link.label}
                        </span>
                        <span
                          className="font-mono text-chrome-micro break-all"
                          style={{ color: withThemeAlpha(HUD.textDim, 0.75) }}
                        >
                          {link.url.replace(/^https?:\/\//, '')}
                        </span>
                        <span
                          className="text-chrome-title leading-relaxed"
                          style={{ color: HUD.textDim }}
                        >
                          {link.note}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        {/* 7. Open --------------------------------------------------------- */}
        <Section id="open">
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {OPEN_ITEMS.map(item => (
              <li key={item.title}>
                <Panel className="h-full">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start gap-2">
                      <StateChip state="open" />
                      <h3
                        className="text-chrome-title font-semibold"
                        style={{ color: HUD.text }}
                      >
                        {item.title}
                      </h3>
                    </div>
                    <p
                      className="text-chrome-title leading-relaxed"
                      style={{ color: HUD.textDim }}
                    >
                      {item.detail}
                    </p>
                    <p
                      className="font-mono text-chrome-micro"
                      style={{ color: withThemeAlpha(HUD.cyan, 0.75) }}
                    >
                      {item.where}
                    </p>
                  </div>
                </Panel>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-3">
            <GroupLabel>How the work runs</GroupLabel>
            <Panel>
              <RuleList rules={WORKING_AGREEMENT} />
            </Panel>
          </div>
        </Section>

        {/* 8. Workbench ---------------------------------------------------- */}
        <Section id="workbench">
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {WORKBENCH_ROUTES.map(route => (
              <li key={route.href}>
                <Link
                  href={route.href}
                  className="flex h-full flex-col gap-1.5 rounded-lg border p-3"
                  style={{
                    borderColor: HUD.strokeFaint,
                    backgroundColor: HUD.bg.panelFill,
                  }}
                >
                  <span
                    className="text-chrome-title font-medium"
                    style={{ color: HUD.text }}
                  >
                    {route.title}
                  </span>
                  <span
                    className="font-mono text-chrome-micro"
                    style={{ color: HUD.cyan }}
                  >
                    {route.href}
                  </span>
                  <span
                    className="text-chrome-title leading-relaxed"
                    style={{ color: HUD.textDim }}
                  >
                    {route.note}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <footer
          className="border-t pt-6 pb-4"
          style={{ borderColor: HUD.divider }}
        >
          <p
            className="max-w-[80ch] text-chrome-title leading-relaxed"
            style={{ color: HUD.textDim }}
          >
            Source of truth is the repository, not this page.
            <span className="font-mono">
              {' '}
              docs/engineering/design-system.md{' '}
            </span>
            owns the kernel and carries the amendment log;{' '}
            <span className="font-mono">docs/product/marketing.md</span> owns
            voice and positioning; each decision record owns its own reversal.
            A change either cites a rung or amends one in the same commit.
          </p>
        </footer>
      </div>
    </main>
  );
}
