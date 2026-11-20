import { describe, expect, it } from 'vitest';
import {
  createTerminalInputOrder,
  terminalPasteText,
} from './terminal-input-order';

function deferred() {
  let resolve!: (text: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** A terminal whose paste sends its text back through `send`, the way
 * xterm's paste fires its data event synchronously. */
function harness() {
  const written: string[] = [];
  const order = createTerminalInputOrder(data => written.push(data));
  const paste = (read: Promise<string>) =>
    order.paste(
      () => read,
      text => order.send(`[${text}]`, true)
    );
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  return { written, order, paste, settle };
}

describe('createTerminalInputOrder', () => {
  it('sends input straight through when no paste is waiting', () => {
    const { written, order } = harness();
    order.send('a', true);
    order.send('b', false);
    expect(written).toEqual(['a', 'b']);
  });

  it('holds keys pressed during a paste until the paste is sent', async () => {
    const { written, order, paste, settle } = harness();
    order.send('before', true);
    const read = deferred();
    paste(read.promise);
    order.send('\r', true);
    await settle();
    expect(written).toEqual(['before']);
    read.resolve('dictated text');
    await settle();
    expect(written).toEqual(['before', '[dictated text]', '\r']);
    order.send('after', true);
    expect(written.at(-1)).toBe('after');
  });

  it('sends pastes in the order they were asked for', async () => {
    const { written, order, paste, settle } = harness();
    const first = deferred();
    const second = deferred();
    paste(first.promise);
    order.send('x', true);
    paste(second.promise);
    order.send('y', true);
    second.resolve('two');
    await settle();
    expect(written).toEqual([]);
    first.resolve('one');
    await settle();
    expect(written).toEqual(['[one]', 'x', '[two]', 'y']);
  });

  it('releases waiting keys when a paste finds nothing or fails', async () => {
    const { written, order, paste, settle } = harness();
    const empty = deferred();
    paste(empty.promise);
    order.send('a', true);
    empty.resolve('');
    await settle();
    const failed = deferred();
    paste(failed.promise);
    order.send('b', true);
    failed.reject(new Error('clipboard unavailable'));
    await settle();
    expect(written).toEqual(['a', 'b']);
  });

  it('releases waiting keys when inserting throws', async () => {
    const written: string[] = [];
    const order = createTerminalInputOrder(data => written.push(data));
    order.paste(
      async () => 'text',
      () => {
        throw new Error('terminal disposed');
      }
    );
    order.send('a', true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(written).toEqual(['a']);
  });
});

describe('terminalPasteText', () => {
  it('drops bracketed-paste markers so a paste cannot end its own bracket', () => {
    expect(terminalPasteText('safe\x1b[201~rm -rf ~\r\x1b[200~')).toBe(
      'safe' + 'rm -rf ~\r'
    );
  });
});
