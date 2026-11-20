"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { configDir } = require("./config");
const { CliError } = require("./errors");

const BIN = path.join(__dirname, "..", "bin", "heyyumi.js");
const AUTH_URL = /^https?:\/\/\S+\/oauth\/authorize\?\S+$/m;

function readLog(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function lastJson(text) {
  const line = text.trim().split("\n").reverse().find((l) => l.startsWith("{"));
  try {
    return line ? JSON.parse(line) : null;
  } catch {
    return null;
  }
}

/**
 * `login --detach`: print the sign-in link and return at once, while a child in its own session keeps the
 * loopback callback open and saves the sign-in. Agent shells kill whatever a command left running when it
 * returns (`&` and `nohup` included), so a plain background login dies before the person opens the link.
 */
async function detachedLogin({ clientName, timeoutSec, force = false, waitMs = 25000 }) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const logFile = path.join(dir, "login.log");
  const fd = fs.openSync(logFile, "w", 0o600);
  const args = [BIN, "login", "--no-browser", "--timeout", String(timeoutSec), "--client-name", clientName];
  if (force) args.push("--force");
  const child = spawn(process.execPath, args, { detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
  fs.closeSync(fd);
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  child.unref();

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    const text = readLog(logFile);
    const url = text.match(AUTH_URL)?.[0];
    if (url) {
      return {
        ok: true,
        pending: true,
        url,
        expiresInSec: timeoutSec,
        next: "Give the url to the person. It must be opened on this computer. Once they say they signed in, run: npx -y heyyumi status",
      };
    }
    if (exited) break;
  }

  const out = lastJson(readLog(logFile));
  if (out?.ok) return out;
  const err = out?.error;
  if (!exited) {
    try {
      process.kill(child.pid);
    } catch {
      // Already gone.
    }
  }
  throw new CliError(err?.code || "login_start_failed", err?.message || "Could not start the sign-in. Try again.", {
    exitCode: err?.code ? 3 : 1,
    next: "npx -y heyyumi login --detach",
  });
}

module.exports = { detachedLogin };
