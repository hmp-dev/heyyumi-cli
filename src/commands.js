"use strict";

const { flagsToToolArgs } = require("./args");
const { callTool, listTools, rpc } = require("./mcp");
const { login } = require("./oauth");
const { readCredentials, removeCredentials } = require("./credentials");
const { normalizeReservationTime } = require("./time");
const { credentialsPath, DEFAULT_CLIENT_NAME, MCP_URL, version } = require("./config");
const { CliError, usageError } = require("./errors");
const { validateArgs, suggest } = require("./schema");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each venue is ~1 KB of JSON; 10 keeps an agent's context small. --page-size overrides.
const DEFAULT_PAGE_SIZE = 10;

// Tool payloads come back as { success, data: {...} } from the REST API, or flat.
function pick(obj, key) {
  if (!obj || typeof obj !== "object") return undefined;
  if (obj[key] !== undefined) return obj[key];
  if (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)) return obj.data[key];
  return undefined;
}

// A held request is only reviewed from reviewStartsAt, so waiting now would just time out.
function withReserveNext(data) {
  const id = pick(data, "reservationId") ?? pick(data, "id");
  if (!id || !data || typeof data !== "object" || Array.isArray(data) || pick(data, "settled") === true) return data;
  const reviewStartsAt = pick(data, "reviewStartsAt");
  if (typeof reviewStartsAt === "string") {
    return {
      ...data,
      cli: {
        deferred: true,
        reviewStartsAt,
        next: `npx -y heyyumi reservation ${id}`,
        note: "The request is held for later. Pass on yumiNextStep and don't wait now.",
      },
    };
  }
  return { ...data, cli: { next: `npx -y heyyumi wait ${id}` } };
}

function requirePositional(positionals, name, example) {
  const v = positionals[0];
  if (!v) throw usageError(`Missing ${name}. Example: ${example}`);
  return v;
}

// Surface the server's own error code (e.g. reservation_time_past) so the agent can act on it.
function toolError(name, data) {
  const code = typeof data?.code === "string" ? data.code : "tool_error";
  const message = typeof data?.message === "string" ? data.message : typeof data === "string" ? data : `${name} failed`;
  return new CliError(code, message, { details: data });
}

async function tool(name, args) {
  const out = await callTool(name, await validateArgs(name, args));
  if (!out.ok) throw toolError(name, out.data);
  return out.data;
}

/** Re-call a ~25s long-poll tool until settled or the time budget runs out. */
async function pollUntilSettled(toolName, args, { timeoutSec, nextCommand }) {
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    const data = await tool(toolName, args);
    if (pick(data, "settled") === true) return data;
    if (Date.now() + 5000 > deadline) {
      return { ...data, cli: { settled: false, next: nextCommand, note: "Still waiting for the venue. Run the next command to keep waiting." } };
    }
    await sleep(1000);
  }
}

function timeoutFlag(flags, fallback) {
  if (flags.timeout === undefined) return fallback;
  const n = Number(flags.timeout);
  if (!Number.isFinite(n) || n <= 0) throw usageError("--timeout must be seconds, e.g. --timeout 110");
  return n;
}

// The server's rules name MCP tools; agents run these CLI commands instead.
const CLI_FOR_TOOL = {
  search_places: "npx -y heyyumi search",
  nearby_places: "npx -y heyyumi nearby",
  get_place: "npx -y heyyumi place",
  show_place_photos: "npx -y heyyumi photos",
  resolve_regions: "npx -y heyyumi regions",
  request_reservation: "npx -y heyyumi reserve",
  wait_for_reservation: "npx -y heyyumi wait",
  get_reservation: "npx -y heyyumi reservation",
  request_live_status: "npx -y heyyumi live",
  wait_for_live_status: "npx -y heyyumi live-wait",
};
const GUIDE_TOPICS = { search: "search_places", place: "get_place", reserve: "request_reservation", live: "request_live_status" };

