import { app, safeStorage } from 'electron';
import { handleTrusted } from './ipc-security';
import {
  ConnectedSourceStore,
  type AddConnectedSourceInput,
} from './connected-source-store';
import { readSshAliasCandidates } from './ssh-alias-candidates';

/**
 * Renderer-safe control plane for configured Agent Sources (ENG-010 C1).
 *
 * The renderer may list what is configured, list the SSH aliases it could
 * offer, and add, rename, or detach a source. It never receives connection
 * material: every read goes through the store's view projection, and the OS
 * keychain lives entirely on this side of the boundary.
 *
 * There is deliberately no command channel here. H1 is read-only, and the
 * conversation path arrives with H2.
 */

let store: ConnectedSourceStore | null = null;

function sourceStore(): ConnectedSourceStore {
  store ??= new ConnectedSourceStore({
    userDataDir: app.getPath('userData'),
    encryption: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: plain => safeStorage.encryptString(plain),
      decryptString: encrypted => safeStorage.decryptString(encrypted),
    },
  });
  return store;
}

/** Exposed for tests and for the connect flow that lands with C2. */
export function setConnectedSourceStoreForTesting(
  replacement: ConnectedSourceStore | null
): void {
  store = replacement;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${label}`);
  }
  if (value.length > 512) throw new Error(`Invalid ${label}`);
  return value;
}

export function registerConnectedSourcesIPC(): void {
  handleTrusted('connected-sources:list', async () =>
    sourceStore().listViews()
  );

  /**
   * Passive enumeration only. Listing an alias is not contacting a server;
   * selecting one is, and that happens through connect, which C2 wires.
   */
  handleTrusted('connected-sources:ssh-aliases', async () =>
    readSshAliasCandidates()
  );

  handleTrusted(
    'connected-sources:add',
    async (_event, input: AddConnectedSourceInput) => {
      if (!input || typeof input !== 'object') {
        throw new Error('Invalid source');
      }
      // The store validates exhaustively, including the alias injection guard.
      // This layer only refuses shapes that are not worth handing on.
      assertString(input.displayName, 'source name');
      const result = sourceStore().add(input);
      if (!result.ok) return { ok: false as const, issues: result.issues };
      const view = sourceStore()
        .listViews()
        .find(candidate => candidate.id === result.record.id);
      return { ok: true as const, source: view ?? null };
    }
  );

  handleTrusted(
    'connected-sources:rename',
    async (_event, id: unknown, displayName: unknown) => ({
      ok: sourceStore().rename(
        assertString(id, 'source id'),
        assertString(displayName, 'source name')
      ),
    })
  );

  /**
   * Detach. Exawatt forgets the source and its stored credential. The remote
   * installation, its Agents, workspaces, history, and automations are not
   * touched, and the paired device stays revocable on the source itself.
   */
  handleTrusted('connected-sources:detach', async (_event, id: unknown) => ({
    ok: sourceStore().remove(assertString(id, 'source id')),
  }));
}
