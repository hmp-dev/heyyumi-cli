# heyyumi

[![npm](https://img.shields.io/npm/v/heyyumi)](https://www.npmjs.com/package/heyyumi)

Your AI finds and books real Korean restaurants, no Korean needed.

`heyyumi` is the command-line client for [HeyYumi](https://heyyumi.ai): verified data on 540,000+ restaurants, cafes, bakeries and bars across Korea, plus table requests that the venue answers within 5 minutes. It is built for AI agents (Claude Code, Codex, Cursor, k-skill …) that run shell commands and read JSON.

```bash
npx -y heyyumi login                                   # once: Google sign-in in the browser, then done
npx -y heyyumi search 냉면 --region 을지로 --page-size 5
npx -y heyyumi place 2069798395
npx -y heyyumi reserve 2069798395 --time "2026-10-25 19:00" --party 2 --phone 010-1234-5678 --name "Kim"
npx -y heyyumi wait sbx_r_...                          # confirmed / cancelled / expired
```

Requires Node.js 18+. No other dependencies.

## Sign in once

`heyyumi login` opens HeyYumi's Google sign-in and waits on a local callback (`http://127.0.0.1:<random port>/callback`). When the user approves, the CLI finishes by itself. Nobody has to press Enter, so an agent can run it directly.

- Each sign-in gets its own HeyYumi key on the user's account, so usage is metered per user.
- Credentials are saved to `~/.config/heyyumi/credentials.json` (mode 0600; `%APPDATA%\heyyumi` on Windows). Access tokens refresh on their own; refresh is locked across processes so parallel agent commands never sign the user out.
- `heyyumi status` shows whether you are signed in (never prints tokens). `heyyumi logout` removes local credentials. Keys can be revoked any time at <https://heyyumi.ai/dashboard>.
- `--no-browser` prints the URL instead of opening it. `--client-name NAME` labels the connection (it shows up as the source of reservation requests, e.g. `--client-name k-skill`).
- Already have a dashboard key? Set `HEYYUMI_API_KEY=hmp_...` and skip `login`.

## Commands

| Command | What it does |
|---|---|
| `search [KEYWORD] --region NAME [filters]` | Shortlist venues. `--region` takes Korean or romanized names, stations and landmarks (`Hongdae`, `강남역`, `제주공항`). Every `search_places` filter works as a flag: `--subtype korean_bbq`, `--open_at dinner`, `--parking`, `--reservation_channel yumi`, `--dietary vegan_options` … (see `heyyumi tools search_places`). Returns 10 venues unless `--page-size` is given. |
| `nearby --lat --lng [--radius] [--sort distance\|discovery]` | Venues around a point. |
| `place ID [--fields all]` | Full details for one venue. |
| `photos ID` | The owner's photo URLs. |
| `regions NAME` · `categories` · `stats` | Region lookup, category list, coverage numbers. |
| `reserve ID --time --party --phone [--name --email --note --lang]` | Send a table request. Times without an offset are Korea time. `--email` is required for non-Korean phone numbers. |
| `wait RESERVATION_ID [--timeout 110]` | Wait for the venue's answer (they have 5 minutes). Re-run if `cli.settled` is false. |
| `reservation RESERVATION_ID` | Check a request once. |
| `live ID --kind item\|wait\|seats --topic TEXT` · `live-wait QUERY_ID` | Ask the venue right now (stock, wait time, seats). |
| `tools [TOOL]` · `call TOOL --json '{...}'` | Raw access to every HeyYumi MCP tool. |

Flags may use dashes or underscores (`--page-size` = `--page_size`). Bare flags mean `true`.

## Output contract

- stdout is always one JSON document: compact when piped, indented on a terminal or with `--pretty`. Progress and the sign-in URL go to stderr.
- Errors: `{"ok": false, "error": {"code", "message", "next"?, "details"?}}`. Server codes are passed through (`reservation_time_past`, `reservation_requests_closed`, …).
- Exit codes: `0` ok · `1` server/tool error · `2` bad usage · `3` not signed in (run `npx -y heyyumi login`).
- Unknown flags fail with `unknown_option` and a "did you mean" hint instead of being dropped, so a typo never turns into a silently wider search or a nameless booking. Search flags are checked against the live tool schema (cached for an hour).
- When a follow-up command is needed, the output carries `cli.next`, e.g. `npx -y heyyumi wait <id>`.

## Rules for agents

- Only send `reserve` for venues whose result shows `yumiBooking.canRequest: true`. Confirm time, party size, name and phone with the user before sending; it reaches a real venue.
- A request starts as `pending`. Say it is booked only after `wait` returns `status: "confirmed"`. `cancelled` means the venue declined (relay `declineReason` if present); `expired` means no answer in time.
- `open_at` means the venue is open at that time, not that a table is free. Only a reservation answer says that.
- There are no star ratings (`rating` is always null). Do not invent one, and do not attribute review counts to any map platform.
- Link venue names to their `placeUrl`.

## For k-skill

A k-skill skill can call this CLI the same way `bunjang-search` calls `bunjang-cli`:

```bash
npx -y heyyumi login --client-name k-skill   # returns at once if already signed in
npx -y heyyumi search "<dish or venue>" --region "<area>" --page-size 5
```

Suggested profile: `action:booking` (reservations are irreversible and need the user's approval first). A ready-to-copy skill is in [`integrations/k-skill/heyyumi-restaurant`](integrations/k-skill/heyyumi-restaurant).

## Environment

| Variable | Default |
|---|---|
| `HEYYUMI_API_KEY` | unset (use `login`) |
| `HEYYUMI_CONFIG_DIR` | `~/.config/heyyumi` |
| `HEYYUMI_CLIENT_NAME` | `HeyYumi CLI` |
| `HEYYUMI_MCP_URL` | `https://mcp.heyyumi.ai/mcp` |
| `HEYYUMI_ISSUER` | `https://heyyumi.ai` |

---

## 한국어 요약

AI 에이전트가 터미널 명령 하나로 한국 맛집을 찾고 예약 요청까지 보낼 수 있게 해 주는 CLI입니다. `npx -y heyyumi login`을 한 번 실행하면 브라우저에 구글 로그인 창이 뜨고, 승인하면 그 사용자 전용 키가 만들어져 바로 쓸 수 있습니다. 이후 명령은 모두 JSON으로 답합니다. 예약은 매장이 5분 안에 수락·거절하며, `wait`로 결과를 기다립니다.

MIT License · © 2026 Hide Me Please, Inc.
