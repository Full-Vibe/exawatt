import { HUD } from '@/components/hud';
import { StatusLight } from './status-light';
import {
  STATUS_LIGHT_META,
  STATUS_LIGHT_STATES,
  type StatusLightState,
} from './protocol';

const SAMPLE = {
  off: {
    title: 'Codex',
    goal: 'Ready for a task',
    detail: 'New Agent',
  },
  active: {
    title: 'Codex',
    goal: 'Extracting status semantics',
    detail: 'Output streaming',
  },
  result: {
    title: 'Codex',
    goal: 'Status protocol drafted',
    detail: 'Result waiting',
  },
  'needs-you': {
    title: 'Codex',
    goal: 'Approve the source boundary',
    detail: 'Approval required',
  },
  fault: {
    title: 'Codex',
    goal: 'Gallery render stopped',
    detail: 'Build failed',
  },
} as const satisfies Record<
  StatusLightState,
  { title: string; goal: string; detail: string }
>;

function SpecimenHeading({ children }: { children: string }) {
  return (
    <h3
      className="font-mono text-[10px] uppercase tracking-[0.18em]"
      style={{ color: HUD.textDim }}
    >
      {children}
    </h3>
  );
}

export function StatusLightProtocolLegend({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? 'grid grid-cols-2 gap-2 sm:grid-cols-5'
          : 'grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5'
      }
    >
      {STATUS_LIGHT_STATES.map(state => {
        const meta = STATUS_LIGHT_META[state];
        return (
          <div
            className="flex min-w-0 items-center gap-2 rounded-[6px] border px-2.5 py-2"
            key={state}
            style={{
              borderColor: `color-mix(in srgb, ${meta.color} 18%, ${HUD.strokeFaint})`,
              background: `color-mix(in srgb, ${meta.color} 4%, ${HUD.bg.panel})`,
            }}
          >
            <StatusLight decorative size="compact" state={state} />
            <div className="min-w-0">
              <p
                className="truncate text-[11px] font-semibold"
                style={{ color: meta.color }}
              >
                {meta.protocolLabel}
              </p>
              {!compact && (
                <p
                  className="truncate font-mono text-[9px]"
                  style={{ color: HUD.textDim }}
                >
                  {meta.sourceColor}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgentTabSpecimen({ state }: { state: StatusLightState }) {
  const meta = STATUS_LIGHT_META[state];
  const sample = SAMPLE[state];
  return (
    <div
      aria-label={`${sample.title}, ${meta.label}`}
      className="relative flex min-w-0 items-center gap-2 rounded-[5px] border px-2.5 py-2"
      style={{
        color: HUD.text,
        borderColor: HUD.strokeFaint,
        background: HUD.bg.panelFill,
      }}
    >
      <span
        aria-hidden="true"
        className="h-5 w-[2px] shrink-0 rounded-full"
        style={{ background: '#9D7BFF' }}
      />
      <StatusLight decorative size="compact" state={state} />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
        {sample.title}
      </span>
      <span
        className="truncate font-mono text-[9px] uppercase tracking-[0.08em]"
        style={{ color: meta.color }}
      >
        {meta.protocolLabel}
      </span>
    </div>
  );
}

export function AgentTabStatusSpecimens() {
  return (
    <div className="flex flex-col gap-2.5">
      <SpecimenHeading>Agent tabs · compact priority light</SpecimenHeading>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {STATUS_LIGHT_STATES.map(state => (
          <AgentTabSpecimen key={state} state={state} />
        ))}
      </div>
    </div>
  );
}

function SessionTileSpecimen({ state }: { state: StatusLightState }) {
  const meta = STATUS_LIGHT_META[state];
  const sample = SAMPLE[state];
  return (
    <article
      className="relative min-h-32 overflow-hidden rounded-[8px] border p-3.5"
      style={{
        borderColor: `color-mix(in srgb, ${meta.color} 18%, ${HUD.strokeFaint})`,
        background: HUD.bg.panelFill,
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: '#9D7BFF' }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold">{sample.title}</p>
          <p className="mt-1 truncate text-xs" style={{ color: HUD.textDim }}>
            {sample.goal}
          </p>
        </div>
        <StatusLight state={state} />
      </div>
      <div className="mt-7 flex items-end justify-between gap-3">
        <span
          className="font-mono text-[9px] uppercase tracking-[0.12em]"
          style={{ color: HUD.textDim }}
        >
          Exawatt
        </span>
        <span
          className="text-[11px] font-semibold"
          style={{ color: meta.color }}
        >
          {sample.detail}
        </span>
      </div>
    </article>
  );
}

export function SessionStatusSpecimens() {
  return (
    <div className="flex flex-col gap-2.5">
      <SpecimenHeading>Team · diffuse state surface</SpecimenHeading>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {STATUS_LIGHT_STATES.map(state => (
          <SessionTileSpecimen key={state} state={state} />
        ))}
      </div>
    </div>
  );
}

export function StatusLightDomSpecimens() {
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <StatusLightProtocolLegend />
      <AgentTabStatusSpecimens />
      <SessionStatusSpecimens />
    </div>
  );
}
