import { createBrowserClient, type CookieMethodsBrowser } from '@supabase/ssr';
import type { AuthError } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import {
  describeAuthError,
  type AuthDiagnosticRecorder,
} from './auth-diagnostics';

export interface ElectronAuthStartConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  redirectTo: string;
}

export interface ElectronAuthError {
  name: string;
  message: string;
  status?: number;
  code?: string;
}

interface OAuthResult {
  data: { url: string | null };
  error: AuthError | null;
}

interface ExchangeResult {
  data: {
    session: { access_token: string; refresh_token: string } | null;
  };
  error: AuthError | null;
}

interface ElectronAuthClient {
  signInWithGoogle(redirectTo: string): Promise<OAuthResult>;
  exchangeCode(code: string): Promise<ExchangeResult>;
  installSession(tokens: {
    accessToken: string;
    refreshToken: string;
  }): Promise<ExchangeResult>;
}

interface AuthClientConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  cookies: CookieMethodsBrowser;
  fetch: typeof fetch;
}

type AuthClientFactory = (config: AuthClientConfig) => ElectronAuthClient;

export interface ElectronAuthCoordinatorOptions {
  expectedRendererOrigin: string;
  openExternal: (url: string) => Promise<unknown>;
  cookies: CookieMethodsBrowser;
  fetch: typeof fetch;
  recordDiagnostic?: AuthDiagnosticRecorder;
  createAuthClient?: AuthClientFactory;
}

const createSupabaseAuthClient: AuthClientFactory = config => {
  const client = createBrowserClient(
    config.supabaseUrl,
    config.supabaseAnonKey,
    {
      isSingleton: false,
      cookies: config.cookies,
      global: { fetch: config.fetch },
    }
  );

  return {
    signInWithGoogle: redirectTo =>
      client.auth.signInWithOAuth({
        provider: 'google',
        options: { skipBrowserRedirect: true, redirectTo },
      }),
    exchangeCode: code => client.auth.exchangeCodeForSession(code),
    installSession: ({ accessToken, refreshToken }) =>
      client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      }),
  };
};

/**
 * Owns the desktop PKCE flow in Electron's main process. System-browser OAuth
 * is a native-shell concern; keeping the verifier and token exchange here also
 * avoids depending on the renderer's Chromium network process.
 */
export class ElectronAuthCoordinator {
  private readonly expectedRendererOrigin: string;
  private readonly openExternal: (url: string) => Promise<unknown>;
  private readonly cookies: CookieMethodsBrowser;
  private readonly fetch: typeof fetch;
  private readonly createAuthClient: AuthClientFactory;
  private readonly recordDiagnostic: AuthDiagnosticRecorder;
  private pendingClient: ElectronAuthClient | null = null;
  private pendingFlowId: string | null = null;

  constructor(options: ElectronAuthCoordinatorOptions) {
    this.expectedRendererOrigin = new URL(
      options.expectedRendererOrigin
    ).origin;
    this.openExternal = options.openExternal;
    this.cookies = options.cookies;
    this.fetch = options.fetch;
    this.recordDiagnostic = options.recordDiagnostic ?? (() => {});
    this.createAuthClient =
      options.createAuthClient ?? createSupabaseAuthClient;
  }

  async startGoogle(config: ElectronAuthStartConfig): Promise<void> {
    const flowId = randomUUID();
    this.recordDiagnostic('auth.flow.start', {
      flowId,
      provider: 'google',
      rendererOrigin: this.expectedRendererOrigin,
      supabaseHost: safeHost(config.supabaseUrl),
    });

    try {
      validateStartConfig(config, this.expectedRendererOrigin);
    } catch (error) {
      this.recordDiagnostic('auth.flow.validation_failure', {
        flowId,
        error: describeAuthError(error),
      });
      throw error;
    }

    if (this.pendingFlowId) {
      this.recordDiagnostic('auth.flow.replaced', {
        flowId: this.pendingFlowId,
        replacementFlowId: flowId,
      });
    }

    const client = this.createAuthClient({
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey,
      cookies: this.cookies,
      fetch: this.fetch,
    });
    this.pendingClient = client;
    this.pendingFlowId = flowId;

    let authorizationResult: OAuthResult;
    try {
      authorizationResult = await client.signInWithGoogle(config.redirectTo);
    } catch (error) {
      this.pendingClient = null;
      this.pendingFlowId = null;
      this.recordDiagnostic('auth.flow.authorization_url_throw', {
        flowId,
        error: describeAuthError(error),
      });
      throw error;
    }
    const { data, error } = authorizationResult;
    if (error || !data.url) {
      this.pendingClient = null;
      this.pendingFlowId = null;
      this.recordDiagnostic('auth.flow.authorization_url_failure', {
        flowId,
        error: error
          ? describeAuthError(error)
          : { message: 'The authentication service returned no URL.' },
      });
      throw error ?? new Error('The authentication service returned no URL.');
    }

    const authorizeUrl = new URL(data.url);
    this.recordDiagnostic('auth.flow.authorization_url_ready', {
      flowId,
      host: authorizeUrl.host,
      path: authorizeUrl.pathname,
      queryNames: [...new Set(authorizeUrl.searchParams.keys())].sort(),
    });

    try {
      await this.openExternal(data.url);
      this.recordDiagnostic('auth.flow.browser_opened', { flowId });
    } catch (error) {
      this.pendingClient = null;
      this.pendingFlowId = null;
      this.recordDiagnostic('auth.flow.browser_open_failure', {
        flowId,
        error: describeAuthError(error),
      });
      throw error;
    }
  }

