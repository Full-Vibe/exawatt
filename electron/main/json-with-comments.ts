/**
 * JSON the way the gemini-cli family (Qwen Code among it) reads its own
 * settings: a UTF-8 byte-order mark is dropped, and `//` and `/* *\/`
 * comments outside strings are ignored. Everything else is strict JSON, so a
 * trailing comma is still an error, exactly as it is for the harness. A
 * reader that is stricter than the harness reports a valid file as broken.
 */

const BOM = '\uFEFF';

/** The text with every comment outside a string replaced by whitespace, so
 *  a parse error still points at the right line. */
function stripJsonComments(text: string): string {
  let out = '';
  let index = text.startsWith(BOM) ? 1 : 0;
  let inString = false;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      out += char;
      if (char === '\\' && index + 1 < text.length) {
        out += next;
        index += 2;
        continue;
      }
      if (char === '"') inString = false;
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      index += 1;
    } else if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(index, stop).replace(/[^\n]/g, ' ');
      index = stop;
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
}

/** Throws the parser's `SyntaxError` for text the harness would reject too. */
export function parseJsonWithComments(text: string): unknown {
  return JSON.parse(stripJsonComments(text));
}
