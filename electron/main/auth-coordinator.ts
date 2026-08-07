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

/** The renderer's live session, handed across IPC. Credentials — never logged. */
export interface ElectronAuthSessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface ElectronAuthLinkConfig extends ElectronAuthStartConfig {
  session?: ElectronAuthSessionTokens;
}

/**
 * Outcomes a GitHub link attempt may report back over the `exawatt://` deep
 * link. Any local process can invoke that scheme, so main forwards a value to
 * the renderer only if it appears here.
 *
 * This must stay identical to `AUTH_LINK_OUTCOMES` in
 * `src/components/auth/callback-failures.ts`, which owns the copy. Electron
 * main compiles with `rootDir: electron/` and cannot import from `src`; the
 * parity is asserted in `auth-coordinator.test.ts` instead of being trusted.
 */
export const AUTH_LINK_OUTCOMES = [
  'linked',
  'already_linked',
  'provider_refused',
  'link_claimed',
  'link_incomplete',
  'link_signed_out',
  'link_failed',
] as const;

export type ElectronAuthLinkOutcome = (typeof AUTH_LINK_OUTCOMES)[number];

export function isElectronAuthLinkOutcome(
  value: unknown
): value is ElectronAuthLinkOutcome {
  return (AUTH_LINK_OUTCOMES as readonly unknown[]).includes(value);
}

/**
 * The desktop callback is one URL for both flows, so it has to be told which
 * one came back: a refused GitHub link and a refused Google sign-in are the
 * same shape on the wire. The renderer keeps passing the bare callback URL —
 * `validateStartConfig` still rejects anything with a query — and the intent
 * is stamped here, where the flow's identity is actually known.
 */
export function linkRedirectTarget(redirectTo: string): string {
  const target = new URL(redirectTo);
  target.searchParams.set('intent', 'link');
  return target.toString();
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
  linkGithub(redirectTo: string): Promise<OAuthResult>;
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
    linkGithub: redirectTo =>
      client.auth.linkIdentity({
        provider: 'github',
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
    return this.startFlow(config, 'google', client =>
      client.signInWithGoogle(config.redirectTo)
    );
  }

  /**
   * Linking is not signing in, and the difference is load-bearing here.
   * `signInWithOAuth` builds an authorize URL from nothing, so a brand-new
   * client works for Google. `linkIdentity` asks *who are you* first: it reads
   * the session out of storage and sends its access token as the bearer. This
   * coordinator builds a FRESH client per flow, in the main process, so that
   * lookup found nothing and supabase-js answered `AuthSessionMissingError`
   * before a browser ever opened — which is why linking only ever worked from
   * the web renderer, where the session is already in hand.
   *
   * So the session is now installed on the client before the link is asked
   * for, from the renderer that demonstrably has one. Nothing is inferred from
   * the ambient cookie jar: an identity link that cannot prove who it is
   * belongs to fails loudly, not silently.
   */
  async linkGithub(config: ElectronAuthLinkConfig): Promise<void> {
    return this.startFlow(config, 'github', async client => {
      await this.adoptRendererSession(client, config.session);
      return client.linkGithub(linkRedirectTarget(config.redirectTo));
    });
  }

  private async adoptRendererSession(
    client: ElectronAuthClient,
    tokens: ElectronAuthSessionTokens | undefined
  ): Promise<void> {
    if (!tokens) {
      this.recordDiagnostic('auth.link.session_absent');
      throw new Error('Auth session missing. Sign in again to link GitHub.');
    }
    validateSessionTokens(tokens);

    let result: ExchangeResult;
    try {
      result = await client.installSession(tokens);
    } catch (error) {
      this.recordDiagnostic('auth.link.session_install_throw', {
        error: describeAuthError(error),
      });
      throw error;
    }
    if (result.error || !result.data.session) {
      this.recordDiagnostic('auth.link.session_install_failure', {
        error: result.error
          ? describeAuthError(result.error)
          : { message: 'The authentication service returned no session.' },
      });
      throw (
        result.error ??
        new Error('Auth session missing. Sign in again to link GitHub.')
      );
    }
    // Deliberately records nothing about the tokens themselves.
    this.recordDiagnostic('auth.link.session_adopted');
  }

  private async startFlow(
    config: ElectronAuthStartConfig,
    provider: 'google' | 'github',
    authorize: (client: ElectronAuthClient) => Promise<OAuthResult>
  ): Promise<void> {
    const flowId = randomUUID();
    this.recordDiagnostic('auth.flow.start', {
      flowId,
      provider,
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
      authorizationResult = await authorize(client);
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
        'No authentication flow is pending. Start the flow again.'
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

/** Bounds and shape only. A token's value is never read, compared, or logged. */
const MAX_TOKEN_CHARS = 8_192;

export function validateSessionTokens(tokens: ElectronAuthSessionTokens): void {
  const { accessToken, refreshToken } = tokens;
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    throw new Error('The authentication session was invalid.');
  }
  if (!accessToken || !refreshToken) {
    throw new Error('The authentication session was invalid.');
  }
  if (
    accessToken.length > MAX_TOKEN_CHARS ||
    refreshToken.length > MAX_TOKEN_CHARS
  ) {
    throw new Error('The authentication session was invalid.');
  }
  if (accessToken.split('.').length !== 3) {
    throw new Error('The authentication session was invalid.');
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