  async exchangeCode(code: string): Promise<void> {
    if (!code || code.length > 2_048) {
      throw new Error('The authentication callback code was invalid.');
    }

    const client = this.pendingClient;
    const flowId = this.pendingFlowId;
    if (!client) {
      this.recordDiagnostic('auth.flow.callback_without_pending_flow', {
        codeLength: code.length,
      });
      throw new Error(
        'No Google sign-in is pending. Start the sign-in flow again.'
      );
    }

    // Authorization codes are single-use. Claim the pending flow immediately
    // so duplicate deep links cannot race two exchanges.
    this.pendingClient = null;
    this.pendingFlowId = null;
    this.recordDiagnostic('auth.flow.exchange_start', {
      flowId,
      codeLength: code.length,
    });

    let result: ExchangeResult;
    try {
      result = await client.exchangeCode(code);
    } catch (error) {
      this.recordDiagnostic('auth.flow.exchange_throw', {
        flowId,
        error: describeAuthError(error),
      });
      throw error;
    }

    const { data, error } = result;
    if (error) {
      this.recordDiagnostic('auth.flow.exchange_error', {
        flowId,
        error: describeAuthError(error),
      });
      throw error;
    }
    if (!data.session?.access_token || !data.session.refresh_token) {
      this.recordDiagnostic('auth.flow.exchange_missing_session', {
        flowId,
        hasSession: Boolean(data.session),
        hasAccessToken: Boolean(data.session?.access_token),
        hasRefreshToken: Boolean(data.session?.refresh_token),
      });
      throw new Error('The authentication service returned no session.');
    }
    this.recordDiagnostic('auth.flow.exchange_complete', { flowId });
  }

  async installSession(
    config: Pick<ElectronAuthStartConfig, 'supabaseUrl' | 'supabaseAnonKey'>,
    tokens: { accessToken: string; refreshToken: string }
  ): Promise<void> {
    validateSupabaseConfig(config);
    const flowId = `test-${randomUUID()}`;
    this.recordDiagnostic('auth.test_session.start', {
      flowId,
      supabaseHost: safeHost(config.supabaseUrl),
    });
    const client = this.createAuthClient({
      ...config,
      cookies: this.cookies,
      fetch: this.fetch,
    });
    let result: ExchangeResult;
    try {
      result = await client.installSession(tokens);
    } catch (error) {
      this.recordDiagnostic('auth.test_session.throw', {
        flowId,
        error: describeAuthError(error),
      });
      throw error;
    }
    const { data, error } = result;
    if (error) {
      this.recordDiagnostic('auth.test_session.error', {
        flowId,
        error: describeAuthError(error),
      });
      throw error;
    }
    if (!data.session) {
      this.recordDiagnostic('auth.test_session.missing_session', { flowId });
      throw new Error('The authentication service returned no session.');
    }
    this.recordDiagnostic('auth.test_session.complete', { flowId });
  }
}

export function safeElectronAuthError(error: unknown): ElectronAuthError {
  const candidate =
    error && typeof error === 'object'
      ? (error as {
          name?: unknown;
          message?: unknown;
          status?: unknown;
          code?: unknown;
        })
      : null;

  return {
    name: typeof candidate?.name === 'string' ? candidate.name : 'AuthError',
    message:
      typeof candidate?.message === 'string' && candidate.message
        ? candidate.message
        : 'Authentication failed. Please try again.',
    ...(typeof candidate?.status === 'number'
      ? { status: candidate.status }
      : {}),
    ...(typeof candidate?.code === 'string' ? { code: candidate.code } : {}),
  };
}

function validateStartConfig(
  config: ElectronAuthStartConfig,
  expectedRendererOrigin: string
): void {
  let redirectTo: URL;
  try {
    redirectTo = new URL(config.redirectTo);
  } catch {
    throw new Error('The authentication configuration was invalid.');
  }

  validateSupabaseConfig(config);

  if (
    redirectTo.origin !== expectedRendererOrigin ||
    redirectTo.pathname !== '/auth/electron-callback' ||
    redirectTo.search ||
    redirectTo.hash
  ) {
    throw new Error('The authentication callback URL was rejected.');
  }
}

function validateSupabaseConfig(
  config: Pick<ElectronAuthStartConfig, 'supabaseUrl' | 'supabaseAnonKey'>
): void {
  let supabaseUrl: URL;
  try {
    supabaseUrl = new URL(config.supabaseUrl);
  } catch {
    throw new Error('The authentication configuration was invalid.');
  }
  if (
    supabaseUrl.protocol !== 'https:' ||
    !config.supabaseAnonKey ||
    config.supabaseAnonKey.length > 16_384
  ) {
    throw new Error('The authentication configuration was invalid.');
  }
}

function safeHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return 'invalid';
  }
}