// Commands that build tool arguments by hand. Anything else they get is a typo, and a dropped
// `--nme` would book under no name, so reject it. Commands not listed forward flags to the tool,
// where validateArgs checks them against the live schema.
const OWN_FLAGS = {
  login: ["client-name", "no-browser", "timeout", "force"],
  logout: [],
  status: [],
  photos: [],
  categories: [],
  stats: [],
  reserve: ["time", "party", "phone", "name", "email", "note", "lang", "idempotency-key"],
  reservation: [],
  wait: ["timeout"],
  live: ["kind", "topic", "question"],
  "live-wait": ["timeout"],
  tools: [],
  guide: [],
  version: [],
};
const OUTPUT_FLAGS = ["pretty", "compact", "help"];

function checkOwnFlags(command, flags) {
  const allowed = OWN_FLAGS[command];
  if (!allowed) return;
  const unknown = Object.keys(flags).filter((k) => !allowed.includes(k) && !OUTPUT_FLAGS.includes(k));
  if (!unknown.length) return;
  const hints = unknown.map((k) => {
    const s = suggest(k, allowed);
    return s.length ? `--${k} (did you mean ${s.map((x) => `--${x}`).join(", ")}?)` : `--${k}`;
  });
  throw new CliError("unknown_option", `${command} does not take ${hints.join("; ")}`, { exitCode: 2, next: "npx -y heyyumi help" });
}

