'use client';

/**
 * Connect in one step (ENG-033 H2.4), for operator review before production.
 *
 * Direction the operator set on 2026-09-23 after a real-app audit of the
 * current Connect flow (six screens and five clicks per server; both servers
 * took thirteen clicks, two scrolls and a terminal session):
 *
 *   - a connected coworker's default home is one special Project, "Remote"
 *     for now, and the name may change;
 *   - Connect is offered from ⌘T inside a Project (the coworker joins that
 *     Project) and from ⌘N (the coworker joins Remote);
 *   - repair and redesign together.
 *
 * Every specimen is static product UI built from the workspace HUD roles.
 * Product copy inside a specimen is written as production copy; the captions
 * around it are the workbench's. Send access (ENG-033 H2.2) is a step in
 * setting up each server, decided by the operator on 2026-09-24: approve in
 * one click, which Exawatt runs over the operator's own SSH login, or copy
 * the command and run it by hand.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Cable,
  Check,
  ChevronDown,
  Copy,
  Folder,
  FolderInput,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Server,
  SquareTerminal,
  TriangleAlert,
} from 'lucide-react';
import { StatusLight } from '@/components/status-light';
import { SourceIdentityMark } from '@/components/workspace/source-identity-mark';
import { OpenClawIcon } from '@/components/workspace/harness-icons';
import {
  WORKSPACE_HUD as HUD,
  withThemeAlpha,
} from '@/components/workspace/workspace-theme';

const OPENCLAW_COLOR = '#8BB9ED';
const REMOTE_PROJECT = 'Remote';

/* -------------------------------------------------------------------------- */
/* Workbench chrome                                                           */
/* -------------------------------------------------------------------------- */

