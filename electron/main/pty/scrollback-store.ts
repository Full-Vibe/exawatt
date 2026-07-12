export interface ScrollbackDelta {
  text: string;
  /** The requested cursor fell before retained scrollback. */
  truncated: boolean;
}

interface ScrollbackEntry {
  text: string;
  /** Absolute character offsets survive trimming from the retained head. */
  start: number;
  end: number;
}

/**
 * Bounded replay buffers with absolute cursors. Terminal panes consume the
 * retained text; context paging consumes only text appended after a visit.
 */
export class ScrollbackStore {
  private readonly entries = new Map<string, ScrollbackEntry>();

  constructor(private readonly limit = 4_000_000) {}

  seed(id: string, text: string, cursor = text.length): void {
    const retained = text.length > this.limit ? text.slice(-this.limit) : text;
    const end = Math.max(cursor, retained.length);
    this.entries.set(id, {
      text: retained,
      start: end - retained.length,
      end,
    });
  }

  append(id: string, data: string): void {
    const previous = this.entries.get(id) ?? { text: '', start: 0, end: 0 };
    const end = previous.end + data.length;
    let text = previous.text + data;
    if (text.length > this.limit) {
      text = text.slice(-this.limit);
      const newline = text.indexOf('\n');
      if (newline !== -1 && newline < 4096) text = text.slice(newline + 1);
    }
    this.entries.set(id, { text, start: end - text.length, end });
  }

  delete(id: string): void {
    this.entries.delete(id);
  }

  text(id: string): string {
    return this.entries.get(id)?.text ?? '';
  }

  cursor(id: string): number {
    return this.entries.get(id)?.end ?? 0;
  }

  since(id: string, cursor: number): ScrollbackDelta {
    const entry = this.entries.get(id);
    if (!entry || cursor >= entry.end) return { text: '', truncated: false };
    const truncated = cursor < entry.start;
    return {
      text: entry.text.slice(Math.max(0, cursor - entry.start)),
      truncated,
    };
  }
}