const commands = {
  async login({ flags }) {
    const existing = readCredentials();
    if (existing?.refreshToken && !flags.force && !process.env.HEYYUMI_API_KEY) {
      return { ok: true, alreadySignedIn: true, clientName: existing.clientName, note: "Already signed in. Use --force to sign in again." };
    }
    const clientName = typeof flags["client-name"] === "string" ? flags["client-name"] : process.env.HEYYUMI_CLIENT_NAME || DEFAULT_CLIENT_NAME;
    const creds = await login({
      clientName,
      noBrowser: flags["no-browser"] === true,
      timeoutMs: timeoutFlag(flags, 300) * 1000,
    });
    return { ok: true, signedIn: true, clientName: creds.clientName, credentials: credentialsPath() };
  },

  async logout() {
    const removed = removeCredentials();
    return {
      ok: true,
      signedOut: removed,
      note: "Local sign-in removed. The connection's key can also be revoked at https://heyyumi.ai/dashboard.",
    };
  },

  async status() {
    if (process.env.HEYYUMI_API_KEY) return { ok: true, signedIn: true, mode: "api_key", mcpUrl: MCP_URL };
    const c = readCredentials();
    if (!c?.refreshToken) return { ok: true, signedIn: false, next: "npx -y heyyumi login" };
    return {
      ok: true,
      signedIn: true,
      mode: "oauth",
      clientName: c.clientName,
      accessTokenExpiresAt: new Date(c.expiresAt).toISOString(),
      credentials: credentialsPath(),
      mcpUrl: c.mcpUrl,
    };
  },

  async search({ positionals, flags }) {
    const args = flagsToToolArgs(flags, { rename: { region: "region_name" } });
    if (positionals.length && args.keyword === undefined) args.keyword = positionals.join(" ");
    args.page_size ??= DEFAULT_PAGE_SIZE;
    return tool("search_places", args);
  },

  async nearby({ flags }) {
    const args = flagsToToolArgs(flags, { rename: { radius: "radius_m" } });
    if (args.lat === undefined || args.lng === undefined) throw usageError("nearby needs --lat and --lng. Example: heyyumi nearby --lat 37.5665 --lng 126.978 --radius 800");
    args.page_size ??= DEFAULT_PAGE_SIZE;
    return tool("nearby_places", args);
  },

  async place({ positionals, flags }) {
    const id = requirePositional(positionals, "place id", "heyyumi place 21853004");
    return tool("get_place", { id, ...flagsToToolArgs(flags) });
  },

  // Photo URLs via get_place; the photo tool returns base64 thumbnails, which do not belong in a terminal.
  async photos({ positionals }) {
    const id = requirePositional(positionals, "place id", "heyyumi photos 21853004");
    return tool("get_place", { id, fields: "photos" });
  },

  async regions({ positionals, flags }) {
    const args = flagsToToolArgs(flags);
    if (positionals.length && !args.dong && !args.sigungu && !args.sido) args.dong = positionals.join(" ");
    return tool("resolve_regions", args);
  },

  async categories() {
    return tool("list_categories", {});
  },

  async stats() {
    return tool("get_stats", {});
  },

  async reserve({ positionals, flags }) {
    const placeId = requirePositional(positionals, "place id", 'heyyumi reserve 21853004 --time "2026-10-25 19:00" --party 2 --name "Kim" --phone 010-1234-5678');
    let reservationTime;
    try {
      reservationTime = normalizeReservationTime(flags.time);
    } catch (e) {
      throw usageError(e.message);
    }
    const guestCount = Number(flags.party);
    if (!Number.isInteger(guestCount) || guestCount < 1) throw usageError("--party must be a whole number of guests, e.g. --party 2");
    if (typeof flags.phone !== "string") throw usageError("--phone is required (the guest's mobile, e.g. 010-1234-5678 or +1 415 555 0100)");

    const args = { placeId, reservationTime, guestCount, guestPhone: flags.phone };
    const optional = { name: "guestName", email: "guestEmail", note: "note", lang: "guestLanguage", "idempotency-key": "idempotencyKey" };
    for (const [flag, key] of Object.entries(optional)) {
      if (typeof flags[flag] === "string") args[key] = flags[flag];
    }
    return withReserveNext(await tool("request_reservation", args));
  },

  async reservation({ positionals }) {
    const reservationId = requirePositional(positionals, "reservation id", "heyyumi reservation <reservationId>");
    return tool("get_reservation", { reservationId });
  },

  async wait({ positionals, flags }) {
    const reservationId = requirePositional(positionals, "reservation id", "heyyumi wait <reservationId>");
    return pollUntilSettled("wait_for_reservation", { reservationId }, {
      timeoutSec: timeoutFlag(flags, 110),
      nextCommand: `npx -y heyyumi wait ${reservationId}`,
    });
  },

  async live({ positionals, flags }) {
    const placeId = requirePositional(positionals, "place id", 'heyyumi live 21853004 --kind wait --topic "웨이팅"');
    if (!["item", "wait", "seats"].includes(flags.kind)) throw usageError("--kind must be item, wait, or seats");
    if (typeof flags.topic !== "string") throw usageError('--topic is required, e.g. --topic "두바이 쫀득 쿠키"');
    const args = { placeId, kind: flags.kind, topic: flags.topic };
    if (typeof flags.question === "string") args.question = flags.question;
    const data = await tool("request_live_status", args);
    const queryId = pick(data, "queryId");
    if (queryId && pick(data, "settled") !== true && !pick(data, "blocked")) {
      return { ...data, cli: { next: `npx -y heyyumi live-wait ${queryId}` } };
    }
    return data;
  },

  async "live-wait"({ positionals, flags }) {
    const queryId = requirePositional(positionals, "query id", "heyyumi live-wait <queryId>");
    return pollUntilSettled("wait_for_live_status", { queryId }, {
      timeoutSec: timeoutFlag(flags, 110),
      nextCommand: `npx -y heyyumi live-wait ${queryId}`,
    });
  },

  async tools({ positionals }) {
    const all = await listTools();
    if (positionals[0]) {
      const t = all.find((x) => x.name === positionals[0]);
      if (!t) throw usageError(`Unknown tool "${positionals[0]}". Run: heyyumi tools`);
      return t;
    }
    return all.map((t) => ({ name: t.name, title: t.title || t.annotations?.title, required: t.inputSchema?.required || [] }));
  },

  async call({ positionals, flags }) {
    const name = requirePositional(positionals, "tool name", "heyyumi call search_places --json '{\"region_name\":\"성수\"}'");
    let args = {};
    if (typeof flags.json === "string") {
      try {
        args = JSON.parse(flags.json);
      } catch {
        throw usageError("--json must be a JSON object");
      }
    }
    Object.assign(args, flagsToToolArgs(flags));
    return tool(name, args);
  },

  async guide({ positionals }) {
    const topic = positionals[0];
    if (topic !== undefined) {
      const toolName = GUIDE_TOPICS[topic];
      if (!toolName) throw usageError(`Unknown guide topic "${topic}". Topics: ${Object.keys(GUIDE_TOPICS).join(", ")}`);
      const t = (await listTools()).find((x) => x.name === toolName);
      if (!t) throw new CliError("tool_not_found", `The server has no ${toolName} tool right now.`);
      return { ok: true, topic, command: CLI_FOR_TOOL[toolName], rules: t.description };
    }
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "heyyumi-cli", version },
    });
    return {
      ok: true,
      instructions: init?.instructions || "",
      commands: CLI_FOR_TOOL,
      topics: Object.fromEntries(Object.keys(GUIDE_TOPICS).map((k) => [k, `npx -y heyyumi guide ${k}`])),
      note: "These rules come from the HeyYumi server and stay current. They name MCP tools; run the matching command from `commands` (reserve takes --time --party --phone --name --email --note --lang). Read `guide reserve` before sending a table request and `guide live` before asking a venue.",
    };
  },

  async version() {
    return { ok: true, version };
  },
};

