"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "heyyumi-oauth-"));
process.env.HEYYUMI_CONFIG_DIR = configDir;
delete process.env.HEYYUMI_API_KEY;

const { login, getAccessToken } = require("../src/oauth");
const { readCredentials, writeCredentials } = require("../src/credentials");

/** Minimal stand-in for heyyumi.ai's OAuth endpoints, with PKCE and refresh rotation. */
function fakeIssuer() {
  const state = { challenge: null, redirectUri: null, refresh: "r1", refreshCalls: 0, authorizeParams: null };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let body = "";
    for await (const chunk of req) body += chunk;
    const json = (status, obj) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(obj));

    if (url.pathname === "/oauth/register") {
      const reg = JSON.parse(body);
      state.redirectUri = reg.redirect_uris[0];
      return json(201, { client_id: "client-1", client_name: reg.client_name });
    }
    if (url.pathname === "/oauth/authorize") {
      state.authorizeParams = Object.fromEntries(url.searchParams);
      state.challenge = url.searchParams.get("code_challenge");
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", "code-1");
      back.searchParams.set("state", url.searchParams.get("state"));
      return res.writeHead(302, { Location: back.toString() }).end();
    }
    if (url.pathname === "/oauth/token") {
      const p = new URLSearchParams(body);
      if (p.get("grant_type") === "authorization_code") {
        const expected = crypto.createHash("sha256").update(p.get("code_verifier")).digest("base64url");
        if (expected !== state.challenge || p.get("redirect_uri") !== state.redirectUri) return json(400, { error: "invalid_grant" });
        return json(200, { access_token: "a1", refresh_token: "r1", expires_in: 3600, scope: "read" });
      }
      if (p.get("grant_type") === "refresh_token") {
        state.refreshCalls++;
        if (p.get("refresh_token") !== state.refresh) return json(400, { error: "invalid_grant" });
        state.refresh = `r${state.refreshCalls + 1}`;
        await new Promise((r) => setTimeout(r, 50));
        return json(200, { access_token: `a${state.refreshCalls + 1}`, refresh_token: state.refresh, expires_in: 3600 });
      }
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, state, issuer: `http://127.0.0.1:${server.address().port}` })),
  );
}

test.after(() => fs.rmSync(configDir, { recursive: true, force: true }));

test("login completes through the loopback redirect with PKCE and saves credentials", async () => {
  const { server, state, issuer } = await fakeIssuer();
  try {
    const creds = await login({
      issuer,
      clientName: "My Agent",
      log: () => {},
      browser: (u) => fetch(u).catch(() => {}),
    });
    assert.equal(creds.accessToken, "a1");
    assert.equal(state.authorizeParams.code_challenge_method, "S256");
    assert.equal(state.authorizeParams.scope, "read");
    assert.match(state.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const saved = readCredentials();
    assert.equal(saved.refreshToken, "r1");
    assert.equal(saved.clientName, "My Agent");
  } finally {
    server.close();
  }
});

test("concurrent commands with an expired token refresh exactly once", async () => {
  const { server, state, issuer } = await fakeIssuer();
  try {
    writeCredentials({ issuer, clientId: "client-1", accessToken: "old", refreshToken: "r1", expiresAt: Date.now() - 1000 });
    const results = await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]);
    assert.equal(state.refreshCalls, 1);
    assert.deepEqual(new Set(results.map((r) => r.token)), new Set(["a2"]));
    assert.equal(readCredentials().refreshToken, "r2");
  } finally {
    server.close();
  }
});

test("a revoked refresh token asks the user to sign in again", async () => {
  const { server, issuer } = await fakeIssuer();
  try {
    writeCredentials({ issuer, clientId: "client-1", accessToken: "old", refreshToken: "revoked", expiresAt: 0 });
    await assert.rejects(getAccessToken(), (e) => e.code === "login_required" && e.exitCode === 3);
  } finally {
    server.close();
  }
});
