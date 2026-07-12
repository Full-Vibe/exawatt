import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

interface StoredRunState {
  v: 1;
  runId: string;
  pid: number;
  startedAt: number;
  clean: boolean;
}

export class RunStateStore {
  private current: StoredRunState | null = null;

  constructor(private readonly file: string) {}

  async begin(): Promise<{ previousRunInterrupted: boolean }> {
    let previousRunInterrupted = false;
    try {
      const previous = JSON.parse(
        await fs.promises.readFile(this.file, 'utf8')
      ) as Partial<StoredRunState>;
      previousRunInterrupted = previous.v !== 1 || previous.clean !== true;
    } catch (error) {
      previousRunInterrupted =
        (error as NodeJS.ErrnoException).code !== 'ENOENT';
    }
    this.current = {
      v: 1,
      runId: randomUUID(),
      pid: process.pid,
      startedAt: Date.now(),
      clean: false,
    };
    await this.write(this.current);
    return { previousRunInterrupted };
  }

  async markClean(): Promise<void> {
    if (!this.current) return;
    this.current = { ...this.current, clean: true };
    await this.write(this.current);
  }

  private async write(state: StoredRunState): Promise<void> {
    const directory = path.dirname(this.file);
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(temporary, JSON.stringify(state), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.promises.chmod(temporary, 0o600);
    await fs.promises.rename(temporary, this.file);
    await fs.promises.chmod(this.file, 0o600);
  }
}
