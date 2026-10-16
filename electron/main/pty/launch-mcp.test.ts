import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { codexMcpOverrides, mcpServersDocument } from './launch-mcp';

const server = {
  name: 'exawatt',
  command: '/Applications/Exawatt "Dev".app/Contents/MacOS/Exawatt',
  args: [
    '/Users/x/Library/Application Support/Exawatt/bus/bin/exawatt-mcp.cjs',
    '1.0.0',
  ],
  env: { ELECTRON_RUN_AS_NODE: '1', EXAWATT_BUS_TOKEN: 't\\o"k' },
  inherited: ['EXAWATT_BUS_TOKEN'],
};

describe('per-launch MCP declarations', () => {
  it('writes the mcpServers document Claude Code and Antigravity read, values included', () => {
    expect(JSON.parse(mcpServersDocument(server))).toEqual({
      mcpServers: {
        exawatt: {
          command: server.command,
          args: server.args,
          env: server.env,
        },
      },
    });
  });

  it('gives Codex overrides that parse as TOML to the same server, forwarding inherited values by name', () => {
    const config: Record<string, unknown> = {};
    for (const override of codexMcpOverrides(server)) {
      const equals = override.indexOf('=');
      const key = override.slice(0, equals).split('.').at(-1)!;
      config[key] = parse(`v = ${override.slice(equals + 1)}`).v;
    }
    expect(config).toEqual({
      command: server.command,
      args: server.args,
      env: { ELECTRON_RUN_AS_NODE: '1' },
      env_vars: ['EXAWATT_BUS_TOKEN'],
    });
  });

  it('refuses a name or variable that could break out of its key', () => {
    expect(() => mcpServersDocument({ ...server, name: 'a.b' })).toThrow();
    expect(() =>
      codexMcpOverrides({ ...server, env: { 'A=B': '1' }, inherited: [] })
    ).toThrow();
    expect(() =>
      codexMcpOverrides({ ...server, inherited: ['MISSING'] })
    ).toThrow();
  });
});
