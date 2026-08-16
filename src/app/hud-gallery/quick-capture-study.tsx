'use client';

import { useState } from 'react';
import { QuickCaptureBar } from '@/components/feedback/quick-capture-bar';
import type { DiagnosticsReport } from '@/types/electron';
import type { QuickFeedbackKind } from '@/components/feedback/quick-feedback-events';

/**
 * ENG-025 F5 quick-capture study.
 *
 * The diagnostics chip shipped without anyone rendering it: it was correct in
 * types and unit tests and wrapped to two lines in the real bar, because the
 * chip row had no width budget left. Unit tests assert behavior and cannot see
 * a layout. This surface exists so the row's densest state is one screenshot
 * away.
 *
 * The densest state is the one that matters: Bug selected, a screenshot
 * attached, diagnostics attached, and a message long enough to wrap.
 */

const SHOT =
  'data:image/svg+xml;base64,' +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="40"><rect width="64" height="40" fill="#0b2536"/><rect x="4" y="6" width="24" height="4" fill="#2ea8c8"/><rect x="4" y="14" width="40" height="4" fill="#1a6c85"/><rect x="4" y="22" width="32" height="4" fill="#1a6c85"/></svg>`
  );

const REPORT: DiagnosticsReport = {
  reportVersion: 1,
  generatedAt: '2026-08-14T12:00:00.000Z',
  app: {
    version: '0.1.10',
    sha: 'fe59aef1c2d3',
    branch: 'master',
    delivery: 'signed',
    packaged: true,
    installPath: '/Applications/Exawatt.app',
  },
  system: {
    platform: 'darwin',
    arch: 'arm64',
    osRelease: '15.0',
    electron: '43.1.0',
    node: '24.18.0',
    locale: 'en-US',
  },
  update: { phase: 'error', error: 'ENOSPC: no space left on device' },
  session: { signedIn: false, liveSessions: 4 },
  logs: [
    {
      name: 'updater.jsonl',
      present: true,
      lines: [{ event: 'updater.error', code: 'ENOSPC' }],
    },
  ],
};

const LONG_MESSAGE =
  'In Team, down arrow from the last Exawatt tile and it moved left to the ' +
  'second to last one, not down to the immediate-below tile which is in the ' +
  "next project's row";

interface Case {
  id: string;
  label: string;
  kind: QuickFeedbackKind;
  message: string;
  screenshot: string | null;
  attachScreenshot: boolean;
  attachDiagnostics: boolean;
}

const CASES: Case[] = [
  {
    id: 'dense',
    label: 'Densest row: Bug, screenshot and diagnostics both on',
    kind: 'bug',
    message: LONG_MESSAGE,
    screenshot: SHOT,
    attachScreenshot: true,
    attachDiagnostics: true,
  },
  {
    id: 'bug-offered',
    label: 'Bug, diagnostics offered but off',
    kind: 'bug',
    message: 'Tab strip flickers on restore',
    screenshot: SHOT,
    attachScreenshot: false,
    attachDiagnostics: false,
  },
  {
    id: 'general',
    label: 'General: no diagnostics chip at all',
    kind: 'general',
    message: 'The roadmap rail count looks off',
    screenshot: SHOT,
    attachScreenshot: true,
    attachDiagnostics: false,
  },
  {
    id: 'no-shot',
    label: 'Bug with no screenshot available',
    kind: 'bug',
    message: 'Agent source picker is empty',
    screenshot: null,
    attachScreenshot: false,
    attachDiagnostics: true,
  },
];

function StudyCase({ entry }: { entry: Case }) {
  const [kind, setKind] = useState<QuickFeedbackKind>(entry.kind);
  const [message, setMessage] = useState(entry.message);
  const [shot, setShot] = useState(entry.attachScreenshot);
  const [diagnostics, setDiagnostics] = useState(entry.attachDiagnostics);
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-chrome-micro text-muted-foreground">
        {entry.label}
      </p>
      <QuickCaptureBar
        kind={kind}
        onKindChange={setKind}
        message={message}
        onMessageChange={setMessage}
        screenshot={entry.screenshot}
        attachScreenshot={shot}
        onAttachScreenshotChange={setShot}
        diagnostics={REPORT}
        attachDiagnostics={diagnostics}
        onAttachDiagnosticsChange={setDiagnostics}
        error={null}
        onSubmit={() => undefined}
        onDismiss={() => undefined}
      />
    </div>
  );
}

export function QuickCaptureStudy() {
  return (
    <div
      data-quick-capture-study
      className="flex flex-col items-start gap-8 py-4"
    >
      {CASES.map(entry => (
        <StudyCase key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
