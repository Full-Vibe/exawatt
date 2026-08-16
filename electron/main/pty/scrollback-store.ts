import { TranscriptWindow } from './transcript-window';

export interface ScrollbackDelta {
  text: string;
  /** The requested cursor fell before retained scrollback. */
  truncated: boolean;
}

/**
 * Bounded replay buffers with absolute cursors. Terminal panes consume the
 * retained text; context paging consumes only text appended after a visit.
 *
 * The buffer itself is a `TranscriptWindow` (ENG-016 BUG-024): appending used
 * to rebuild the whole 4 MB window roughly once per output LINE once a Session
 * reached the cap, which is a sustained stream of multi-megabyte allocations on
 * the Electron main process.
 */
export class ScrollbackStore {
  private readonly entries = new Map<string, TranscriptWindow>();

  constructor(private readonly limit = 4_000_000) {}

  /** The live window, so persistence can read deltas instead of full copies. */
  window(id: string): TranscriptWindow | undefined {
    return this.entries.get(id);
  }

  private ensure(id: string): TranscriptWindow {
    const existing = this.entries.get(id);
    if (existing) return existing;
    const created = new TranscriptWindow(this.limit);
    this.entries.set(id, created);
    return created;
  }

  seed(id: string, text: string, cursor = text.length): void {
    this.ensure(id).seed(text, cursor);
  }

  append(id: string, data: string): void {
    this.ensure(id).append(data);
  }

  delete(id: string): void {
    this.entries.delete(id);
  }

  text(id: string): string {
    return this.entries.get(id)?.text() ?? '';
  }

  /** Retained size without materialising the transcript. */
  length(id: string): number {
    return this.entries.get(id)?.length ?? 0;
  }

  cursor(id: string): number {
    return this.entries.get(id)?.cursor ?? 0;
  }

  since(id: string, cursor: number): ScrollbackDelta {
    return (
      this.entries.get(id)?.since(cursor) ?? { text: '', truncated: false }
    );
  }
}
