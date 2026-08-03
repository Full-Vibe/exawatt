/** A one-shot gate that preserves byte ordering while async setup completes. */
export class OrderedWriteBuffer {
  private pending: string[] | null = null;

  get active(): boolean {
    return this.pending !== null;
  }

  begin(data: string): void {
    if (this.pending) throw new Error('Ordered write buffer is already active');
    this.pending = [data];
  }

  hold(data: string): boolean {
    if (!this.pending) return false;
    this.pending.push(data);
    return true;
  }

  release(write: (data: string) => void): void {
    const pending = this.pending ?? [];
    this.pending = null;
    for (const data of pending) write(data);
  }

  /** Fail a pre-submit gate without sending the held submit bytes. */
  discard(): void {
    this.pending = null;
  }
}
