/**
 * The `exawatt` command an Agent runs (ENG-029 C4): the universal outbound
 * door, for every harness that has a shell tool, with no per-harness wiring.
 *
 * It is a POSIX shell script over `curl`, both present on every Mac, so the
 * packaged app ships no interpreter and no build toolchain for it (BUG-030).
 * Exawatt writes it into its own state at startup and puts that directory in
 * front of each launched Session's PATH, so it exists only for Sessions
 * Exawatt launched; with Exawatt closed no Agent has it and every Agent
 * behaves exactly as it does today. The script carries no secret: the port,
 * the token and the Session's address arrive in the launch environment.
 */
import fs from 'fs';
import path from 'path';

export const BUS_EXECUTABLE_NAME = 'exawatt';

const BUS_EXECUTABLE_SCRIPT = `#!/bin/sh
# exawatt: message the other Agents in this Project through Exawatt.
# Written by Exawatt; present only in Sessions Exawatt launched.
usage() {
  cat <<'USAGE'
Usage:
  exawatt agents                  list the Agents in this Project
  exawatt send @name <message>    send a message (or pipe it on stdin)
  exawatt inbox                   read the messages sent to you
USAGE
}
if [ -z "\${EXAWATT_BUS_PORT:-}" ] || [ -z "\${EXAWATT_BUS_TOKEN:-}" ]; then
  echo "exawatt: this shell was not started by Exawatt, so it cannot reach other Agents." >&2
  exit 69
fi
post() {
  curl --silent --show-error --max-time 30 --fail-with-body \\
    --header "x-exawatt-token: \${EXAWATT_BUS_TOKEN}" \\
    --header 'content-type: text/plain; charset=utf-8' \\
    --data-binary @- "http://127.0.0.1:\${EXAWATT_BUS_PORT}/bus/$1"
  status=$?
  if [ "$status" -eq 7 ]; then
    echo "exawatt: Exawatt is not running, so the message was not sent." >&2
    exit 69
  fi
  [ "$status" -eq 0 ] || exit 1
}
command=\${1:-}
[ $# -gt 0 ] && shift
case "$command" in
  agents) printf '' | post agents ;;
  inbox) printf '' | post inbox ;;
  send)
    to=\${1:-}
    if [ -z "$to" ]; then usage >&2; exit 64; fi
    shift
    if [ $# -gt 0 ]; then
      printf '%s\\n%s' "$to" "$*" | post send
    elif [ ! -t 0 ]; then
      { printf '%s\\n' "$to"; cat; } | post send
    else
      usage >&2; exit 64
    fi
    ;;
  -h|--help|help) usage ;;
  *) usage >&2; exit 64 ;;
esac
`;

/**
 * Write the command into `directory` (owner-only, executable) and return the
 * directory to put on PATH, or null when it could not be written — a launch
 * then simply has no `exawatt` command.
 */
export async function installBusExecutable(
  directory: string
): Promise<string | null> {
  const target = path.join(directory, BUS_EXECUTABLE_NAME);
  try {
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    const current = await fs.promises
      .readFile(target, 'utf8')
      .catch(() => null);
    if (current !== BUS_EXECUTABLE_SCRIPT) {
      const temporary = `${target}.${process.pid}.tmp`;
      await fs.promises.writeFile(temporary, BUS_EXECUTABLE_SCRIPT, {
        encoding: 'utf8',
        mode: 0o700,
      });
      await fs.promises.rename(temporary, target);
    }
    await fs.promises.chmod(target, 0o700);
    return directory;
  } catch (error) {
    console.warn('[bus] the exawatt command could not be installed', error);
    return null;
  }
}
