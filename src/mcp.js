"use strict";

const { MCP_URL, USER_AGENT } = require("./config");
const { readCredentials } = require("./credentials");
const { getAccessToken } = require("./oauth");
const { CliError, loginRequired } = require("./errors");

let rpcId = 0;

/** Streamable HTTP answers either plain JSON or one SSE event per JSON-RPC message. */
function parseRpcBody(text, contentType, id) {
  if (!/text\/event-stream/i.test(contentType || "")) return JSON.parse(text);
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    const msg = JSON.parse(data);
    if (msg.id === id || msg.id === undefined) return msg;
  }
  throw new Error("Empty response from the HeyYumi MCP server");
}

function mcpUrl() {
  return process.env.HEYYUMI_MCP_URL || readCredentials()?.mcpUrl || MCP_URL;
}

async function rpcOnce(method, params, token) {
  const id = ++rpcId;
  const res = await fetch(mcpUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    // wait_for_* tools hold the request ~25s on the server.
    signal: AbortSignal.timeout(90000),
  });
  if (res.status === 401) return { unauthorized: true };
  const text = await res.text();
  if (!res.ok) throw new CliError("http_error", `HeyYumi MCP server returned HTTP ${res.status}`, { details: text.slice(0, 500) });
  const msg = parseRpcBody(text, res.headers.get("content-type"), id);
  if (msg.error) throw new CliError("rpc_error", msg.error.message || "MCP error", { details: msg.error });
  return { result: msg.result };
}

async function rpc(method, params) {
  let auth = await getAccessToken();
  let out = await rpcOnce(method, params, auth.token);
  if (out.unauthorized && auth.mode === "oauth") {
    auth = await getAccessToken({ staleToken: auth.token });
    out = await rpcOnce(method, params, auth.token);
  }
  if (out.unauthorized) {
    if (auth.mode === "api_key") {
      throw new CliError("invalid_api_key", "HEYYUMI_API_KEY was rejected. Check the key or unset it to use `heyyumi login`.", {
        exitCode: 3,
      });
    }
    throw loginRequired("Your HeyYumi sign-in was rejected. Sign in again.");
  }
  return out.result;
}

/**
 * Unwrap a tool result: JSON text blocks are parsed, image blocks are summarised (base64 would
 * flood the agent's context). `isError` results become { ok:false } so callers can exit non-zero.
 */
function unwrapToolResult(result) {
  const parts = (result?.content || []).map((c) => {
    if (c.type === "text") {
      try {
        return JSON.parse(c.text);
      } catch {
        return c.text;
      }
    }
    if (c.type === "image") return { type: "image", mimeType: c.mimeType, omitted: "base64 image omitted in CLI output" };
    return c;
  });
  const data = parts.length === 1 ? parts[0] : parts;
  if (result?.isError) return { ok: false, data };
  return { ok: true, data };
}

async function callTool(name, args) {
  return unwrapToolResult(await rpc("tools/call", { name, arguments: args }));
}

async function listTools() {
  const result = await rpc("tools/list", {});
  return result.tools || [];
}

module.exports = { callTool, listTools, rpc, parseRpcBody, unwrapToolResult };
