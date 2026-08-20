#!/usr/bin/env node
/**
 * Run a command inside one machine slot (ENG-022 H15): waits for a slot,
 * spawns the command with the slot token in its environment so nested heavy
 * commands are reentrant instead of queueing behind their own parent, and
 * releases the slot when the command exits — on signals too.
 *
 *   node scripts/with-machine-slot.mjs --label test:run -- vitest run ...
 */
import { spawn } from 'node:child_process';

import { acquireMachineSlot } from './lib/machine-slots.mjs';

const argv = process.argv.slice(2);
let label;
let commandStart = 0;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--label') {
    label = argv[i + 1];
    i += 1;
  } else if (argv[i] === '--') {
    commandStart = i + 1;
    break;
  } else {
    commandStart = i;
    break;
  }
}
const command = argv.slice(commandStart);
if (command.length === 0) {
  console.error(
    'usage: with-machine-slot.mjs [--label <name>] -- <command> [args...]'
  );
  process.exit(2);
}

const slot = await acquireMachineSlot({ label: label ?? command[0] });

const child = spawn(command[0], command.slice(1), {
  stdio: 'inherit',
  env: process.env,
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.once('error', error => {
  void slot.release().finally(() => {
    console.error(
      `[machine-slots] ${command[0]} failed to start: ${error.message}`
    );
    process.exit(1);
  });
});
child.once('exit', (code, signal) => {
  void slot.release().finally(() => {
    process.exit(signal ? 1 : (code ?? 1));
  });
});
