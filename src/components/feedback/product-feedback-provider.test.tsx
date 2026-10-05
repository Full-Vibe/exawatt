import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProductFeedbackProvider,
  useProductFeedback,
} from './product-feedback-provider';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import type { DiagnosticsReport } from '@exawatt/core/desktop-bridge';
import * as feedbackImageIO from '@/lib/feedback/image';
import { setQuickFeedbackAttribution } from './quick-feedback-events';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => {
    resolve = settle;
  });
  return { promise, resolve };
}

function retainDialogExit() {
  const getStyle = window.getComputedStyle.bind(window);
  vi.stubGlobal('getComputedStyle', (element: Element) => {
    const style = getStyle(element);
    return new Proxy(style, {
      get(target, property) {
        if (
          property === 'animationName' &&
          element.matches(
            '[data-slot="dialog-content"], [data-slot="dialog-overlay"]'
          )
        )
          return element.getAttribute('data-state') === 'closed'
            ? 'test-exit'
            : 'test-entry';
        return Reflect.get(target, property, target);
      },
    });
  });
}

function finishDialogExit() {
  for (const element of document.querySelectorAll('[data-state="closed"]')) {
    const completed = new Event('animationend', { bubbles: true });
    Object.defineProperty(completed, 'animationName', { value: 'test-exit' });
    fireEvent(element, completed);
  }
}

const SHOT = 'data:image/png;base64,cG5n';
const NEW_SHOT = 'data:image/png;base64,bmV3';
const INITIAL_HREF = window.location.href;
const REPORT: DiagnosticsReport = {
  reportVersion: 1,
  generatedAt: '2026-10-02T00:00:00.000Z',
  app: {
    version: 'test',
    sha: 'captured-sha',
    branch: 'agent/test',
    delivery: 'test',
    packaged: false,
    installPath: '/test',
  },
  system: {
    platform: 'darwin',
    arch: 'arm64',
    osRelease: 'test',
    electron: 'test',
    node: 'test',
    locale: 'en-US',
  },
  update: null,
  session: { signedIn: true, liveSessions: 1 },
  logs: [],
};

function feedbackResponse(attachmentStored = false) {
  return Response.json(
    {
      schemaVersion: 1,
      id: '223e4567-e89b-42d3-a456-426614174000',
      duplicate: false,
      attachmentStored,
    },
    { status: 201, headers: { 'Exawatt-Service-Version': '1' } }
  );
}

function feedbackProblem(status: number, retryable: boolean) {
  return Response.json(
    {
      type: 'https://feedback.example.test/problems/refusal',
      title: 'Feedback operation refused',
      status,
      code: 'operation_refused',
      retryable,
    },
    {
      status,
      headers: {
        'Content-Type': 'application/problem+json',
        'Exawatt-Service-Version': '1',
      },
    }
  );
}

async function renderSignedIn() {
  distributionState.current = distribution({
    url: FEEDBACK_URL,
    protocolVersion: 1,
  });
  render(
    <ProductFeedbackProvider>
      <button type="button">Work area</button>
      <Probe />
    </ProductFeedbackProvider>
  );
  await waitFor(() => expect(feedback?.isAuthenticated).toBe(true));
}

function composerField() {
  return screen.getByRole('textbox', { name: 'Feedback' });
}

function composerImage() {
  return screen.getByRole('img', { name: 'Feedback attachment preview' });
}

function receiptRegion() {
  const element = document.querySelector<HTMLElement>('[data-feedback-attempt]');
  expect(element).toBeInTheDocument();
  return element!;
}

const { distributionState, clientState, createOptionalClient } = vi.hoisted(
  () => ({
    distributionState: { current: null as unknown },
    clientState: { current: null as ReturnType<typeof client> | null },
    createOptionalClient: vi.fn(() => clientState.current),
  })
);

vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => distributionState.current,
}));

vi.mock('@/lib/supabase/client', () => ({
  createOptionalClient,
}));

const FEEDBACK_URL = 'https://feedback.example.test/v1/intake';
const SESSION = {
  access_token: 'header.payload.signature',
  user: { id: 'user-1' },
};

function distribution(productFeedback: object | null) {
  return {
    schemaVersion: 1,
    brand: null,
    account: productFeedback
      ? {
          supabaseUrl: 'https://account.example.test',
          supabaseAnonKey: 'public-anon-key',
          recoveryOrigin: 'https://app.example.test',
        }
      : null,
    services: {
      productFeedback,
      operatorStats: null,
      projects: null,
      preferences: null,
      accountData: null,
    },
    enrichment: {
      contextLabels: null,
      conversationSummaries: null,
      goalVisuals: null,
    },
    analytics: null,
    updates: null,
  };
}

function client(session = SESSION) {
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session } })),
      onAuthStateChange: vi.fn(
        (listener: (event: string, value: typeof SESSION | null) => void) => {
          let active = true;
          queueMicrotask(() => {
            if (active) listener('INITIAL_SESSION', session);
          });
          return {
            data: {
              subscription: {
                unsubscribe: () => {
                  active = false;
                },
              },
            },
          };
        }
      ),
    },
  };
}

