/**
 * Terminal input leaves in the order the operator gave it (BUG-353).
 *
 * A paste reads the clipboard in main before xterm can send it, so it takes a
 * round trip, and longer for image data, which main saves to a file first.
 * Keys pressed during that wait must not overtake it: dictation and snippet
 * tools press ⌘V and then Return, and a Return that arrives first submits the
 * prompt without the text.
 *
 * Every paste takes its place in line when it is asked for. Input that
 * arrives while one is waiting queues behind it, and input sent by the paste
 * itself goes straight out. A paste that finds nothing, or fails, still
 * releases what queued behind it.
 */
interface TerminalInputOrder {
  /** Input from xterm's data event. */
  send(data: string, operatorEngaged: boolean): void;
  /** A paste of `read`'s text, handed to `insert` once its turn comes. */
  paste(read: () => Promise<string>, insert: (text: string) => void): void;
}

export function createTerminalInputOrder(
  write: (data: string, operatorEngaged: boolean) => void
): TerminalInputOrder {
  let line: Promise<void> = Promise.resolve();
  let waiting = 0;
  let inserting = false;
  const enqueue = (step: () => void | Promise<void>) => {
    waiting += 1;
    line = line
      .then(step)
      .catch(() => undefined)
      .finally(() => {
        waiting -= 1;
      });
  };
  return {
    send(data, operatorEngaged) {
      if (inserting || waiting === 0) write(data, operatorEngaged);
      else enqueue(() => write(data, operatorEngaged));
    },
    paste(read, insert) {
      // the read starts now; only its insertion waits its turn
      const text = read().catch(() => '');
      enqueue(async () => {
        const value = await text;
        if (!value) return;
        inserting = true;
        try {
          insert(value);
        } finally {
          inserting = false;
        }
      });
    },
  };
}

// A pasted text must not end the bracketing it travels in: real terminals
// drop these markers from what they paste.
const PASTE_BRACKETS = /\x1b\[20[01]~/g;

/** Clipboard text as a terminal may paste it. */
export function terminalPasteText(text: string): string {
  return text.replace(PASTE_BRACKETS, '');
}
