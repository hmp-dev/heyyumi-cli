"use strict";

const os = require("node:os");
const path = require("node:path");
const { version } = require("../package.json");

const ISSUER = (process.env.HEYYUMI_ISSUER || "https://heyyumi.ai").replace(/\/+$/, "");
const MCP_URL = process.env.HEYYUMI_MCP_URL || "https://mcp.heyyumi.ai/mcp";
const DEFAULT_CLIENT_NAME = "HeyYumi CLI";
const USER_AGENT = `heyyumi-cli/${version} (+https://github.com/hmp-dev/heyyumi-cli)`;

// Protected-resource id advertised by mcp.heyyumi.ai (RFC 9728).
function mcpResource() {
  return new URL(MCP_URL).origin;
}

function configDir() {
  if (process.env.HEYYUMI_CONFIG_DIR) return process.env.HEYYUMI_CONFIG_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "heyyumi");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "heyyumi");
}

function credentialsPath() {
  return path.join(configDir(), "credentials.json");
}

module.exports = {
  ISSUER,
  MCP_URL,
  DEFAULT_CLIENT_NAME,
  USER_AGENT,
  version,
  mcpResource,
  configDir,
  credentialsPath,
};
