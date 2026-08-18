import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  WORKSPACE_HUD as HUD,
  withThemeAlpha,
} from '@/components/workspace/workspace-theme';
import {
  ALTITUDES,
  BOARD_RULES,
  COLOR_CHANNELS,
  KERNEL_RULES,
  LINK_GROUPS,
  OPEN_ITEMS,
  PRESETS,
  PRODUCT_RULES,
  SECTIONS,
  SITE_MEASUREMENTS,
  SITE_RULES,
  STATUS_PROTOCOL,
  THEME_RULES,
  TYPE_SCALE,
  WORKBENCH_ROUTES,
  type CanonSection,
  type Rule,
} from './canon';

export const metadata: Metadata = {
  title: 'Design canon',
};

function Dot({ open = false }: { open?: boolean }) {
  return (
    <span
      aria-hidden
      className="mt-2 size-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: open ? HUD.amber : HUD.cyan }}
    />
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
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
    <ul className="flex flex-col gap-2.5">
      {rules.map(rule => (
        <li key={rule.claim} className="flex items-start gap-2.5">
          <Dot open={rule.state === 'open'} />
          <p className="text-sm" style={{ color: HUD.text }}>
            {rule.claim}
            {rule.note ? (
              <span
                className="text-chrome-title"
                style={{ color: HUD.textDim }}
              >
                {'  '}
                {rule.note}
              </span>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Section({ id, children }: { id: string; children: ReactNode }) {
  const section = SECTIONS.find((s: CanonSection) => s.id === id);
  if (!section) return null;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-h`}
      className="scroll-mt-8 flex flex-col gap-5 border-t pt-7"
      style={{ borderColor: HUD.divider }}
    >
      <div className="flex flex-col gap-1">
        <h2
          id={`${id}-h`}
          className="text-surface-title font-semibold"
          style={{ color: HUD.text }}
        >
          {section.title}
        </h2>
        <p className="max-w-[74ch] text-sm" style={{ color: HUD.text }}>
          {section.lede}
        </p>
        <p
          className="font-mono text-chrome-micro"
          style={{ color: withThemeAlpha(HUD.textDim, 0.8) }}
        >
          {section.source}
        </p>
      </div>
      {children}
    </section>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th
      scope="col"
      className="whitespace-nowrap px-3 py-1.5 text-left font-mono text-chrome-micro font-medium uppercase tracking-[0.12em]"
      style={{ color: HUD.textDim }}
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
  children: ReactNode;
  mono?: boolean;
  dim?: boolean;
}) {
  return (
    <td
      className={`px-3 py-1.5 align-top ${mono ? 'whitespace-nowrap font-mono text-chrome-label' : 'text-chrome-title'}`}
      style={{ color: dim ? HUD.textDim : HUD.text }}
    >
      {children}
    </td>
  );
}

function Table({ children }: { children: ReactNode }) {
  return (
    <div
      className="overflow-x-auto rounded-lg border"
      style={{ borderColor: HUD.strokeFaint }}
    >
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <tr style={{ borderTop: `1px solid ${HUD.divider}` }}>{children}</tr>;
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
      <div className="mx-auto flex w-full max-w-[1060px] flex-col gap-7">
        <header className="flex flex-col gap-4">
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

          <p className="max-w-[74ch] text-reading" style={{ color: HUD.text }}>
            What Exawatt has settled about how it looks, moves and speaks, and
            what it has left open on purpose.
          </p>

          <div className="flex flex-wrap items-center gap-5">
            <span className="flex items-center gap-2">
              <Dot />
              <span className="text-chrome-title" style={{ color: HUD.textDim }}>
                settled, build against it
              </span>
            </span>
            <span className="flex items-center gap-2">
              <Dot open />
              <span className="text-chrome-title" style={{ color: HUD.textDim }}>
                open, yours to decide
              </span>
            </span>
          </div>

          <nav aria-label="Sections" className="flex flex-wrap gap-2">
            {SECTIONS.map((section: CanonSection) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="inline-flex min-h-9 items-center rounded border px-3 py-1.5 text-chrome-label"
                style={{
                  color: HUD.text,
                  borderColor: HUD.strokeFaint,
                  backgroundColor: HUD.fill,
                }}
              >
                {section.title}
              </a>
            ))}
          </nav>
        </header>

        {/* The product ----------------------------------------------------- */}
        <Section id="product">
          <Table>
            <thead>
              <tr>
                <Th>Altitude</Th>
                <Th>What you see</Th>
                <Th>Renderer</Th>
              </tr>
            </thead>
            <tbody>
              {ALTITUDES.map(altitude => (
                <Row key={altitude.name}>
                  <Td mono>{altitude.name}</Td>
                  <Td>{altitude.looking}</Td>
                  <Td dim>{altitude.renderer}</Td>
                </Row>
              ))}
            </tbody>
          </Table>
          <RuleList rules={PRODUCT_RULES} />
        </Section>

        {/* The kernel ------------------------------------------------------ */}
        <Section id="kernel">
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div className="flex flex-col gap-2">
              <GroupLabel>Type, and nothing between the rungs</GroupLabel>
              <Table>
                <thead>
                  <tr>
                    <Th>Rung</Th>
                    <Th>px</Th>
                    <Th>Utility</Th>
                    <Th>Use</Th>
                  </tr>
                </thead>
                <tbody>
                  {TYPE_SCALE.map(rung => (
                    <Row key={rung.rung}>
                      <Td mono>{rung.rung}</Td>
                      <Td mono dim>
                        {rung.size}
                      </Td>
                      <Td mono dim>
                        {rung.utility}
                      </Td>
                      <Td>{rung.use}</Td>
                    </Row>
                  ))}
                </tbody>
              </Table>
            </div>

            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <GroupLabel>
                  Colour channels never impersonate each other
                </GroupLabel>
                <Table>
                  <thead>
                    <tr>
                      <Th>Channel</Th>
                      <Th>Owns</Th>
                      <Th>Never</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {COLOR_CHANNELS.map(channel => (
                      <Row key={channel.channel}>
                        <Td mono>{channel.channel}</Td>
                        <Td>{channel.owns}</Td>
                        <Td dim>{channel.never}</Td>
                      </Row>
                    ))}
                  </tbody>
                </Table>
              </div>

              <div className="flex flex-col gap-2">
                <GroupLabel>Status, five signals</GroupLabel>
                <Table>
                  <tbody>
                    {STATUS_PROTOCOL.map(state => (
                      <Row key={state.state}>
                        <Td mono>{state.state}</Td>
                        <Td dim>{state.meaning}</Td>
                      </Row>
                    ))}
                  </tbody>
                </Table>
              </div>
            </div>
          </div>

          <RuleList rules={KERNEL_RULES} />

          <div className="flex flex-col gap-2">
            <GroupLabel>Appearance</GroupLabel>
            <Table>
              <tbody>
                {PRESETS.map(preset => (
                  <Row key={preset.id}>
                    <Td mono>{preset.id}</Td>
                    <Td dim>{preset.role}</Td>
                  </Row>
                ))}
              </tbody>
            </Table>
            <div className="pt-1">
              <RuleList rules={THEME_RULES} />
            </div>
          </div>
        </Section>

        {/* The board ------------------------------------------------------- */}
        <Section id="board">
          <RuleList rules={BOARD_RULES} />
        </Section>

        {/* The site -------------------------------------------------------- */}
        <Section id="site">
          <Table>
            <thead>
              <tr>
                <Th>Constraint</Th>
                <Th>Value</Th>
                <Th>Measured</Th>
              </tr>
            </thead>
            <tbody>
              {SITE_MEASUREMENTS.map(measurement => (
                <Row key={measurement.metric}>
                  <Td>{measurement.metric}</Td>
                  <Td mono>{measurement.value}</Td>
                  <Td dim>{measurement.source}</Td>
                </Row>
              ))}
            </tbody>
          </Table>
          <RuleList rules={SITE_RULES} />
        </Section>

        {/* References ------------------------------------------------------ */}
        <Section id="references">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {LINK_GROUPS.map(group => (
              <div key={group.id} className="flex flex-col gap-2">
                <GroupLabel>{group.title}</GroupLabel>
                <ul className="flex flex-col">
                  {group.links.map(link => (
                    <li
                      key={link.url}
                      className="border-b last:border-b-0"
                      style={{ borderColor: HUD.divider }}
                    >
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex flex-wrap items-baseline gap-x-2 py-1.5"
                      >
                        <span
                          className="text-chrome-title underline underline-offset-4"
                          style={{ color: HUD.cyan }}
                        >
                          {link.label}
                        </span>
                        {link.note ? (
                          <span
                            className="text-chrome-meta"
                            style={{ color: HUD.textDim }}
                          >
                            {link.note}
                          </span>
                        ) : null}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        {/* Open ------------------------------------------------------------ */}
        <Section id="open">
          <ul className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            {OPEN_ITEMS.map(item => (
              <li key={item.title} className="flex items-start gap-2.5">
                <Dot open />
                <div className="flex flex-col gap-0.5">
                  <p
                    className="text-sm font-medium"
                    style={{ color: HUD.text }}
                  >
                    {item.title}
                  </p>
                  <p
                    className="text-chrome-title"
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
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-2 pt-1">
            <GroupLabel>Live studies</GroupLabel>
            <ul className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
              {WORKBENCH_ROUTES.map(route => (
                <li
                  key={route.href}
                  className="border-b last:border-b-0 md:last:border-b"
                  style={{ borderColor: HUD.divider }}
                >
                  <Link
                    href={route.href}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5"
                  >
                    <span
                      className="text-chrome-title"
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
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <footer
          className="border-t pt-5 pb-4"
          style={{ borderColor: HUD.divider }}
        >
          <p
            className="max-w-[74ch] text-chrome-title"
            style={{ color: HUD.textDim }}
          >
            The repository is the source of truth. Each section names the
            document that owns it, and a change either cites a rung or amends
            one.
          </p>
        </footer>
      </div>
    </main>
  );
}
