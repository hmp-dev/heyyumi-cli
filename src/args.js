"use strict";

/**
 * Minimal argv parser: positionals, `--key value`, `--key=value`, bare `--flag` (= true), `--` ends flags.
 * A value starting with "--" is never consumed, so `--parking --region 성수` keeps parking=true.
 */
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "-h") {
      flags.help = true;
      continue;
    }
    if (arg.startsWith("--") && arg.length > 2) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
        continue;
      }
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags };
}

// Flags the CLI itself consumes; never forwarded to a tool.
const CLI_FLAGS = new Set([
  "help",
  "pretty",
  "compact",
  "json",
  "timeout",
  "no-browser",
  "client-name",
  "force",
]);

// Tool arguments typed as numbers in the MCP schema.
const NUMERIC_KEYS = new Set([
  "page",
  "page_size",
  "min_confidence",
  "max_dish_price",
  "radius_m",
  "lat",
  "lng",
  "limit",
  "guestCount",
]);

function toSnake(key) {
  return key.replace(/-/g, "_");
}

/**
 * Turn CLI flags into tool arguments. Bare boolean flags become the string "true",
 * which is what the search filters expect (`--parking` → parking: "true").
 */
function flagsToToolArgs(flags, { rename = {}, skip = [] } = {}) {
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(flags)) {
    if (CLI_FLAGS.has(rawKey) || skip.includes(rawKey)) continue;
    const key = rename[rawKey] || toSnake(rawKey);
    let value = rawValue === true ? "true" : rawValue;
    if (NUMERIC_KEYS.has(key)) {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new TypeError(`--${rawKey} must be a number (got "${rawValue}")`);
      value = n;
    }
    out[key] = value;
  }
  return out;
}

module.exports = { parseArgs, flagsToToolArgs, CLI_FLAGS, NUMERIC_KEYS };
