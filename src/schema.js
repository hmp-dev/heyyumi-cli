"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { configDir, MCP_URL } = require("./config");
const { listTools } = require("./mcp");
const { CliError } = require("./errors");

const TTL_MS = 60 * 60 * 1000;

function cachePath() {
  return path.join(configDir(), "tools-cache.json");
}

/** Tool schemas, cached for an hour. null when the server can't be asked (validation is then skipped). */
async function loadSchemas() {
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath(), "utf8"));
    if (cached.mcpUrl === MCP_URL && Date.now() - cached.savedAt < TTL_MS && cached.tools) return cached.tools;
  } catch {
    // No cache yet.
  }
  let tools;
  try {
    tools = await listTools();
  } catch (e) {
    if (e instanceof CliError && e.exitCode === 3) throw e;
    return null;
  }
  const byName = {};
  for (const t of tools) byName[t.name] = t.inputSchema || {};
  try {
    fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(cachePath(), JSON.stringify({ mcpUrl: MCP_URL, savedAt: Date.now(), tools: byName }));
  } catch {
    // Read-only home: validate this run without caching.
  }
  return byName;
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

function suggest(key, known) {
  return known
    .map((k) => ({ k, d: k.startsWith(key) || key.startsWith(k) ? 0 : editDistance(key, k) }))
    .filter((x) => x.d <= Math.max(2, Math.floor(key.length / 3)))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((x) => x.k);
}

/**
 * The server drops arguments it doesn't know without saying so, which turns a typo into a silently
 * wrong search. Reject unknown keys here and coerce booleans the schema types as boolean.
 */
function checkArgs(toolName, args, schema) {
  const props = schema?.properties;
  if (!props) return args;
  const known = Object.keys(props);
  const unknown = Object.keys(args).filter((k) => !(k in props));
  if (unknown.length) {
    const hints = unknown.map((k) => {
      const s = suggest(k, known);
      return s.length ? `--${k} (did you mean ${s.map((x) => `--${x}`).join(", ")}?)` : `--${k}`;
    });
    throw new CliError("unknown_option", `${toolName} does not take ${hints.join("; ")}`, {
      exitCode: 2,
      next: `npx -y heyyumi tools ${toolName}`,
    });
  }
  const out = { ...args };
  for (const [k, v] of Object.entries(out)) {
    if (props[k]?.type === "boolean" && typeof v === "string") out[k] = !["false", "0", "no", "off"].includes(v.toLowerCase());
  }
  return out;
}

async function validateArgs(toolName, args) {
  const schemas = await loadSchemas();
  if (!schemas || !schemas[toolName]) return args;
  return checkArgs(toolName, args, schemas[toolName]);
}

module.exports = { validateArgs, checkArgs, suggest };
