#!/usr/bin/env node
"use strict";

const { parseArgs } = require("../src/args");
const { commands, HELP, checkOwnFlags } = require("../src/commands");
const { CliError } = require("../src/errors");

function print(value, flags) {
  const indent = flags.pretty || (process.stdout.isTTY && !flags.compact) ? 2 : 0;
  process.stdout.write(`${JSON.stringify(value, null, indent)}\n`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positionals, flags } = parseArgs(rest);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === "--version" || command === "-v" || command === "-V") {
    process.stdout.write(`${require("../package.json").version}\n`);
    return 0;
  }
  if (flags.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const handler = Object.prototype.hasOwnProperty.call(commands, command) ? commands[command] : null;
  if (!handler) {
    print(new CliError("usage", `Unknown command "${command}"`, { exitCode: 2, next: "npx -y heyyumi help" }).toJSON(), flags);
    return 2;
  }

  try {
    checkOwnFlags(command, flags);
    print(await handler({ positionals, flags }), flags);
    return 0;
  } catch (e) {
    const err =
      e instanceof CliError
        ? e
        : e instanceof TypeError && !e.cause
          ? new CliError("usage", e.message, { exitCode: 2 })
          : new CliError("unexpected", e?.message || String(e));
    print(err.toJSON(), flags);
    return err.exitCode;
  }
}

main().then((code) => {
  process.exitCode = code;
});
