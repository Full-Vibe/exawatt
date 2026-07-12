import * as fs from 'fs';
import * as path from 'path';

export interface SessionHistorySnapshot {
  text: string;
  cursor: number;
  updatedAt: number;
  corrupt: boolean;
}

interface StoredHistoryV1 {
  v: 1;
  text: string;
  cursor: number;
  updatedAt: number;
}

const EMPTY: SessionHistorySnapshot = {
  text: '',
  cursor: 0,
  updatedAt: 0,
  corrupt: false,
};

function validSessionId(id: string): boolean {
  return /^[A-Za-z0-9._-]{1,200}$/.test(id);
}

/** Crash-safe, machine-local retained terminal history keyed by logical Session. */
export class SessionHistoryStore {
  private dirty = new Map<string, StoredHistoryV1>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly root: string,
    private readonly flushDelayMs = 250
  ) {}

  async initialize(): Promise<void> {
    await fs.promises.mkdir(this.root, { recursive: true, mode: 0o700 });
    await fs.promises.chmod(this.root, 0o700);
  }

  private file(id: string): string {
    if (!validSessionId(id)) throw new Error('Invalid durable Session ID');
    return path.join(this.root, `${id}.json`);
  }

  async load(id: string): Promise<SessionHistorySnapshot> {
    const file = this.file(id);
    try {
      const raw = JSON.parse(
        await fs.promises.readFile(file, 'utf8')
      ) as Partial<StoredHistoryV1>;
      if (
        raw.v !== 1 ||
        typeof raw.text !== 'string' ||
        typeof raw.cursor !== 'number' ||
        !Number.isFinite(raw.cursor) ||
        raw.cursor < raw.text.length ||
        typeof raw.updatedAt !== 'number'
      ) {
        return { ...EMPTY, corrupt: true };
      }
      return {
        text: raw.text,
        cursor: raw.cursor,
        updatedAt: raw.updatedAt,
        corrupt: false,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { ...EMPTY };
      return { ...EMPTY, corrupt: true };
    }
  }

  queue(id: string, snapshot: Omit<SessionHistorySnapshot, 'corrupt'>): void {
    this.file(id);
    this.dirty.set(id, { v: 1, ...snapshot });
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(error =>
        console.error('Session history flush failed', error)
      );
    }, this.flushDelayMs);
    this.timer.unref?.();
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.initialize();
    while (this.dirty.size > 0) {
      const batch = Array.from(this.dirty.entries());
      for (const [id, record] of batch) {
        if (this.dirty.get(id) === record) this.dirty.delete(id);
        await this.write(id, record);
      }
    }
  }

  async delete(id: string): Promise<void> {
    this.dirty.delete(id);
    await fs.promises.rm(this.file(id), { force: true });
  }

  private async write(id: string, record: StoredHistoryV1): Promise<void> {
    const destination = this.file(id);
    const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(temporary, JSON.stringify(record), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.promises.chmod(temporary, 0o600);
    await fs.promises.rename(temporary, destination);
    await fs.promises.chmod(destination, 0o600);
  }
}
