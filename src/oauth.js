"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { ISSUER, MCP_URL, DEFAULT_CLIENT_NAME, USER_AGENT, mcpResource } = require("./config");
const { readCredentials, writeCredentials, withCredentialsLock } = require("./credentials");
const { CliError, loginRequired } = require("./errors");

const REFRESH_SKEW_MS = 60 * 1000;

const base64url = (buf) => Buffer.from(buf).toString("base64url");

function createPkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function registerClient({ redirectUri, clientName, issuer = ISSUER }) {
  const { res, json } = await postJson(`${issuer}/oauth/register`, {
    client_name: clientName,
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
  if (!res.ok || !json.client_id) {
    throw new CliError("oauth_register_failed", json.error_description || `Client registration failed (HTTP ${res.status})`);
  }
  return json.client_id;
}

function credsFromTokenResponse(json, { clientId, clientName, issuer = ISSUER, mcpUrl = MCP_URL }) {
  return {
    version: 1,
    issuer,
    mcpUrl,
    clientId,
    clientName,
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000,
    scope: json.scope || "read",
    updatedAt: new Date().toISOString(),
  };
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The URL is printed too, so the user can open it by hand.
  }
}

const PAGE = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
  `<body style="font-family:system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 24px;line-height:1.6">` +
  `<h1 style="font-size:22px">${title}</h1><p>${body}</p></body></html>`;

/**
 * Loopback OAuth (RFC 8252) + PKCE against heyyumi.ai. The portal issues a key dedicated to this
 * connection, so each user is metered on their own account. Finishes on its own when the browser
 * returns, so an agent can run it without anyone pressing Enter.
 */
async function login({
  clientName = DEFAULT_CLIENT_NAME,
  noBrowser = false,
  timeoutMs = 5 * 60 * 1000,
  log = (m) => process.stderr.write(`${m}\n`),
  issuer = ISSUER,
  browser = openBrowser,
} = {}) {
  const state = base64url(crypto.randomBytes(16));
  const { verifier, challenge } = createPkce();

  let settle;
  const callback = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  callback.catch(() => {});

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const send = (status, title, body) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE(title, body));
    };
    if (url.searchParams.get("state") !== state) {
      send(400, "Sign-in failed", "This sign-in link is stale. Run <code>npx -y heyyumi login</code> again.");
      return;
    }
    const error = url.searchParams.get("error");
    if (error) {
      send(400, "Sign-in cancelled", "You can close this tab. 이 탭을 닫으셔도 돼요.");
      settle.reject(new CliError("oauth_denied", url.searchParams.get("error_description") || error, { exitCode: 3 }));
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      send(400, "Sign-in failed", "No authorization code was returned.");
      return;
    }
    send(200, "HeyYumi is connected", "You can close this tab and go back to your AI. 이 탭을 닫고 AI로 돌아가세요.");
    settle.resolve(code);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;

  const timer = setTimeout(() => {
    settle.reject(
      new CliError("login_timeout", `No sign-in within ${Math.round(timeoutMs / 1000)}s.`, {
        exitCode: 3,
        next: "npx -y heyyumi login",
      }),
    );
  }, timeoutMs);

  try {
    const clientId = await registerClient({ redirectUri, clientName, issuer });
    const authUrl = new URL(`${issuer}/oauth/authorize`);
    authUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "read",
      state,
      resource: mcpResource(),
    }).toString();

    log("Sign in to HeyYumi with Google in your browser. If it did not open, visit:");
    log(authUrl.toString());
    if (!noBrowser) browser(authUrl.toString());

    const code = await callback;
    const { res, json } = await postForm(`${issuer}/oauth/token`, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });
    if (!res.ok || !json.access_token) {
      throw new CliError("oauth_token_failed", json.error_description || `Token exchange failed (HTTP ${res.status})`, {
        exitCode: 3,
      });
    }
    const creds = credsFromTokenResponse(json, { clientId, clientName, issuer });
    writeCredentials(creds);
    return creds;
  } finally {
    clearTimeout(timer);
    server.close();
    // Browsers keep the callback connection alive, which would hold the process open.
    server.closeAllConnections?.();
  }
}

async function refreshCredentials(creds) {
  const { res, json } = await postForm(`${creds.issuer || ISSUER}/oauth/token`, {
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
    client_id: creds.clientId,
  });
  if (res.status === 400 || res.status === 401) return null;
  if (!res.ok || !json.access_token) {
    throw new CliError("oauth_refresh_failed", json.error_description || `Token refresh failed (HTTP ${res.status})`);
  }
  return credsFromTokenResponse(json, {
    clientId: creds.clientId,
    clientName: creds.clientName,
    issuer: creds.issuer,
    mcpUrl: creds.mcpUrl,
  });
}

/**
 * Bearer token for mcp.heyyumi.ai. HEYYUMI_API_KEY (an hmp_ key from the dashboard) wins when set.
 * `staleToken` = the token the server just rejected; refresh unless another process already did.
 */
async function getAccessToken({ staleToken } = {}) {
  const envKey = process.env.HEYYUMI_API_KEY;
  if (envKey) return { token: envKey.trim(), mode: "api_key" };

  const current = readCredentials();
  if (!current?.refreshToken) throw loginRequired();
  const fresh = (c) => c.accessToken && c.expiresAt - REFRESH_SKEW_MS > Date.now();
  if (!staleToken && fresh(current)) return { token: current.accessToken, mode: "oauth" };

  return withCredentialsLock(async () => {
    const latest = readCredentials();
    if (!latest?.refreshToken) throw loginRequired();
    if (latest.accessToken !== staleToken && fresh(latest)) return { token: latest.accessToken, mode: "oauth" };
    const next = await refreshCredentials(latest);
    if (!next) throw loginRequired("Your HeyYumi sign-in expired or was revoked. Sign in again.");
    writeCredentials(next);
    return { token: next.accessToken, mode: "oauth" };
  });
}

module.exports = { login, getAccessToken, refreshCredentials, registerClient, createPkce, openBrowser };
