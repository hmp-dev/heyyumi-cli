"use strict";

// Exit codes: 1 = the server answered with an error, 2 = bad usage, 3 = not signed in.
class CliError extends Error {
  constructor(code, message, { exitCode = 1, next, details } = {}) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.next = next;
    this.details = details;
  }

  toJSON() {
    const error = { code: this.code, message: this.message };
    if (this.next) error.next = this.next;
    if (this.details !== undefined) error.details = this.details;
    return { ok: false, error };
  }
}

function usageError(message) {
  return new CliError("usage", message, { exitCode: 2, next: "npx -y heyyumi help" });
}

function loginRequired(message = "Not signed in to HeyYumi.") {
  return new CliError("login_required", message, { exitCode: 3, next: "npx -y heyyumi login" });
}

module.exports = { CliError, usageError, loginRequired };
