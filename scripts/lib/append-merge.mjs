import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

/**
 * The append-only merge driver for the shared engineering logs (BUG-203).
 *
 * In September 20 of the 38 ticket deaths were rebase conflicts, and 13 of
 * those were pure insertions at the same spot in a doc: two backlog entries,
 * two findings, two incident index lines, each added just above the same
 * anchor. Git calls that a conflict because it cannot know the order; for an
 * append-only log either order is right. In 4 of the 13 both sides had also
 * taken the same BUG, D, incident or decision number, and that one IS a
 * conflict, because the result would carry one id twice.
 *
 * So the driver resolves exactly one shape and refuses everything else:
 *
 *   - git's own merge (`git merge-file`) runs first; when it is clean, its
 *     result stands and nothing here runs;
 *   - otherwise every conflicting region must be one pure insertion from
 *     each side at the same base position (no base line changed or removed on
 *     either side). Ours goes first, then theirs; identical inserts are kept
 *     once;
 *   - and neither side may introduce an id the other side also introduces.
 *
 * Anything else leaves git's conflict markers exactly as git wrote them.
 * `.gitattributes` scopes it to the roadmap, the project docs and the
 * incidents index.
 */

const execFileAsync = promisify(execFile);

const APPEND_MERGE_DRIVER = 'exawatt-append';
const DRIVER_LABEL = 'Exawatt append-only docs merge (BUG-203)';
const DRIVER_SCRIPT = 'scripts/merge-append-docs.mjs';
const PLACEHOLDERS = '%O %A %B %L %P %S %X %Y';

/**
 * The command the common git config carries (`pnpm hooks:install`). It is
 * relative, so each checkout runs its own tree's driver, and it falls back to
 * git's own merge when that tree predates the driver or has no node: a driver
 * that cannot start must never leave a conflict without markers.
 */
const INSTALLED_DRIVER_COMMAND =
  `[ -f ${DRIVER_SCRIPT} ] && command -v node >/dev/null 2>&1 && ` +
  `exec node ${DRIVER_SCRIPT} ${PLACEHOLDERS}; ` +
  'exec git merge-file --marker-size=%L -L %X -L %S -L %Y %A %O %B';

export const INSTALLED_DRIVER_CONFIG = Object.freeze([
  [`merge.${APPEND_MERGE_DRIVER}.name`, DRIVER_LABEL],
  [`merge.${APPEND_MERGE_DRIVER}.driver`, INSTALLED_DRIVER_COMMAND],
]);

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

/**
 * `-c` arguments that `agent:land` passes explicitly on the head's rebase and
 * on the conflict probe, pointing at this tree's own driver by absolute path,
 * so the queue does not depend on what the common config holds.
 */
export function appendMergeGitArgs({
  node = process.execPath,
  script = fileURLToPath(new URL('../merge-append-docs.mjs', import.meta.url)),
} = {}) {
  return [
    '-c',
    `merge.${APPEND_MERGE_DRIVER}.name=${DRIVER_LABEL}`,
    '-c',
    `merge.${APPEND_MERGE_DRIVER}.driver=${shellQuote(node)} ${shellQuote(path.resolve(script))} ${PLACEHOLDERS}`,
  ];
}

/** Lines with their terminators, so joining them reproduces the bytes. */
export function splitLines(text) {
  return text === '' ? [] : text.split(/(?<=\n)/u);
}

/**
 * Hunks from `git diff -U0` headers, as base ranges [start, end) with the
 * side's replacement lines taken from the side's own text, never from the
 * diff body.
 */
export function parseHunks(diff, sideLines) {
  const hunks = [];
  for (const match of diff.matchAll(
    /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gmu
  )) {
    const [baseAt, baseCount, sideAt, sideCount] = [
      Number(match[1]),
      match[2] === undefined ? 1 : Number(match[2]),
      Number(match[3]),
      match[4] === undefined ? 1 : Number(match[4]),
    ];
    const start = baseCount === 0 ? baseAt : baseAt - 1;
    const sideStart = sideCount === 0 ? sideAt : sideAt - 1;
    hunks.push({
      start,
      end: start + baseCount,
      lines: sideLines.slice(sideStart, sideStart + sideCount),
    });
  }
  return hunks;
}

