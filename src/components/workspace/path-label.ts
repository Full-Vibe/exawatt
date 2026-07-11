export function middleTruncatePath(value: string, maxLength = 76): string {
  if (value.length <= maxLength) return value;
  const separator = value.includes('\\') ? '\\' : '/';
  const parts = value.split(separator).filter(Boolean);
  if (parts.length < 3) {
    const side = Math.max(1, Math.floor((maxLength - 1) / 2));
    return `${value.slice(0, side)}…${value.slice(-side)}`;
  }

  const root = value.startsWith(separator) ? separator : '';
  const tail = parts.slice(-2).join(separator);
  const budget = Math.max(8, maxLength - tail.length - 2);
  let head = root;
  for (const part of parts.slice(0, -2)) {
    const next = `${head}${head && !head.endsWith(separator) ? separator : ''}${part}`;
    if (next.length > budget) break;
    head = next;
  }
  return `${head || root}…${separator}${tail}`;
}
