import {
  createClient,
  type AuthError,
  type SupportedStorage,
} from '@supabase/supabase-js';

export interface ElectronAuthStartConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  redirectTo: string;
}

export interface ElectronAuthSession {
  accessToken: string;
  refreshToken: string;
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
}

interface AuthClientConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  storage: SupportedStorage;
}

type AuthClientFactory = (config: AuthClientConfig) => ElectronAuthClient;

export interface ElectronAuthCoordinatorOptions {
  expectedRendererOrigin: string;
  openExternal: (url: string) => Promise<unknown>;
  createAuthClient?: AuthClientFactory;
}

class MemoryStorage implements SupportedStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const createSupabaseAuthClient: AuthClientFactory = config => {
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: config.storage,
    },
    global: { fetch: globalThis.fetch },
  });

  return {
    signInWithGoogle: redirectTo =>
      client.auth.signInWithOAuth({
        provider: 'google',
        options: { skipBrowserRedirect: true, redirectTo },
      }),
    exchangeCode: code => client.auth.exchangeCodeForSession(code),
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
  private readonly createAuthClient: AuthClientFactory;
  private pendingClient: ElectronAuthClient | null = null;

  constructor(options: ElectronAuthCoordinatorOptions) {
    this.expectedRendererOrigin = new URL(
      options.expectedRendererOrigin
    ).origin;
    this.openExternal = options.openExternal;
    this.createAuthClient =
      options.createAuthClient ?? createSupabaseAuthClient;
  }

  async startGoogle(config: ElectronAuthStartConfig): Promise<void> {
    validateStartConfig(config, this.expectedRendererOrigin);

    const client = this.createAuthClient({
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey,
      storage: new MemoryStorage(),
    });
    this.pendingClient = client;

    const { data, error } = await client.signInWithGoogle(config.redirectTo);
    if (error || !data.url) {
      this.pendingClient = null;
      throw error ?? new Error('The authentication service returned no URL.');
    }

    try {
      await this.openExternal(data.url);
    } catch (error) {
      this.pendingClient = null;
      throw error;
    }
  }

  async exchangeCode(code: string): Promise<ElectronAuthSession> {
    if (!code || code.length > 2_048) {
      throw new Error('The authentication callback code was invalid.');
    }

    const client = this.pendingClient;
    if (!client) {
      throw new Error(
        'No Google sign-in is pending. Start the sign-in flow again.'
      );
    }

    // Authorization codes are single-use. Claim the pending flow immediately
    // so duplicate deep links cannot race two exchanges.
    this.pendingClient = null;
    const { data, error } = await client.exchangeCode(code);
    if (error) throw error;
    if (!data.session?.access_token || !data.session.refresh_token) {
      throw new Error('The authentication service returned no session.');
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
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
  let supabaseUrl: URL;
  let redirectTo: URL;
  try {
    supabaseUrl = new URL(config.supabaseUrl);
    redirectTo = new URL(config.redirectTo);
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

  if (
    redirectTo.origin !== expectedRendererOrigin ||
    redirectTo.pathname !== '/auth/electron-callback' ||
    redirectTo.search ||
    redirectTo.hash
  ) {
    throw new Error('The authentication callback URL was rejected.');
  }
}
