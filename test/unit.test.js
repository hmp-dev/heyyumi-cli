"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { parseArgs, flagsToToolArgs } = require("../src/args");
const { normalizeReservationTime } = require("../src/time");
const { parseRpcBody, unwrapToolResult } = require("../src/mcp");
const { writeCredentials, readCredentials, withCredentialsLock } = require("../src/credentials");
const { checkArgs } = require("../src/schema");
const { pick, withReserveNext, commands } = require("../src/commands");

test("parseArgs keeps bare flags as true and never eats the next --flag", () => {
  const { positionals, flags } = parseArgs(["냉면", "--parking", "--region", "을지로", "--page-size=3", "--", "--literal"]);
  assert.deepEqual(positionals, ["냉면", "--literal"]);
  assert.deepEqual(flags, { parking: true, region: "을지로", "page-size": "3" });
});

test("flagsToToolArgs snake-cases, stringifies booleans, coerces numbers, drops CLI flags", () => {
  const args = flagsToToolArgs(
    { region: "성수", parking: true, "page-size": "5", "open-at": "dinner", pretty: true, timeout: "30" },
    { rename: { region: "region_name" } },
  );
  assert.deepEqual(args, { region_name: "성수", parking: "true", page_size: 5, open_at: "dinner" });
  assert.throws(() => flagsToToolArgs({ radius: "far" }, { rename: { radius: "radius_m" } }), /must be a number/);
  assert.deepEqual(flagsToToolArgs({ radius: "300" }, { rename: { radius: "radius_m" } }), { radius_m: 300 });
});

test("reservation time defaults to Korea time and rejects time-only input", () => {
  assert.equal(normalizeReservationTime("2026-10-25 19:00"), "2026-10-25T19:00:00+09:00");
  assert.equal(normalizeReservationTime("2026-10-25T19:30"), "2026-10-25T19:30:00+09:00");
  assert.equal(normalizeReservationTime("2026-10-25T10:00:00Z"), "2026-10-25T10:00:00Z");
  assert.equal(normalizeReservationTime("2026-10-25T19:00:00+09:00"), "2026-10-25T19:00:00+09:00");
  assert.throws(() => normalizeReservationTime("19:00"), /date and time/);
  assert.throws(() => normalizeReservationTime(undefined));
});

test("parseRpcBody reads SSE and plain JSON", () => {
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":1}}\n\n';
  assert.deepEqual(parseRpcBody(sse, "text/event-stream", 7).result, { ok: 1 });
  assert.deepEqual(parseRpcBody('{"jsonrpc":"2.0","id":1,"result":2}', "application/json", 1).result, 2);
});

test("unwrapToolResult parses JSON text, hides base64 images, flags errors", () => {
  const ok = unwrapToolResult({ content: [{ type: "text", text: '{"a":1}' }] });
  assert.deepEqual(ok, { ok: true, data: { a: 1 } });
  const img = unwrapToolResult({ content: [{ type: "text", text: "hi" }, { type: "image", mimeType: "image/jpeg", data: "AAAA" }] });
  assert.equal(img.data[1].data, undefined);
  assert.equal(img.data[1].mimeType, "image/jpeg");
  assert.equal(unwrapToolResult({ isError: true, content: [{ type: "text", text: '{"code":"x"}' }] }).ok, false);
});

test("pick reads flat and { data } payloads", () => {
  assert.equal(pick({ settled: true }, "settled"), true);
  assert.equal(pick({ success: true, data: { settled: false } }, "settled"), false);
  assert.equal(pick(null, "x"), undefined);
});

test("credentials are owner-only and the lock serialises concurrent refreshes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heyyumi-test-"));
  const file = path.join(dir, "sub", "credentials.json");
  try {
    writeCredentials({ refreshToken: "r1" }, file);
    assert.equal(readCredentials(file).refreshToken, "r1");
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);

    let inside = 0;
    let maxInside = 0;
    const work = () =>
      withCredentialsLock(
        async () => {
          inside++;
          maxInside = Math.max(maxInside, inside);
          await new Promise((r) => setTimeout(r, 30));
          inside--;
        },
        { file },
      );
    await Promise.all([work(), work(), work()]);
    assert.equal(maxInside, 1);
    assert.equal(fs.existsSync(`${file}.lock`), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown tool arguments are rejected with a suggestion, booleans are coerced", () => {
  const schema = { properties: { radius_m: { type: "integer" }, parking: { type: "string" }, include_empty: { type: "boolean" } } };
  assert.throws(
    () => checkArgs("nearby_places", { radius: 300 }, schema),
    (e) => e.code === "unknown_option" && e.exitCode === 2 && /--radius_m/.test(e.message),
  );
  assert.throws(() => checkArgs("nearby_places", { parkng: "true" }, schema), /--parking/);
  assert.deepEqual(checkArgs("x", { parking: "true", include_empty: "true" }, schema), { parking: "true", include_empty: true });
  assert.equal(checkArgs("x", { include_empty: "false" }, schema).include_empty, false);
  assert.deepEqual(checkArgs("x", { anything: 1 }, {}), { anything: 1 });
});

test("hand-built commands reject typo flags before any request", () => {
  const { checkOwnFlags } = require("../src/commands");
  assert.throws(() => checkOwnFlags("reserve", { time: "19:00", nme: "Kim" }), (e) => e.code === "unknown_option" && /--name/.test(e.message));
  assert.doesNotThrow(() => checkOwnFlags("reserve", { time: "19:00", party: "2", phone: "010", name: "Kim", pretty: true }));
  assert.doesNotThrow(() => checkOwnFlags("search", { anything: "x" }));
});

test("reserve points to wait now, or to a later check when the request is held overnight", () => {
  const now = withReserveNext({ success: true, data: { reservationId: "r1", status: "pending" } });
  assert.equal(now.cli.next, "npx -y heyyumi wait r1");
  assert.equal(now.cli.deferred, undefined);

  const held = withReserveNext({ success: true, data: { reservationId: "r2", status: "pending", reviewStartsAt: "2026-10-25T01:00:00.000Z" } });
  assert.equal(held.cli.deferred, true);
  assert.equal(held.cli.reviewStartsAt, "2026-10-25T01:00:00.000Z");
  assert.equal(held.cli.next, "npx -y heyyumi reservation r2");

  const settled = { success: true, data: { reservationId: "r3", settled: true } };
  assert.equal(withReserveNext(settled), settled);
});

test("guide rejects an unknown topic before calling the server", async () => {
  await assert.rejects(commands.guide({ positionals: ["menu"], flags: {} }), (e) => e.code === "usage" && /reserve/.test(e.message));
});