let feedback: ReturnType<typeof useProductFeedback> | null = null;

function Probe() {
  const value = useProductFeedback();
  // Publishing the hook result to the module binding is a side effect, so it
  // belongs in an effect rather than in render (react-hooks/globals). Render
  // reads only `value`.
  useEffect(() => {
    feedback = value;
  });
  return (
    <p>
      {value.isAvailable ? 'Feedback configured' : 'Feedback unavailable'}
      {' / '}
      {value.isAuthenticated ? 'signed in' : 'signed out'}
    </p>
  );
}

beforeEach(() => {
  feedback = null;
  createOptionalClient.mockClear();
  clientState.current = client();
  removeBridgeDouble();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
});

afterEach(() => {
  cleanup();
  setQuickFeedbackAttribution(null);
  window.history.replaceState(null, '', INITIAL_HREF);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('unified feedback composer continuity', () => {
  it('reopening during a retained Radix exit preserves the original work invoker', async () => {
    retainDialogExit();
    await renderSignedIn();
    const invoker = screen.getByRole('button', { name: 'Work area' });
    invoker.focus();
    await act(async () => feedback!.openFeedback());
    const field = composerField();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(
      document.querySelector(
        '[data-slot="dialog-content"][data-state="closed"]'
      )
    ).toBeInTheDocument();
    // Native inertness blurs the retained input; jsdom does not implement
    // that browser behavior. Reproduce the observed BODY focus explicitly.
    field.blur();
    expect(document.activeElement).toBe(document.body);
    await act(async () => feedback!.openQuickCapture());
    expect(composerField()).toHaveFocus();
    fireEvent.keyDown(composerField(), { key: 'Escape' });
    // If focus leaves the retained subtree before unmount, reopening still
    // owes restoration to the original work control.
    field.blur();
    expect(document.activeElement).toBe(document.body);
    await act(async () => feedback!.openQuickCapture());
    expect(composerField().closest('[data-slot="dialog-content"]')).not.toHaveAttribute('inert');
    expect(composerField()).toHaveFocus();
    fireEvent.keyDown(composerField(), { key: 'Escape' });
    finishDialogExit();
    await waitFor(() => expect(invoker).toHaveFocus());
  });
  it('closed retained editor cannot send by Enter or button activation, and reopening keeps its draft', async () => {
    retainDialogExit();
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(feedbackResponse());
    vi.stubGlobal('fetch', fetchSpy);
    await renderSignedIn();
    await act(async () => feedback!.openFeedback());
    const field = composerField();
    fireEvent.change(field, { target: { value: 'Keep this unsent report' } });
    const submit = screen.getByRole('button', { name: /^Send feedback/ });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field.isConnected).toBe(true);
    expect(field.closest('[data-slot="dialog-content"]')).toHaveAttribute('inert');
    // These synthetic events bypass native inert. The write boundary must
    // still reject them while the composer is logically closed.
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.click(submit);
    expect(fetchSpy).not.toHaveBeenCalled();
    finishDialogExit();
    await act(async () => feedback!.openFeedback());
    expect(composerField()).toHaveValue('Keep this unsent report');
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    finishDialogExit();
  });
  it.each([
    { status: 500, retryable: false },
    { status: 400, retryable: true },
    { status: 400, retryable: false },
  ])(
    'honors explicit service retryability independently of status $status',
    async ({ status, retryable }) => {
      const fetchSpy = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(feedbackProblem(status, retryable))
        .mockResolvedValueOnce(feedbackResponse());
      vi.stubGlobal('fetch', fetchSpy);
      await renderSignedIn();
      await act(async () => feedback!.openFeedback());
      fireEvent.change(composerField(), {
        target: { value: 'Follow the service retry contract' },
      });
      fireEvent.keyDown(composerField(), { key: 'Enter' });
      await waitFor(() =>
        expect(
          document.querySelector('[data-feedback-state="error"]')
        ).toBeInTheDocument()
      );
      if (retryable) {
        fireEvent.click(screen.getByRole('button', { name: /^(?:Retry(?: image)?|Try again)$/ }));
        await waitFor(() =>
          expect(
            document.querySelector('[data-feedback-state="sent"]')
          ).toBeInTheDocument()
        );
        expect(fetchSpy.mock.calls[1][1]?.body).toBe(
          fetchSpy.mock.calls[0][1]?.body
        );
      } else {
        expect(
          screen.queryByRole('button', { name: /^(?:Retry(?: image)?|Try again)$/ })
        ).not.toBeInTheDocument();
        expect(fetchSpy).toHaveBeenCalledOnce();
        if (status >= 500) {
          expect(screen.queryByRole('button', { name: 'Edit feedback' })).not.toBeInTheDocument();
          expect(composerField()).toHaveAttribute('readonly');
        } else {
          fireEvent.click(screen.getByRole('button', { name: 'Edit feedback' }));
          expect(composerField()).not.toHaveAttribute('readonly');
          fireEvent.change(composerField(), {
            target: { value: 'An explicitly revised refused report' },
          });
          fireEvent.keyDown(composerField(), { key: 'Enter' });
          await waitFor(() => expect(receiptRegion()).toHaveAttribute('data-feedback-state', 'sent'));
          const original = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
          const revised = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
          expect(revised.idempotencyKey).not.toBe(original.idempotencyKey);
          expect(revised.message).not.toBe(original.message);
        }
      }
    }
  );

  it('an invalid success response preserves its frozen report without offering another uncertain write', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      Response.json(
        { schemaVersion: 2 },
        {
          status: 201,
          headers: { 'Exawatt-Service-Version': '1' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchSpy);
    await renderSignedIn();
    await act(async () => feedback!.openFeedback());
    fireEvent.change(composerField(), {
      target: { value: 'Possibly already accepted' },
    });
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    await waitFor(() =>
      expect(
        document.querySelector('[data-feedback-state="error"]')
      ).toBeInTheDocument()
    );
    expect(
      screen.queryByRole('button', { name: /^(?:Retry(?: image)?|Try again)$/ })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit feedback' })).not.toBeInTheDocument();
    expect(composerField()).toHaveValue('Possibly already accepted');
    expect(composerField()).toHaveAttribute('readonly');
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('a later retry refusal cannot erase uncertainty about an earlier accepted write', async () => {
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Response lost'))
      .mockResolvedValueOnce(feedbackProblem(400, false));
    vi.stubGlobal('fetch', fetchSpy);
    await renderSignedIn();
    await act(async () => feedback!.openFeedback());
    fireEvent.change(composerField(), {
      target: { value: 'May already be saved' },
    });
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    await waitFor(() =>
      expect(
        document.querySelector('[data-feedback-state="error"]')
      ).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /^(?:Retry(?: image)?|Try again)$/ }));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(
        document.querySelector('[data-feedback-state="error"]')
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: /^(?:Retry(?: image)?|Try again)$/ })
    ).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls[1][1]?.body).toBe(
      fetchSpy.mock.calls[0][1]?.body
    );
    expect(screen.queryByRole('button', { name: 'Edit feedback' })).not.toBeInTheDocument();
    expect(composerField()).toHaveValue('May already be saved');
    expect(composerField()).toHaveAttribute('readonly');
  });

  it('closing and reopening an uncertain nonretryable report cannot start another write', async () => {
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { schemaVersion: 2 },
          {
            status: 201,
            headers: { 'Exawatt-Service-Version': '1' },
          }
        )
      )
      .mockResolvedValueOnce(feedbackResponse());
    vi.stubGlobal('fetch', fetchSpy);
    await renderSignedIn();
    await act(async () => feedback!.openFeedback());
    fireEvent.change(composerField(), {
      target: { value: 'Possibly accepted original' },
    });
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    await waitFor(() =>
      expect(
        document.querySelector('[data-feedback-state="error"]')
      ).toBeInTheDocument()
    );
    const attemptId = receiptRegion().dataset.feedbackAttempt;
    fireEvent.keyDown(composerField(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await act(async () => feedback!.openQuickCapture());
    expect(composerField()).toHaveValue('Possibly accepted original');
    expect(composerField()).toHaveAttribute('readonly');
    expect(receiptRegion().dataset.feedbackAttempt).toBe(attemptId);
    expect(screen.queryByRole('button', { name: 'Edit feedback' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New feedback' })).not.toBeInTheDocument();
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('Help and shortcut reopening retain one draft, kind and captured evidence', async () => {
    const capture = vi.fn(async () => SHOT);
    const diagnostics = vi.fn(async () => REPORT);
    installBridgeDouble({
      feedback: { setAuthenticated: vi.fn(), captureScreenshot: capture },
      app: { getDiagnosticsReport: diagnostics },
    });
    await renderSignedIn();
    await act(async () => feedback!.openQuickCapture('bug'));
    fireEvent.change(composerField(), {
      target: { value: 'Captured bug details' },
    });
    fireEvent.keyDown(composerField(), { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    await act(async () => feedback!.openFeedback());
    expect(composerField()).toHaveValue('Captured bug details');
    expect(screen.getByRole('button', { name: /^Bug/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(composerImage()).toHaveAttribute('src', SHOT);
    expect(
      screen.getByRole('checkbox', { name: 'Include app details' })
    ).toBeChecked();
    expect(capture).toHaveBeenCalledOnce();
    expect(diagnostics).toHaveBeenCalledOnce();
  });

  it.each([true, false])(
    'diagnostics consent controls the submitted payload when checked is %s',
    async includeDetails => {
      installBridgeDouble({
        feedback: { setAuthenticated: vi.fn() },
        app: { getDiagnosticsReport: vi.fn(async () => REPORT) },
      });
      const fetchSpy = vi.fn<typeof fetch>(async () => feedbackResponse());
      vi.stubGlobal('fetch', fetchSpy);
      await renderSignedIn();
      await act(async () => feedback!.openQuickCapture('bug'));
      const consent = screen.getByRole('checkbox', {
        name: 'Include app details',
      });
      expect(consent).toBeEnabled();
      if ((consent as HTMLInputElement).checked !== includeDetails) {
        fireEvent.click(consent);
      }
      fireEvent.change(composerField(), {
        target: { value: 'Respect the app-details choice' },
      });
      fireEvent.keyDown(composerField(), { key: 'Enter' });
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
      const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
      expect(body.context?.diagnostics).toEqual(
        includeDetails ? REPORT : undefined
      );
    }
  );

  it.each([false, true])(
    'the visible attachment and submitted image agree when removed is %s',
    async removeImage => {
      installBridgeDouble({
        feedback: {
          setAuthenticated: vi.fn(),
          captureScreenshot: vi.fn(async () => SHOT),
        },
      });
      const fetchSpy = vi.fn<typeof fetch>(async () =>
        feedbackResponse(!removeImage)
      );
      vi.stubGlobal('fetch', fetchSpy);
      await renderSignedIn();
      await act(async () => feedback!.openQuickCapture('bug'));
      expect(composerImage()).toHaveAttribute('src', SHOT);
      if (removeImage) {
        fireEvent.click(
          screen.getByRole('button', { name: 'Remove attached image' })
        );
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(composerField()).toHaveFocus();
      }
      fireEvent.change(composerField(), {
        target: { value: 'Send exactly the evidence shown' },
      });
      fireEvent.keyDown(composerField(), { key: 'Enter' });
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
      const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
      if (removeImage) expect(body.attachment).toBeNull();
      else expect(body.attachment).toMatchObject({ dataUrl: SHOT });
    }
  );

  it('repeated invocation during initial capture cannot expose the capture overlay or begin another capture', async () => {
    const screenshot = deferred<string>();
    const capture = vi.fn(() => screenshot.promise);
    installBridgeDouble({
      feedback: { setAuthenticated: vi.fn(), captureScreenshot: capture },
    });
    await renderSignedIn();
    act(() => {
      feedback!.openQuickCapture('bug');
      feedback!.openFeedback();
      feedback!.openQuickCapture('idea');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(capture).toHaveBeenCalledOnce();
    await act(async () => screenshot.resolve(SHOT));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(composerImage()).toHaveAttribute('src', SHOT);
    expect(screen.getByRole('button', { name: /^Bug/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('keeps the cold editor focused and editable while optional diagnostics are pending', async () => {
    const diagnostics = deferred<DiagnosticsReport>();
    installBridgeDouble({
      feedback: {
        setAuthenticated: vi.fn(),
        captureScreenshot: vi.fn(async () => SHOT),
      },
      app: { getDiagnosticsReport: vi.fn(() => diagnostics.promise) },
    });
    await renderSignedIn();
    await act(async () => feedback!.openQuickCapture('bug'));
    const field = composerField();
    expect(field).toBeEnabled();
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: 'Typing before diagnostics' } });
    const kind = screen.getByRole('button', { name: /^Idea/ });
    kind.focus();
    await act(async () => diagnostics.resolve(REPORT));
    expect(composerField()).toBe(field);
    expect(field).toHaveValue('Typing before diagnostics');
    expect(kind).toHaveFocus();
  });

  it('sends without optional diagnostics and late preparation cannot change the frozen report', async () => {
    const diagnostics = deferred<DiagnosticsReport>();
    const delivery = deferred<Response>();
    installBridgeDouble({
      feedback: {
        setAuthenticated: vi.fn(),
        captureScreenshot: vi.fn(async () => SHOT),
      },
      app: { getDiagnosticsReport: vi.fn(() => diagnostics.promise) },
    });
    const fetchSpy = vi.fn<typeof fetch>(() => delivery.promise);
    vi.stubGlobal('fetch', fetchSpy);
    await renderSignedIn();
    await act(async () => feedback!.openQuickCapture('bug'));
    fireEvent.change(composerField(), {
      target: { value: 'The report must not wait for optional diagnostics' },
    });
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const frozen = String(fetchSpy.mock.calls[0][1]?.body);
    expect(JSON.parse(frozen).context.diagnostics).toBeUndefined();
    await act(async () => diagnostics.resolve(REPORT));
    expect(String(fetchSpy.mock.calls[0][1]?.body)).toBe(frozen);
    expect(fetchSpy).toHaveBeenCalledOnce();
    await act(async () => delivery.resolve(feedbackResponse(true)));
    fireEvent.keyDown(composerField(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await act(async () => feedback!.openFeedback());
    expect(composerField()).toHaveValue('');
  });

  it('a selected image read blocks delivery without blocking typing', async () => {
    const diagnostics = deferred<DiagnosticsReport>();
    const image =
      deferred<Awaited<ReturnType<typeof feedbackImageIO.readFeedbackImage>>>();
    vi.spyOn(feedbackImageIO, 'readFeedbackImage').mockReturnValue(
      image.promise
    );
    installBridgeDouble({
      feedback: {
        setAuthenticated: vi.fn(),
        captureScreenshot: vi.fn(async () => SHOT),
      },
      app: { getDiagnosticsReport: vi.fn(() => diagnostics.promise) },
    });
    const fetchSpy = vi.fn<typeof fetch>(async () => feedbackResponse(true));
    vi.stubGlobal('fetch', fetchSpy);
    await renderSignedIn();
    await act(async () => feedback!.openQuickCapture('bug'));
    expect(composerField()).toBeEnabled();
    expect(composerField()).toHaveFocus();
    await act(async () => diagnostics.resolve(REPORT));
    expect(composerField()).toBeEnabled();
    fireEvent.change(composerField(), {
      target: { value: 'Evidence must finish first' },
    });
    fireEvent.change(screen.getByLabelText('Attach image'), {
      target: {
        files: [new File(['new'], 'replacement.png', { type: 'image/png' })],
      },
    });
    expect(composerField()).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled();
    fireEvent.change(composerField(), {
      target: { value: 'Still typing while the chosen image loads' },
    });
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    expect(fetchSpy).not.toHaveBeenCalled();
    await act(async () =>
      image.resolve({
        dataUrl: NEW_SHOT,
        name: 'replacement.png',
        source: 'file',
      })
    );
    expect(composerField()).toBeEnabled();
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.message).toBe('Still typing while the chosen image loads');
    expect(body.attachment).toEqual({
      dataUrl: NEW_SHOT,
      name: 'replacement.png',
    });
    expect(body.context.diagnostics).toEqual(REPORT);
  });

  it('retrying partial delivery preserves the same report, image and initial context after navigation', async () => {
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(feedbackResponse(false))
      .mockResolvedValueOnce(feedbackResponse(true));
    vi.stubGlobal('fetch', fetchSpy);
    installBridgeDouble({
      feedback: {
        setAuthenticated: vi.fn(),
        captureScreenshot: vi.fn(async () => SHOT),
      },
      app: { getDiagnosticsReport: vi.fn(async () => REPORT) },
    });
    let project = 'Captured project';
    setQuickFeedbackAttribution(() => ({
      projectName: project,
      durableSessionId: 'captured-session',
    }));
    await renderSignedIn();
    await act(async () => feedback!.openQuickCapture('bug'));
    fireEvent.change(composerField(), {
      target: { value: 'Keep this evidence' },
    });
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    await waitFor(() =>
      expect(
        document.querySelector('[data-feedback-state="partial"]')
      ).toBeInTheDocument()
    );
    const original = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    project = 'Later project';
    window.history.pushState(null, '', '/settings?feedback-retry');
    fireEvent.click(screen.getByRole('button', { name: /^(?:Retry(?: image)?|Try again)$/ }));
    await waitFor(() =>
      expect(
        document.querySelector('[data-feedback-state="sent"]')
      ).toBeInTheDocument()
    );
    const retried = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    expect(retried).toEqual(original);
    expect(retried.context).toMatchObject({
      projectName: 'Captured project',
      durableSessionId: 'captured-session',
      diagnostics: REPORT,
    });
    expect(retried.context.url).toBe(INITIAL_HREF);
    expect(retried.attachment).toMatchObject({ dataUrl: SHOT });
  });

  it('reopening while pending resumes the same report and only a confirmed send starts a new draft', async () => {
    const delivery = deferred<Response>();
    const fetchSpy = vi.fn<typeof fetch>(() => delivery.promise);
    vi.stubGlobal('fetch', fetchSpy);
    installBridgeDouble({
      feedback: {
        setAuthenticated: vi.fn(),
        captureScreenshot: vi.fn(async () => SHOT),
      },
    });
    await renderSignedIn();
    await act(async () => feedback!.openQuickCapture());
    fireEvent.change(composerField(), { target: { value: 'First report' } });
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const attemptId = receiptRegion().dataset.feedbackAttempt;
    fireEvent.keyDown(composerField(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await act(async () => feedback!.openFeedback());
    expect(composerField()).toBeEnabled();
    expect(composerField()).toHaveAttribute('readonly');
    expect(composerField()).toHaveValue('First report');
    expect(receiptRegion().dataset.feedbackAttempt).toBe(attemptId);
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    expect(fetchSpy).toHaveBeenCalledOnce();
    await act(async () => delivery.resolve(feedbackResponse()));
    expect(composerField()).toHaveValue('First report');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledOnce();
    fireEvent.keyDown(composerField(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await act(async () => feedback!.openFeedback());
    expect(composerField()).toHaveValue('');
    expect(composerField()).not.toHaveAttribute('readonly');
    expect(composerField()).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled();
  });

  it('account changes discard private evidence and ignore the old account capture', async () => {
    const oldCapture = deferred<string>();
    const capture = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(oldCapture.promise)
      .mockResolvedValueOnce(NEW_SHOT);
    installBridgeDouble({
      feedback: { setAuthenticated: vi.fn(), captureScreenshot: capture },
    });
    await renderSignedIn();
    act(() => feedback!.openQuickCapture('bug'));
    const listener =
      clientState.current!.auth.onAuthStateChange.mock.calls[0][0];
    act(() => listener('SIGNED_OUT', null));
    expect(feedback!.isAuthenticated).toBe(false);
    act(() => listener('SIGNED_IN', { ...SESSION, user: { id: 'user-2' } }));
    await act(async () => feedback!.openQuickCapture('bug'));
    expect(composerField()).toHaveValue('');
    expect(composerImage()).toHaveAttribute('src', NEW_SHOT);
    await act(async () => oldCapture.resolve(SHOT));
    expect(composerImage()).toHaveAttribute('src', NEW_SHOT);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it('a lost response retries the frozen attempt rather than creating another report', async () => {
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Connection closed'))
      .mockResolvedValueOnce(feedbackResponse());
    vi.stubGlobal('fetch', fetchSpy);
    await renderSignedIn();
    await act(async () => feedback!.openFeedback());
    fireEvent.change(composerField(), {
      target: { value: 'Possibly already saved' },
    });
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    await waitFor(() =>
      expect(
        document.querySelector('[data-feedback-state="error"]')
      ).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /^(?:Retry(?: image)?|Try again)$/ }));
    await waitFor(() =>
      expect(
        document.querySelector('[data-feedback-state="sent"]')
      ).toBeInTheDocument()
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][1]?.body).toBe(
      fetchSpy.mock.calls[0][1]?.body
    );
  });

  it('closing and reopening failed feedback retains its retry identity and work focus', async () => {
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Connection closed'))
      .mockResolvedValueOnce(feedbackResponse());
    vi.stubGlobal('fetch', fetchSpy);
    await renderSignedIn();
    const invoker = screen.getByRole('button', { name: 'Work area' });
    invoker.focus();
    await act(async () => feedback!.openFeedback());
    fireEvent.change(composerField(), {
      target: { value: 'Recover this report' },
    });
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    await waitFor(() =>
      expect(
        document.querySelector('[data-feedback-state="error"]')
      ).toBeInTheDocument()
    );
    const attemptId = document.querySelector<HTMLElement>(
      '[data-feedback-attempt]'
    )!.dataset.feedbackAttempt;
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(invoker).toHaveFocus());
    await act(async () => feedback!.openFeedback());
    expect(composerField()).toHaveValue('Recover this report');
    expect(
      document.querySelector<HTMLElement>('[data-feedback-attempt]')!.dataset
        .feedbackAttempt
    ).toBe(attemptId);
    fireEvent.click(screen.getByRole('button', { name: /^(?:Retry(?: image)?|Try again)$/ }));
    await waitFor(() =>
      expect(
        document.querySelector('[data-feedback-state="sent"]')
      ).toBeInTheDocument()
    );
    expect(fetchSpy.mock.calls[1][1]?.body).toBe(
      fetchSpy.mock.calls[0][1]?.body
    );
  });

  it('account reset discards closed recovery evidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new TypeError('Connection closed'))
    );
    await renderSignedIn();
    await act(async () => feedback!.openFeedback());
    fireEvent.change(composerField(), {
      target: { value: 'Private hidden report' },
    });
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    await waitFor(() =>
      expect(
        document.querySelector('[data-feedback-state="error"]')
      ).toBeInTheDocument()
    );
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    const listener =
      clientState.current!.auth.onAuthStateChange.mock.calls[0][0];
    act(() => listener('SIGNED_OUT', null));
    act(() => listener('SIGNED_IN', { ...SESSION, user: { id: 'user-2' } }));
    await act(async () => feedback!.openFeedback());
    expect(composerField()).toHaveValue('');
    expect(
      screen.queryByRole('button', { name: 'Recover feedback' })
    ).not.toBeInTheDocument();
    fireEvent.keyDown(composerField(), { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(
      document.querySelector('[data-feedback-attempt]')
    ).not.toBeInTheDocument();
  });

  it('retains known text delivery when an image retry is refused', async () => {
    const rejected = Response.json(
      {
        type: 'https://feedback.example.test/problems/invalid',
        title: 'Invalid attachment',
        status: 400,
        code: 'invalid_attachment',
        retryable: false,
      },
      {
        status: 400,
        headers: {
          'Content-Type': 'application/problem+json',
          'Exawatt-Service-Version': '1',
        },
      }
    );
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(feedbackResponse(false))
      .mockResolvedValueOnce(rejected);
    vi.stubGlobal('fetch', fetchSpy);
    installBridgeDouble({
      feedback: {
        setAuthenticated: vi.fn(),
        captureScreenshot: vi.fn(async () => SHOT),
      },
    });
    await renderSignedIn();
    await act(async () => feedback!.openQuickCapture('bug'));
    fireEvent.change(composerField(), {
      target: { value: 'The saved text must remain known' },
    });
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    await waitFor(() =>
      expect(
        document.querySelector('[data-feedback-state="partial"]')
      ).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: /^(?:Retry(?: image)?|Try again)$/ }));
    await waitFor(() =>
      expect(
        document.querySelector('[data-feedback-state="error"]')
      ).toBeInTheDocument()
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^(?:Retry(?: image)?|Try again)$/ })
    ).not.toBeInTheDocument();
    expect(within(receiptRegion()).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(fetchSpy.mock.calls[1][1]?.body).toBe(
      fetchSpy.mock.calls[0][1]?.body
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Finish without image' })
    );
    await waitFor(() =>
      expect(
        document.querySelector('[data-feedback-state="sent"]')
      ).toBeInTheDocument()
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('an accepted response from the old account cannot resurrect its receipt or private draft', async () => {
    const delivery = deferred<Response>();
    const fetchSpy = vi.fn<typeof fetch>(() => delivery.promise);
    vi.stubGlobal('fetch', fetchSpy);
    await renderSignedIn();
    await act(async () => feedback!.openQuickCapture());
    fireEvent.change(composerField(), {
      target: { value: 'Private old-account draft' },
    });
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    const listener =
      clientState.current!.auth.onAuthStateChange.mock.calls[0][0];
    act(() => listener('SIGNED_OUT', null));
    act(() =>
      listener('SIGNED_IN', {
        ...SESSION,
        access_token: 'next-account-token',
        user: { id: 'user-2' },
      })
    );
    await act(async () => feedback!.openFeedback());
    expect(composerField()).toHaveValue('');
    await act(async () => delivery.resolve(feedbackResponse()));
    expect(composerField()).toHaveValue('');
    fireEvent.keyDown(composerField(), { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(
      document.querySelector('[data-feedback-attempt]')
    ).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('an old file read cannot replace the new account image', async () => {
    const image =
      deferred<Awaited<ReturnType<typeof feedbackImageIO.readFeedbackImage>>>();
    vi.spyOn(feedbackImageIO, 'readFeedbackImage').mockReturnValue(
      image.promise
    );
    installBridgeDouble({
      feedback: {
        setAuthenticated: vi.fn(),
        captureScreenshot: vi.fn(async () => SHOT),
      },
    });
    await renderSignedIn();
    await act(async () => feedback!.openQuickCapture('bug'));
    fireEvent.change(screen.getByLabelText('Attach image'), {
      target: {
        files: [new File(['old'], 'old-account.png', { type: 'image/png' })],
      },
    });
    const listener =
      clientState.current!.auth.onAuthStateChange.mock.calls[0][0];
    act(() => listener('SIGNED_OUT', null));
    act(() => listener('SIGNED_IN', { ...SESSION, user: { id: 'user-2' } }));
    await act(async () => feedback!.openQuickCapture('bug'));
    expect(composerImage()).toHaveAttribute('src', SHOT);
    await act(async () =>
      image.resolve({
        dataUrl: NEW_SHOT,
        name: 'old-account.png',
        source: 'file',
      })
    );
    expect(composerImage()).toHaveAttribute('src', SHOT);
    expect(composerField()).toBeEnabled();
  });

  it('keeps one focused dialog through pending and outcome, then closes itself and restores work focus', async () => {
    const delivery = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => delivery.promise)
    );
    await renderSignedIn();
    const invoker = screen.getByRole('button', { name: 'Work area' });
    invoker.focus();
    await act(async () => feedback!.openFeedback());
    expect(composerField()).toHaveFocus();
    fireEvent.keyDown(composerField(), { key: 'Escape' });
    await waitFor(() => expect(invoker).toHaveFocus());
    await act(async () => feedback!.openQuickCapture());
    const dialog = screen.getByRole('dialog');
    const field = composerField();
    fireEvent.change(composerField(), {
      target: { value: 'Return me to work' },
    });
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(composerField()).toBe(field);
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('readonly');
    expect(
      document.querySelector('[data-feedback-state="sending"]')
    ).toBeInTheDocument();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => delivery.resolve(feedbackResponse()));
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(composerField()).toBe(field);
    expect(field).toHaveFocus();
    expect(field).toHaveValue('Return me to work');
    expect(within(dialog).getByRole('status')).toBeInTheDocument();
    // Success asks for no decision: nothing to click, and it dismisses itself.
    expect(
      within(document.querySelector<HTMLElement>('[data-feedback-attempt]')!)
        .queryAllByRole('button')
    ).toHaveLength(0);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    vi.useRealTimers();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(invoker).toHaveFocus();
    await act(async () => feedback!.openFeedback());
    expect(composerField()).toHaveValue('');
    expect(composerField()).not.toHaveAttribute('readonly');
  });

  it('a send confirmed after closing never reopens as a finished receipt', async () => {
    const delivery = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => delivery.promise)
    );
    await renderSignedIn();
    await act(async () => feedback!.openQuickCapture());
    fireEvent.change(composerField(), {
      target: { value: 'Closed while sending' },
    });
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    fireEvent.keyDown(composerField(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await act(async () => delivery.resolve(feedbackResponse()));
    await act(async () => feedback!.openFeedback());
    expect(composerField()).toHaveValue('');
    expect(composerField()).not.toHaveAttribute('readonly');
    expect(
      document.querySelector('[data-feedback-attempt]')
    ).not.toBeInTheDocument();
  });
});

describe('ProductFeedbackProvider distribution boundary', () => {
  it('cannot submit an old account context vote after an awaited correction crosses accounts', async () => {
    const correction = deferred<string | null>();
    const fetchSpy = vi.fn<typeof fetch>(async () => feedbackResponse());
    vi.stubGlobal('fetch', fetchSpy);
    installBridgeDouble({
      pty: { correctContext: vi.fn(() => correction.promise) },
    });
    await renderSignedIn();
    let submitted!: Promise<boolean>;
    act(() => {
      submitted = feedback!.submitContextRating({
        durableSessionId: 'old-account-session',
        label: 'Old account context',
        betterLabel: 'Corrected old context',
        sentiment: -1,
      });
    });
    const listener =
      clientState.current!.auth.onAuthStateChange.mock.calls[0][0];
    act(() => listener('SIGNED_OUT', null));
    act(() =>
      listener('SIGNED_IN', {
        ...SESSION,
        access_token: 'new-account-token',
        user: { id: 'user-2' },
      })
    );
    await act(async () => correction.resolve('Corrected old context'));
    await expect(submitted).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not reinstall an obsolete credential after the account signs out', async () => {
    distributionState.current = distribution({
      url: FEEDBACK_URL,
      protocolVersion: 1,
    });
    let settle!: (value: { data: { session: typeof SESSION } }) => void;
    const staleRead = new Promise<{ data: { session: typeof SESSION } }>(
      resolve => {
        settle = resolve;
      }
    );
    clientState.current!.auth.getSession.mockReturnValue(staleRead);
    const setContextAuth = vi.fn();
    installBridgeDouble({
      pty: { setContextAuth },
      feedback: { setAuthenticated: vi.fn() },
    });
    render(
      <ProductFeedbackProvider>
        <Probe />
      </ProductFeedbackProvider>
    );
    await act(async () => {});
    const listener =
      clientState.current!.auth.onAuthStateChange.mock.calls[0][0];
    act(() => listener('SIGNED_OUT', null));
    expect(feedback!.isAuthenticated).toBe(false);
    await act(async () => {
      settle({ data: { session: SESSION } });
    });
    expect(feedback!.isAuthenticated).toBe(false);
    expect(setContextAuth).toHaveBeenLastCalledWith(null);
  });

  it('stops before account auth or fetch and exposes honest absence', async () => {
    distributionState.current = distribution(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <ProductFeedbackProvider>
        <Probe />
      </ProductFeedbackProvider>
    );

    expect(screen.getByText('Feedback unavailable / signed out')).toBeTruthy();
    expect(createOptionalClient).not.toHaveBeenCalled();
    expect(clientState.current!.auth.getSession).not.toHaveBeenCalled();
    expect(clientState.current!.auth.onAuthStateChange).not.toHaveBeenCalled();

    let submitted = true;
    await act(async () => {
      submitted = await feedback!.submitContextRating({
        durableSessionId: 'session-1',
        label: 'Inspect distribution boundary',
        sentiment: 1,
      });
    });

    expect(submitted).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('preserves authenticated POST behavior at a distributor endpoint', async () => {
    distributionState.current = distribution({
      url: FEEDBACK_URL,
      protocolVersion: 1,
    });
    const fetchSpy = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          schemaVersion: 1,
          id: '223e4567-e89b-42d3-a456-426614174000',
          duplicate: false,
          attachmentStored: false,
        },
        { status: 201, headers: { 'Exawatt-Service-Version': '1' } }
      )
    );
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <ProductFeedbackProvider>
        <Probe />
      </ProductFeedbackProvider>
    );

    await waitFor(() =>
      expect(screen.getByText('Feedback configured / signed in')).toBeTruthy()
    );
    expect(createOptionalClient).toHaveBeenCalledWith(
      distributionState.current
    );

    let submitted = false;
    await act(async () => {
      submitted = await feedback!.submitContextRating({
        durableSessionId: 'session-1',
        label: 'Inspect distribution boundary',
        sentiment: -1,
      });
    });

    expect(submitted).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(FEEDBACK_URL);
    expect(init).toMatchObject({ method: 'POST' });
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${SESSION.access_token}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('Exawatt-Service-Version')).toBe('1');
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      schemaVersion: 1,
      kind: 'context_label',
      sentiment: -1,
      surface: 'workspace-tab-strip',
      context: {
        schemaVersion: 1,
        durableSessionId: 'session-1',
        shownLabel: 'Inspect distribution boundary',
      },
    });
  });
});
