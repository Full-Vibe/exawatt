/**
 * One MCP server a capability offers a launch (ENG-029 B2: the bus's MCP
 * door), and the two shapes harnesses take it in. The session manager hands
 * the server to the harness through the descriptor's binding without knowing
 * what it is; a harness with no per-launch seam declares no binding and the
 * server is simply not offered.
 *
 * Nothing here writes the user's harness configuration: the declaration is a
 * per-launch file in Exawatt's own state or a per-launch argument.
 */

export interface LaunchMcpServer {
  /** The server's name in the harness (`exawatt`): tool names carry it. */
  name: string;
  command: string;
  args: readonly string[];
  /** Every variable the server needs, values included. */
  env: Readonly<Record<string, string>>;
  /**
   * Names in `env` that the launch's own environment also carries. A
   * declaration that travels on the argv forwards these by name rather than
   * spelling a token out where `ps` and a logged command line would show it.
   */
  inherited: readonly string[];
}

const NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function checked(server: LaunchMcpServer): LaunchMcpServer {
  if (!NAME.test(server.name)) throw new Error('Invalid MCP server name');
  for (const key of [...Object.keys(server.env), ...server.inherited]) {
    if (!VARIABLE.test(key)) throw new Error('Invalid MCP server variable');
  }
  if (server.inherited.some(key => !(key in server.env))) {
    throw new Error('An inherited MCP server variable has no value');
  }
  return server;
}

/**
 * The `mcpServers` document Claude Code's `--mcp-config` and Antigravity's
 * `.agents/mcp_config.json` both read (B0, 2026-10-15). Values are written
 * out: the file is per launch, owner-only, and removed when the Session
 * ends, the same custody as the hook settings beside it.
 */
export function mcpServersDocument(server: LaunchMcpServer): string {
  const { name, command, args, env } = checked(server);
  return JSON.stringify({
    mcpServers: { [name]: { command, args: [...args], env: { ...env } } },
  });
}

/** A TOML basic string; JSON's escapes are a subset TOML accepts. */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Codex's per-launch declaration: `-c mcp_servers.<name>.*` overrides
 * (measured on 0.162.1). Inherited variables travel by name in `env_vars`,
 * never as values on the argv.
 */
export function codexMcpOverrides(server: LaunchMcpServer): string[] {
  const { name, command, args, env, inherited } = checked(server);
  const key = `mcp_servers.${name}`;
  const literal = Object.entries(env).filter(
    ([variable]) => !inherited.includes(variable)
  );
  return [
    `${key}.command=${tomlString(command)}`,
    `${key}.args=[${args.map(tomlString).join(',')}]`,
    ...(literal.length
      ? [
          `${key}.env={${literal
            .map(([variable, value]) => `${variable}=${tomlString(value)}`)
            .join(',')}}`,
        ]
      : []),
    ...(inherited.length
      ? [`${key}.env_vars=[${inherited.map(tomlString).join(',')}]`]
      : []),
  ];
}