/** The id families a log entry can allocate, keyed so collisions compare. */
export function idsIn(text, filePath = '') {
  const found = new Set();
  const add = (kind, value) => found.add(`${kind} ${value}`);
  for (const match of text.matchAll(/\b(BUG|FIX)-(\d+)\b/gu))
    add(match[1], match[2]);
  for (const match of text.matchAll(/\bD(\d{1,3})\b/gu)) add('D', match[1]);
  for (const match of text.matchAll(
    /\b(incident|decision)s?[/\s]+`?(\d{4})\b/giu
  ))
    add(match[1].toLowerCase(), match[2]);
  for (const match of text.matchAll(/\b(incident|decision)s\/(\d{4})-/gu))
    add(match[1], match[2]);
  if (/(?:^|\/)incidents\/README\.md$/u.test(filePath)) {
    for (const match of text.matchAll(/(?<![\w/])(\d{4})-[a-z0-9-]+\.md/gu))
      add('incident', match[1]);
  }
  return found;
}

function insertedText(hunks) {
  return hunks.flatMap(hunk => hunk.lines).join('');
}

/**
 * The ids each side introduces (present in its inserted lines and absent
 * from the base) that the other side introduces too.
 */
export function collidingIds({ base, oursHunks, theirsHunks, filePath }) {
  const existing = idsIn(base, filePath);
  const introduced = hunks =>
    [...idsIn(insertedText(hunks), filePath)].filter(id => !existing.has(id));
  const ours = new Set(introduced(oursHunks));
  return introduced(theirsHunks)
    .filter(id => ours.has(id))
    .sort();
}

function sameHunk(left, right) {
  return (
    left.start === right.start &&
    left.end === right.end &&
    left.lines.join('') === right.lines.join('')
  );
}

/**
 * Merges when every region both sides changed is one pure insertion from each
 * side at the same base position. Returns `{ merged }` or `{ refused }` with
 * the reason. Regions only one side changed are applied as git would.
 */
export function mergeAppendOnly({ base, oursHunks, theirsHunks }) {
  const baseLines = splitLines(base);
  const all = [
    ...oursHunks.map(hunk => ({ ...hunk, side: 'ours' })),
    ...theirsHunks.map(hunk => ({ ...hunk, side: 'theirs' })),
  ].sort((left, right) => left.start - right.start || left.end - right.end);

  // Hunks that overlap or touch form one region, as git's own merge groups
  // them: a change adjacent to the other side's change is a conflict there.
  const groups = [];
  for (const hunk of all) {
    const group = groups.at(-1);
    if (group && hunk.start <= group.end) {
      group.hunks.push(hunk);
      group.end = Math.max(group.end, hunk.end);
    } else {
      groups.push({ start: hunk.start, end: hunk.end, hunks: [hunk] });
    }
  }

  const out = [];
  let at = 0;
  let resolved = 0;
  for (const group of groups) {
    out.push(...baseLines.slice(at, group.start));
    const ours = group.hunks.filter(hunk => hunk.side === 'ours');
    const theirs = group.hunks.filter(hunk => hunk.side === 'theirs');
    if (ours.length === 0 || theirs.length === 0) {
      let cursor = group.start;
      for (const hunk of group.hunks) {
        out.push(...baseLines.slice(cursor, hunk.start), ...hunk.lines);
        cursor = hunk.end;
      }
      out.push(...baseLines.slice(cursor, group.end));
    } else if (
      ours.length === 1 &&
      theirs.length === 1 &&
      sameHunk(ours[0], theirs[0])
    ) {
      out.push(...ours[0].lines);
    } else if (
      ours.length === 1 &&
      theirs.length === 1 &&
      ours[0].start === ours[0].end &&
      theirs[0].start === theirs[0].end &&
      ours[0].start === theirs[0].start
    ) {
      out.push(...ours[0].lines, ...theirs[0].lines);
      resolved += 1;
    } else {
      return {
        refused: `both sides changed base lines ${group.start + 1}-${Math.max(group.end, group.start + 1)}, which is more than an insertion at one anchor`,
      };
    }
    at = group.end;
  }
  out.push(...baseLines.slice(at));
  return { merged: out.join(''), resolved };
}

async function gitOutput(args, cwd, { okCodes = [0] } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, stdout };
  } catch (error) {
    if (okCodes.includes(error?.code)) {
      return { code: error.code, stdout: String(error.stdout ?? '') };
    }
    throw error;
  }
}

const DIFF_ARGS = [
  'diff',
  '--no-index',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--diff-algorithm=myers',
  '--indent-heuristic',
  '-U0',
];

/** One side's hunks against the base, from git's own diff. */
async function sideHunks(basePath, sidePath, sideText, cwd) {
  const { stdout } = await gitOutput(
    [...DIFF_ARGS, '--', basePath, sidePath],
    cwd,
    { okCodes: [0, 1] }
  );
  return parseHunks(stdout, splitLines(sideText));
}

/**
 * The whole driver decision for one file. `git` is git's standard result
 * (`merge-file -p`), which stands whenever it is clean or this refuses.
 */
export async function decideAppendMerge({
  basePath,
  oursPath,
  theirsPath,
  base,
  ours,
  theirs,
  filePath,
  standard,
  cwd,
}) {
  if (standard.conflicts === 0) {
    return { result: standard.text, clean: true, note: null };
  }
  const [oursHunks, theirsHunks] = await Promise.all([
    sideHunks(basePath, oursPath, ours, cwd),
    sideHunks(basePath, theirsPath, theirs, cwd),
  ]);
  const collisions = collidingIds({ base, oursHunks, theirsHunks, filePath });
  if (collisions.length > 0) {
    return {
      result: standard.text,
      clean: false,
      note: `${filePath}: both sides introduce ${collisions.join(', ')}; renumber one with \`pnpm id:next\` (BUG-203)`,
    };
  }
  const merge = mergeAppendOnly({ base, oursHunks, theirsHunks });
  if (merge.refused) {
    return {
      result: standard.text,
      clean: false,
      note: `${filePath}: ${merge.refused}; left for a person (BUG-203)`,
    };
  }
  return {
    result: merge.merged,
    clean: true,
    note: `${filePath}: kept both insertions at ${merge.resolved} shared anchor(s), ours first (BUG-203)`,
  };
}