function Specimen({
  id,
  label,
  caption,
  children,
}: {
  id: string;
  label: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-label`}
      className="flex min-w-0 flex-col gap-3"
      data-connect-specimen={id}
    >
      <div className="flex flex-col gap-1">
        <h2
          id={`${id}-label`}
          className="font-mono text-chrome-label"
          style={{ color: HUD.textDim }}
        >
          {label}
        </h2>
        <p
          className="max-w-prose text-chrome-meta"
          style={{ color: HUD.textDim }}
        >
          {caption}
        </p>
      </div>
      {children}
    </section>
  );
}

function DialogFrame({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string | null;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div
      className="flex w-full max-w-[560px] flex-col overflow-hidden rounded-md border"
      style={{ background: HUD.bg.deep, borderColor: HUD.strokeSoft }}
    >
      <div
        className="flex flex-col gap-1 border-b px-5 py-4"
        style={{ borderColor: HUD.strokeFaint }}
      >
        <p className="font-display text-base" style={{ color: HUD.text }}>
          {title}
        </p>
        {subtitle ? (
          <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-4 px-5 py-4">{children}</div>
      <div
        className="flex items-center justify-between gap-2 border-t px-4 py-3"
        style={{ borderColor: HUD.strokeFaint }}
      >
        {footer}
      </div>
    </div>
  );
}

function SecondaryButton({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex h-8 items-center gap-2 rounded border px-3 text-chrome-label"
      style={{ color: HUD.text, borderColor: HUD.strokeSoft }}
    >
      {children}
    </span>
  );
}

function PrimaryButton({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex h-8 items-center gap-2 rounded px-3 text-chrome-label font-medium"
      style={{
        background: withThemeAlpha(HUD.green, 0.85),
        color: HUD.bg.void,
      }}
    >
      {children}
      <span className="font-mono text-chrome-micro opacity-70">⌘⏎</span>
    </span>
  );
}

function OpenClawMark() {
  return (
    <SourceIdentityMark color={OPENCLAW_COLOR}>
      <OpenClawIcon size={12} />
    </SourceIdentityMark>
  );
}

function Chip({
  children,
  tone = 'quiet',
}: {
  children: ReactNode;
  tone?: 'quiet' | 'strong';
}) {
  return (
    <span
      className="rounded border px-1.5 py-0.5 font-mono text-chrome-micro"
      style={{
        borderColor: tone === 'strong' ? HUD.strokeSoft : HUD.strokeFaint,
        color: tone === 'strong' ? HUD.text : HUD.textDim,
      }}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* ⌘N: the Remote home                                                        */
/* -------------------------------------------------------------------------- */

function OpenProjectSpecimen() {
  const rows = [
    {
      name: REMOTE_PROJECT,
      meta: '3 coworkers · openclaw-a, openclaw-b',
      remote: true,
    },
    { name: 'exawatt', meta: '~/Code/exawatt', remote: false },
    { name: 'photo-generator', meta: '~/Code/photo-generator', remote: false },
  ];
  return (
    <DialogFrame
      title="Open Project"
      subtitle={null}
      footer={
        <>
          <span />
          <span className="flex items-center gap-2">
            <SecondaryButton>
              <Folder size={12} /> Browse Folder
            </SecondaryButton>
            <SecondaryButton>
              <FolderInput size={12} /> Import Folder
            </SecondaryButton>
            <SecondaryButton>
              <Cable size={12} /> Connect a server
            </SecondaryButton>
          </span>
        </>
      }
    >
      <div
        className="flex h-9 items-center gap-2 rounded border px-3 text-sm"
        style={{
          borderColor: HUD.strokeSoft,
          background: HUD.surfaceInput,
          color: HUD.textDim,
        }}
      >
        <Search size={13} /> Search Projects
      </div>
      <ul className="flex flex-col gap-0.5" data-project-rows>
        {rows.map((row, index) => (
          <li
            key={row.name}
            className="flex items-center gap-3 rounded px-3 py-2"
            data-remote-home={row.remote || undefined}
            style={{ background: index === 0 ? HUD.fill : undefined }}
          >
            {row.remote ? (
              <Server size={14} style={{ color: HUD.textDim }} />
            ) : (
              <Folder size={14} style={{ color: HUD.textDim }} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-sm" style={{ color: HUD.text }}>
                {row.name}
              </span>
              <span
                className="block truncate text-chrome-meta"
                style={{ color: HUD.textDim }}
              >
                {row.meta}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </DialogFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* ⌘T: inside a Project                                                       */
/* -------------------------------------------------------------------------- */

interface SetupChipModel {
  id: string;
  kind: string;
  engine: string;
  model: string;
  detail: string;
  remote?: boolean;
}

const SETUPS: readonly SetupChipModel[] = [
  {
    id: 'claude',
    kind: 'Coding',
    engine: 'Claude Code',
    model: 'Sonnet 4.6',
    detail: 'Medium',
  },
  {
    id: 'codex',
    kind: 'Coding',
    engine: 'Codex',
    model: 'GPT-5.3 Codex',
    detail: 'Extra high',
  },
  {
    id: 'scout',
    kind: 'Coworker',
    engine: 'OpenClaw',
    model: 'Scout',
    detail: 'openclaw-a',
    remote: true,
  },
];

function LauncherSpecimen() {
  const [selected, setSelected] = useState('scout');
  const chosen = SETUPS.find(setup => setup.id === selected) ?? SETUPS[0];
  return (
    <div
      className="flex w-full max-w-[760px] flex-col gap-3 rounded-md border p-4"
      style={{ background: HUD.bg.deep, borderColor: HUD.strokeSoft }}
      data-launcher-specimen
    >
      <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
        New Agent in exawatt
      </p>
      <div
        className="rounded border px-3 py-2.5 text-sm"
        style={{
          borderColor: HUD.strokeSoft,
          background: HUD.surfaceInput,
          color: HUD.text,
        }}
      >
        Draft this week&rsquo;s launch thread from the changelog
      </div>
      <div className="flex flex-wrap items-stretch gap-2">
        {SETUPS.map(setup => {
          const active = setup.id === selected;
          return (
            <button
              key={setup.id}
              type="button"
              aria-pressed={active}
              data-setup-chip={setup.id}
              onClick={() => setSelected(setup.id)}
              className="flex w-40 flex-col gap-0.5 rounded border px-3 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
              style={{
                borderColor: active ? HUD.stroke : HUD.strokeFaint,
                background: active ? HUD.fillHi : 'transparent',
              }}
            >
              <span
                className="flex items-center gap-1.5 font-mono text-chrome-micro"
                style={{ color: HUD.textDim }}
              >
                {setup.remote ? <Server size={10} /> : null}
                {setup.kind}
              </span>
              <span className="text-chrome-meta" style={{ color: HUD.textDim }}>
                {setup.engine}
              </span>
              <span className="text-sm font-medium" style={{ color: HUD.text }}>
                {setup.model}
              </span>
              <span className="text-chrome-meta" style={{ color: HUD.textDim }}>
                {setup.detail}
              </span>
            </button>
          );
        })}
        <span
          className="flex w-20 flex-col items-center justify-center gap-1 rounded border text-chrome-meta"
          data-more-open
          style={{
            borderColor: HUD.strokeSoft,
            background: HUD.fill,
            color: HUD.text,
          }}
        >
          <Plus size={14} /> More
        </span>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ul
          aria-label="More, open"
          className="flex w-64 flex-col rounded border py-1"
          data-more-menu
          style={{ background: HUD.bg.panel, borderColor: HUD.strokeSoft }}
        >
          <li
            className="px-3 py-1.5 text-chrome-label"
            style={{ color: HUD.textDim }}
          >
            All engines and models
          </li>
          <li
            className="flex items-center gap-2 px-3 py-1.5 text-chrome-label"
            style={{ background: HUD.fill, color: HUD.text }}
          >
            <Cable size={12} /> Connect a server into exawatt
          </li>
          <li
            className="flex items-center gap-2 px-3 py-1.5 text-chrome-label"
            style={{ color: HUD.textDim }}
          >
            <SquareTerminal size={12} /> Shell
          </li>
        </ul>
        <PrimaryButton>
          {chosen.remote ? `Send to ${chosen.model}` : 'Start'}
        </PrimaryButton>
      </div>
      <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
        {chosen.remote
          ? `${chosen.model} joins exawatt and keeps running on ${chosen.detail}.`
          : 'Starts a new Agent on this machine.'}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Connect: choose, confirm, fail                                             */
/* -------------------------------------------------------------------------- */

function FilterField({ value }: { value: string }) {
  return (
    <div
      className="flex h-9 items-center gap-2 rounded border px-3 text-sm"
      style={{
        borderColor: HUD.stroke,
        background: HUD.surfaceInput,
        color: HUD.text,
      }}
    >
      <Search size={13} style={{ color: HUD.textDim }} />
      {value}
      <span
        className="ml-auto font-mono text-chrome-micro"
        style={{ color: HUD.textDim }}
      >
        2 of 12 servers
      </span>
    </div>
  );
}

function ServerRow({
  alias,
  state,
  detail,
}: {
  alias: string;
  state: 'connected' | 'selected' | 'testing' | 'ready' | 'failed' | 'idle';
  detail?: string;
}) {
  const mark =
    state === 'connected' || state === 'ready' ? (
      <Check size={14} style={{ color: HUD.green }} />
    ) : state === 'testing' ? (
      <LoaderCircle
        size={14}
        className="animate-spin motion-reduce:animate-none"
        style={{ color: HUD.cyan }}
      />
    ) : state === 'failed' ? (
      <TriangleAlert size={14} style={{ color: HUD.amber }} />
    ) : state === 'selected' ? (
      <Check size={14} style={{ color: HUD.cyan }} />
    ) : (
      <Server size={14} style={{ color: HUD.textDim }} />
    );
  return (
    <li
      className="flex items-center gap-3 rounded px-3 py-2"
      data-server-row={alias}
      data-server-state={state}
      style={{
        background:
          state === 'testing' || state === 'ready' || state === 'selected'
            ? HUD.fill
            : undefined,
      }}
    >
      <span className="grid h-4 w-4 place-items-center">{mark}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm" style={{ color: HUD.text }}>
          {alias}
        </span>
        {detail ? (
          <span
            className="block text-chrome-meta"
            style={{ color: state === 'failed' ? HUD.amber : HUD.textDim }}
          >
            {detail}
          </span>
        ) : null}
      </span>
      {state === 'connected' ? (
        <span
          className="text-chrome-label underline underline-offset-2"
          style={{ color: HUD.textDim }}
        >
          Manage
        </span>
      ) : null}
      {state === 'failed' ? (
        <span
          className="flex gap-3 text-chrome-label"
          style={{ color: HUD.text }}
        >
          <span className="underline underline-offset-2">Try again</span>
          <span
            className="underline underline-offset-2"
            style={{ color: HUD.textDim }}
          >
            Remove
          </span>
        </span>
      ) : null}
    </li>
  );
}

function ProjectPicker({ project }: { project: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-chrome-meta" style={{ color: HUD.textDim }}>
        Add to
      </span>
      <span
        className="inline-flex h-8 items-center gap-2 rounded border px-3 text-chrome-label"
        data-project-picker
        style={{ borderColor: HUD.strokeSoft, color: HUD.text }}
      >
        {project === REMOTE_PROJECT ? (
          <Server size={12} />
        ) : (
          <Folder size={12} />
        )}
        {project}
        <ChevronDown size={12} style={{ color: HUD.textDim }} />
      </span>
    </div>
  );
}

function ChooseSpecimen() {
  return (
    <DialogFrame
      title="Connect a server"
      subtitle={`Into ${REMOTE_PROJECT}`}
      footer={
        <>
          <span className="text-chrome-label" style={{ color: HUD.textDim }}>
            Describe a server
          </span>
          <span className="flex items-center gap-2">
            <SecondaryButton>Cancel</SecondaryButton>
          </span>
        </>
      }
    >
      <FilterField value="open" />
      <ul className="flex flex-col gap-0.5">
        <ServerRow
          alias="openclaw-a"
          state="connected"
          detail="Connected · Scout, reddit"
        />
        <ServerRow
          alias="openclaw-b"
          state="testing"
          detail="Pairing this device for read access"
        />
      </ul>
      <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
        Agents appear here as soon as openclaw-b answers.
      </p>
    </DialogFrame>
  );
}

type AccessPath = 'offer' | 'copy';

/**
 * Send access as a step in setting up one server (operator, 2026-09-24:
 * "a connection or setup flow to set up a particular server endpoint. It
 * should be one-click to run that command or let the user copy and run it
 * themselves"). One approval covers every Agent on the server, so the step
 * belongs to the server, not to an Agent.
 */
function SendAccessBlock({
  server,
  initial,
}: {
  server: string;
  initial: AccessPath;
}) {
  const [path, setPath] = useState<AccessPath | 'approved'>(initial);
  const [copied, setCopied] = useState(false);
  if (path === 'approved') {
    return (
      <div
        className="flex items-center gap-2 rounded border p-3 text-sm"
        data-send-access="approved"
        style={{ borderColor: HUD.strokeFaint, color: HUD.text }}
      >
        <Check size={14} style={{ color: HUD.green }} />
        Exawatt can send to Agents on {server}
      </div>
    );
  }
  return (
    <div
      className="flex flex-col gap-2 rounded border p-3"
      data-send-access={path}
      style={{ borderColor: HUD.strokeFaint }}
    >
      <span className="text-sm" style={{ color: HUD.text }}>
        Let Exawatt send to Agents on {server}
      </span>
      <span className="text-chrome-meta" style={{ color: HUD.textDim }}>
        One approval on the server covers every Agent there.
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-send-access-action="approve"
          onClick={() => setPath('approved')}
          className="inline-flex h-8 items-center gap-2 rounded border px-3 text-chrome-label outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
          style={{ borderColor: HUD.stroke, color: HUD.text }}
        >
          <Check size={12} /> Approve on {server}
        </button>
        <button
          type="button"
          data-send-access-action="copy"
          aria-expanded={path === 'copy'}
          onClick={() => setPath('copy')}
          className="inline-flex h-8 items-center gap-2 rounded px-2 text-chrome-label outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
          style={{ color: HUD.textDim }}
        >
          <Copy size={12} /> Show commands
        </button>
      </div>
      {path === 'copy' ? (
        <div className="flex flex-col gap-2" data-send-access-commands>
          <div className="flex items-start gap-2">
            <pre
              className="min-w-0 flex-1 overflow-x-auto rounded border px-2.5 py-2 font-mono text-chrome-meta"
              style={{ borderColor: HUD.strokeFaint, color: HUD.text }}
            >
              {`ssh ${server}\nopenclaw devices approve 7f3a2c`}
            </pre>
            <button
              type="button"
              onClick={() => setCopied(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded px-2 text-chrome-label outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
              style={{ color: HUD.textDim }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <span className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPath('approved')}
              className="inline-flex h-8 items-center rounded border px-3 text-chrome-label outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
              style={{ borderColor: HUD.strokeSoft, color: HUD.text }}
            >
              Check again
            </button>
            <span className="text-chrome-meta" style={{ color: HUD.textDim }}>
              Run these, then check again.
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function ConfirmSpecimen({
  access,
  project,
}: {
  access: AccessPath;
  project: string;
}) {
  return (
    <DialogFrame
      title="Connect a server"
      subtitle={`Into ${project}`}
      footer={
        <>
          <span className="text-chrome-label" style={{ color: HUD.textDim }}>
            Describe a server
          </span>
          <span className="flex items-center gap-2">
            <SecondaryButton>Cancel</SecondaryButton>
            <PrimaryButton>Connect Tyler</PrimaryButton>
          </span>
        </>
      }
    >
      <FilterField value="open" />
      <ul className="flex flex-col gap-0.5">
        <ServerRow
          alias="openclaw-a"
          state="connected"
          detail="Connected · Scout, reddit"
        />
        <ServerRow
          alias="openclaw-b"
          state="ready"
          detail="OpenClaw 2026.9.12 · 1 Agent"
        />
      </ul>
      <div className="flex flex-col gap-1" data-agent-rows>
        <div className="flex items-center gap-3 rounded px-3 py-2">
          <span
            className="grid h-4 w-4 shrink-0 place-items-center border"
            style={{ borderColor: HUD.cyan, color: HUD.cyan }}
          >
            <Check size={12} />
          </span>
          <OpenClawMark />
          <span className="min-w-0 flex-1">
            <span
              className="flex items-center gap-2 text-sm"
              style={{ color: HUD.text }}
            >
              Tyler
              <Pencil
                size={11}
                style={{ color: HUD.textDim }}
                aria-label="Rename"
              />
            </span>
            <span
              className="block text-chrome-meta"
              style={{ color: HUD.textDim }}
            >
              No conversation · 1 automation, every hour
            </span>
          </span>
        </div>
      </div>
      <ProjectPicker project={project} />
      <SendAccessBlock server="openclaw-b" initial={access} />
    </DialogFrame>
  );
}

function FailureSpecimen() {
  return (
    <DialogFrame
      title="Connect a server"
      subtitle={`Into ${REMOTE_PROJECT}`}
      footer={
        <>
          <span className="text-chrome-label" style={{ color: HUD.textDim }}>
            Describe a server
          </span>
          <span className="flex items-center gap-2">
            <SecondaryButton>Cancel</SecondaryButton>
            <PrimaryButton>Connect Tyler</PrimaryButton>
          </span>
        </>
      }
    >
      <ul className="flex flex-col gap-0.5">
        <ServerRow
          alias="54.84.250.195"
          state="failed"
          detail="Didn’t answer on SSH. Nothing was saved."
        />
        <ServerRow
          alias="openclaw-b"
          state="ready"
          detail="OpenClaw 2026.9.12 · 1 Agent"
        />
      </ul>
    </DialogFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Where they land                                                            */
/* -------------------------------------------------------------------------- */

function LandingSpecimen() {
  const coworkers = [
    { name: 'Scout', server: 'openclaw-a', fresh: false },
    { name: 'reddit', server: 'openclaw-a', fresh: false },
    { name: 'Tyler', server: 'openclaw-b', fresh: true },
  ];
  return (
    <div
      className="flex w-full max-w-[760px] flex-col gap-3 rounded-md border p-4"
      style={{ background: HUD.bg.deep, borderColor: HUD.strokeSoft }}
    >
      <p
        className="flex items-center gap-2 text-sm font-medium"
        style={{ color: HUD.text }}
      >
        <Server size={13} style={{ color: HUD.textDim }} />
        {REMOTE_PROJECT}
        <span
          className="font-mono text-chrome-micro"
          style={{ color: HUD.textDim }}
        >
          3 coworkers
        </span>
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {coworkers.map(coworker => (
          <div
            key={coworker.name}
            className="flex flex-col gap-2 rounded border p-3"
            data-landing-card={coworker.name}
            style={{
              borderColor: coworker.fresh ? HUD.stroke : HUD.strokeFaint,
              background: coworker.fresh ? HUD.fillHi : 'transparent',
            }}
          >
            <span className="flex items-center gap-2">
              <StatusLight state="off" size="compact" />
              <span className="text-sm" style={{ color: HUD.text }}>
                {coworker.name}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              <Chip>{coworker.server}</Chip>
              {coworker.fresh ? (
                <Chip tone="strong">Just connected</Chip>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The study                                                                  */
/* -------------------------------------------------------------------------- */

export function ConnectFlowStudy() {
  return (
    <div className="flex flex-col gap-12" data-connect-flow-study>
      <div className="grid grid-cols-1 gap-10 xl:grid-cols-2">
        <Specimen
          id="entry-n"
          label="⌘N · Open Project"
          caption="Remote is the default home for connected coworkers. Connect a server sits beside Browse Folder on one line."
        >
          <OpenProjectSpecimen />
        </Specimen>
        <Specimen
          id="entry-t"
          label="⌘T · New Agent inside a Project"
          caption="A connected coworker is a setup like any engine. Choosing Scout makes Start send the task to Scout, and Scout joins this Project. Connect a server lives under More."
        >
          <LauncherSpecimen />
        </Specimen>
      </div>

      <div className="grid grid-cols-1 gap-10 xl:grid-cols-2">
        <Specimen
          id="choose"
          label="Connect · choosing"
          caption="Type to filter. A saved server says so and opens its Settings. Picking a server starts its test in place."
        >
          <ChooseSpecimen />
        </Specimen>
        <Specimen
          id="fail"
          label="Connect · a server that fails"
          caption="A failure stays on its row, saves nothing, and does not stop the servers that answered."
        >
          <FailureSpecimen />
        </Specimen>
      </div>

      <div className="grid grid-cols-1 gap-10 xl:grid-cols-2">
        <Specimen
          id="confirm"
          label="Connect · confirm, with send access"
          caption="One screen from answer to done. Send access is part of setting up the server: approve in one click, or copy the commands and run them yourself."
        >
          <ConfirmSpecimen access="offer" project={REMOTE_PROJECT} />
        </Specimen>
        <Specimen
          id="confirm-copy"
          label="Connect · confirm, running it yourself"
          caption="Opened from ⌘T in exawatt, so the Project is exawatt. The copy path shows the exact command for Exawatt's own request, then Check again finishes it."
        >
          <ConfirmSpecimen access="copy" project="exawatt" />
        </Specimen>
      </div>

      <Specimen
        id="landing"
        label="Where they land"
        caption="Connect closes onto the Project it filled, with the new coworker marked."
      >
        <LandingSpecimen />
      </Specimen>
    </div>
  );
}
