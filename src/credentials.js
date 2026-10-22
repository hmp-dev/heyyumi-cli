"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { credentialsPath } = require("./config");

function readCredentials(file = credentialsPath()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// Owner-only file; written to a temp file then renamed so a crash never leaves half a token.
function writeCredentials(creds, file = credentialsPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows ignores POSIX modes.
  }
}

function removeCredentials(file = credentialsPath()) {
  try {
    fs.unlinkSync(file);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Cross-process lock around refresh. The server rotates refresh tokens (the old one is revoked),
 * so two agent commands refreshing at once would sign the user out without this.
 */
async function withCredentialsLock(fn, { file = credentialsPath(), timeoutMs = 15000, staleMs = 30000 } = {}) {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  let fd;
  while (fd === undefined) {
    try {
      fd = fs.openSync(lock, "wx", 0o600);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > staleMs) fs.unlinkSync(lock);
      } catch {
        // Lock vanished between checks; retry.
      }
      if (Date.now() > deadline) throw new Error("Timed out waiting for the HeyYumi credentials lock");
      await sleep(100);
    }
  }
  try {
    return await fn();
  } finally {
    fs.closeSync(fd);
    try {
      fs.unlinkSync(lock);
    } catch {
      // Already removed as stale by another process.
    }
  }
}

module.exports = { readCredentials, writeCredentials, removeCredentials, withCredentialsLock };
