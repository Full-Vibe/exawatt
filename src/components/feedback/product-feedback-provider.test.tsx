import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
});

describe('unified feedback composer continuity', () => {
  it('reopening during a retained Radix exit preserves the original work invoker', async () => {
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
    await renderSignedIn();
    const invoker = screen.getByRole('button', { name: 'Work area' });
    invoker.focus();
    await act(async () => feedback!.openFeedback());
    fireEvent.keyDown(composerField(), { key: 'Escape' });
    expect(
      document.querySelector(
        '[data-slot="dialog-content"][data-state="closed"]'
      )
    ).toBeInTheDocument();
    await act(async () => feedback!.openQuickCapture());
    expect(composerField()).toHaveFocus();
    fireEvent.keyDown(composerField(), { key: 'Escape' });
    for (const element of document.querySelectorAll('[data-state="closed"]')) {
      const completed = new Event('animationend', { bubbles: true });
      Object.defineProperty(completed, 'animationName', { value: 'test-exit' });
      fireEvent(element, completed);
    }
    await waitFor(() => expect(invoker).toHaveFocus());
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
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
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
          screen.queryByRole('button', { name: 'Retry' })
        ).not.toBeInTheDocument();
        expect(fetchSpy).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'Edit feedback' }));
        if (status >= 500)
          expect(screen.getByRole('alert')).toBeInTheDocument();
        else expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      }
    }
  );

  it('an invalid success response disables replay but warns before an edited report can duplicate uncertain delivery', async () => {
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
      screen.queryByRole('button', { name: 'Retry' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit feedback' }));
    expect(composerField()).toHaveValue('Possibly already accepted');
    expect(screen.getByRole('alert')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(
        document.querySelector('[data-feedback-state="error"]')
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: 'Retry' })
    ).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls[1][1]?.body).toBe(
      fetchSpy.mock.calls[0][1]?.body
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit feedback' }));
    expect(composerField()).toHaveValue('May already be saved');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('reopening an uncertain nonretryable report keeps the warning through edits and uses a new key only for changed input', async () => {
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
    await act(async () => feedback!.openQuickCapture());
    expect(composerField()).toHaveValue('Possibly accepted original');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Send feedback' })
    ).toBeDisabled();
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    expect(fetchSpy).toHaveBeenCalledOnce();
    fireEvent.change(composerField(), {
      target: { value: 'Deliberately changed report' },
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeEnabled();
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    await waitFor(() =>
      expect(
        document.querySelector('[data-feedback-state="sent"]')
      ).toBeInTheDocument()
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const original = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    const edited = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    expect(edited.idempotencyKey).not.toBe(original.idempotencyKey);
    expect(edited.message).toBe('Deliberately changed report');
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
      screen.getByRole('button', { name: 'Remove anonymized diagnostics' })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(capture).toHaveBeenCalledOnce();
    expect(diagnostics).toHaveBeenCalledOnce();
  });

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

  it('keeps delivery disabled until diagnostics and a subsequent image read each finish', async () => {
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
    expect(composerField()).toBeDisabled();
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    expect(fetchSpy).not.toHaveBeenCalled();
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
    expect(composerField()).toBeDisabled();
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
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
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

  it('an old completion cannot clear or close a newer draft from another invoking command', async () => {
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
    await act(async () => feedback!.openFeedback());
    expect(composerField()).toBeEnabled();
    fireEvent.change(composerField(), { target: { value: 'A newer draft' } });
    expect(
      screen.getByRole('button', { name: 'Send feedback' })
    ).toBeDisabled();
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    expect(fetchSpy).toHaveBeenCalledOnce();
    await act(async () => delivery.resolve(feedbackResponse()));
    expect(composerField()).toHaveValue('A newer draft');
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeEnabled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledOnce();
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
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
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

  it('hiding and recovering failed feedback retains its retry identity and work focus', async () => {
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
    fireEvent.click(
      screen.getByRole('button', { name: 'Hide feedback receipt' })
    );
    expect(
      document.querySelector('[data-feedback-attempt]')
    ).not.toBeInTheDocument();
    invoker.focus();
    await act(async () => feedback!.openFeedback());
    expect(composerField()).toHaveValue('Recover this report');
    fireEvent.click(screen.getByRole('button', { name: 'Recover feedback' }));
    await waitFor(() => expect(invoker).toHaveFocus());
    expect(
      document.querySelector<HTMLElement>('[data-feedback-attempt]')!.dataset
        .feedbackAttempt
    ).toBe(attemptId);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(
        document.querySelector('[data-feedback-state="sent"]')
      ).toBeInTheDocument()
    );
    expect(fetchSpy.mock.calls[1][1]?.body).toBe(
      fetchSpy.mock.calls[0][1]?.body
    );
  });

  it('account reset discards hidden recovery evidence', async () => {
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
    fireEvent.click(
      screen.getByRole('button', { name: 'Hide feedback receipt' })
    );
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
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(
        document.querySelector('[data-feedback-state="error"]')
      ).toBeInTheDocument()
    );
    expect(screen.getByRole('status')).toHaveTextContent(/text saved/i);
    expect(screen.getByRole('status')).not.toHaveTextContent(
      /report not accepted/i
    );
    expect(
      screen.queryByRole('button', { name: 'Retry' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Hide feedback receipt' })
    ).toBeInTheDocument();
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

  it('returns focus to the invoker after dismissal and send; receipts never take focus', async () => {
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
    fireEvent.change(composerField(), {
      target: { value: 'Return me to work' },
    });
    fireEvent.keyDown(composerField(), { key: 'Enter' });
    await waitFor(() => expect(invoker).toHaveFocus());
    expect(
      document.querySelector('[data-feedback-state="sending"]')
    ).toBeInTheDocument();
    await act(async () => delivery.resolve(feedbackResponse()));
    expect(invoker).toHaveFocus();
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