const HELP = `heyyumi ${version} — Korean restaurant search & table requests for AI agents (HeyYumi)

Sign in (once per machine; opens Google sign-in, finishes on its own):
  heyyumi login [--no-browser] [--client-name NAME] [--timeout 300] [--force]
  heyyumi status | logout

Rules for agents (from the server, always current):
  heyyumi guide                                   read once per task
  heyyumi guide search|place|reserve|live         rules for one step

Search & details:
  heyyumi search [KEYWORD] --region 을지로 [--subtype korean_bbq] [--open_at "2026-10-25 19:00"] [--parking] ...
      Any search_places filter works as a flag (see: heyyumi tools search_places). 10 results unless --page-size.
      --region takes Korean or romanized names, stations and landmarks (Hongdae, 강남역, 제주공항).
  heyyumi nearby --lat 37.5665 --lng 126.978 [--radius 800] [--sort discovery]
  heyyumi place PLACE_ID [--fields all]
  heyyumi photos PLACE_ID
  heyyumi regions NAME | categories | stats

Table requests (read "heyyumi guide reserve" first; ask the user before sending):
  heyyumi reserve PLACE_ID --time "2026-10-25 19:00" --party 2 --phone 010-1234-5678 [--name NAME]
                  [--email EMAIL (required for non-Korean phones)] [--note TEXT] [--lang en]
  heyyumi wait RESERVATION_ID [--timeout 110]     waits until confirmed / cancelled / expired (venue has 5 min)
  heyyumi reservation RESERVATION_ID              one status check

Ask the venue right now (stock / wait time / seats):
  heyyumi live PLACE_ID --kind item|wait|seats --topic "웨이팅" [--question TEXT]
  heyyumi live-wait QUERY_ID [--timeout 110]

Raw MCP access:
  heyyumi tools [TOOL]                            list tools / show one tool's full schema
  heyyumi call TOOL [--json '{...}'] [--flag value]

Output is JSON on stdout (compact when piped, --pretty to indent); progress goes to stderr.
Exit codes: 0 ok · 1 server/tool error · 2 usage · 3 not signed in (run: npx -y heyyumi login)
HEYYUMI_API_KEY=hmp_... skips sign-in and uses a dashboard key instead.
`;

module.exports = { commands, HELP, pick, checkOwnFlags, withReserveNext };
