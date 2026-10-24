# heyyumi

[![npm](https://img.shields.io/npm/v/heyyumi)](https://www.npmjs.com/package/heyyumi)
[![node](https://img.shields.io/node/v/heyyumi)](https://www.npmjs.com/package/heyyumi)
[![license](https://img.shields.io/npm/l/heyyumi)](https://github.com/hmp-dev/heyyumi-cli/blob/main/LICENSE)

**Your AI finds and books real Korean restaurants, no Korean needed.**

Ask your agent for *"bibimbap near Myeongdong"*, *"a place BTS's Jin goes to for naengmyeon"* or *"somewhere open for dinner in Hongdae where nobody minds that I don't speak Korean"*. HeyYumi answers from verified data on **546,000+ restaurants, cafes and bars across Korea**, and sends the table request to the restaurant itself. Within 5 minutes you know whether the table is yours.

```bash
npx -y heyyumi login                          # once: Google sign-in in the browser, a key is made for you
npx -y heyyumi search bibimbap --region Myeongdong
npx -y heyyumi reserve <placeId> --time "2026-10-25 19:00" --party 2 --phone +1-415-555-0100 --email you@example.com
```

Works with any agent that runs shell commands and reads JSON: Claude Code, Codex, Gemini CLI, Cursor, or your own scripts. Node.js 18+, zero dependencies, free for personal use.

## What your agent gets

**Real data, cross-checked.** 371,000+ restaurants, 138,000+ cafes and 37,000+ bars. More than 432,000 of them are confirmed by more than one independent source, and every record carries a confidence score and a last-seen date. Menus, prices, opening hours, last orders and break times are included wherever they are known. Nothing is invented: there are no star ratings, and a missing field means "unknown", never "no".

**Ask in your own language.** Dish names in English, romanized Korean, Japanese or Chinese are mapped to the Korean dish through an official government list of 800 Korean dishes and their foreign names. `bibimbap`, `ビビンバ` and `拌饭` all become 비빔밥. Places can be typed the same way: `Hongdae`, `Gangnam Station`, `Jeju Airport`.

**Book from the conversation.** `reserve` sends a real request to the restaurant, and `wait` returns `confirmed`, `cancelled` (with the venue's reason, if it gave one) or `expired`. The venue has 5 minutes to answer. Foreign phone numbers are welcome with an email address. Many venues can take a request, and the JSON says which ones (`yumiBooking.canRequest`).

**Ask the owner right now.** At Yumi partner venues, `live` asks the owner directly: is the dish still available, how long is the wait, are there seats for 10 right now? The question goes to the owner's phone, and they have 5 minutes to reply.

**Search the way travelers actually ask.** Over 60 filters, including:

| Ask for | Flag |
|---|---|
| Places where you don't need Korean (English menu or staff who speak your language) | `--foreigner-friendly` · `--english-menu` · `--foreign-languages ja` |
| Places a K-pop star or K-drama is known for (with the news source) | `--associated-with BTS` · `--associated-with 도깨비` |
| Shops on official long-running lists (30+ years) | `--legacy` |
| Vegan meals for a mixed group, vegetarian, gluten-free | `--dietary mixed_group_suitable` · `--dietary gluten_free` |
| Known to welcome Muslim guests (not a halal certification) | `--muslim-friendly` |
| Open at a time or a meal, last orders included | `--open-at "2026-10-25 19:00"` · `--open-at dinner` |
| Hanok, rooftop, ocean or river view, temple food, a city's signature food | `--hanok` · `--rooftop` · `--view ocean` · `--temple-food` · `--local-food Busan` |
| Alipay, WeChat Pay, Apple Pay, UnionPay | `--payment-methods alipay` |

Coverage today: Seoul, Gyeonggi, Busan, Jeju, Incheon, Daejeon, Sejong, Chungbuk and Chungnam, and growing.

## What it looks like

```bash
$ npx -y heyyumi search bibimbap --region Myeongdong --page-size 3 --fields core
```

```jsonc
{
  "resolvedAs": "명동 상권",
  "data": [
    {
      "id": "8392850",
      "name": "본죽&비빔밥 명동점",
      "address": { "road": "서울특별시 중구 명동8가길 6 2층" },
      "confidence": 0.87,
      "distanceM": 241,
      "placeUrl": "https://heyyumi.ai/en/places/8392850",
      "matchReason": "name",
      "yumiBooking": { "canRequest": true, "requestHours": "10:00-20:00 KST" }
    },
    {
      "name": "방이옥 종로점",
      "matchReason": "representative_menu",
      "matchedMenu": ["[점심특선] 한우육회 비빔밥 (1인)"]
      // ...
    }
  ],
  "meta": {
    "total": 308,
    "sort": "discovery",
    "keywordTranslated": { "from": "bibimbap", "to": "비빔밥", "source": "official_dish_name" }
  }
}
```

Names and addresses come back in Korean, which is what taxi drivers and map apps expect. Your agent reads the JSON and answers in whatever language the user wrote in. `matchReason` tells it whether a place is a specialist or just also sells the dish.

## Try these

```bash
npx -y heyyumi search --region Seoul --associated-with BTS --page-size 5
npx -y heyyumi search 고기국수 --region "Jeju Airport" --open-at lunch
npx -y heyyumi search --region Gangnam --subtype korean_bbq --bbq-meat pork --private-room
npx -y heyyumi search --region Seongsu --dietary mixed_group_suitable --open-at dinner
npx -y heyyumi search --region Busan --local-food Busan --exclude 돼지국밥
npx -y heyyumi place <placeId> --fields all          # menu, hours, attributes, reputation
```

## Sign in once

`heyyumi login` opens HeyYumi's Google sign-in and waits on a local callback (`http://127.0.0.1:<random port>/callback`). When the user approves, the CLI finishes by itself. Nobody has to press Enter, so an agent can run it directly.

- Each sign-in gets its own HeyYumi key on the user's account, so usage is metered per user.
- Credentials are saved to `~/.config/heyyumi/credentials.json` (mode 0600; `%APPDATA%\heyyumi` on Windows). Access tokens refresh on their own; refresh is locked across processes so parallel agent commands never sign the user out.
- `heyyumi status` shows whether you are signed in (never prints tokens). `heyyumi logout` removes local credentials. Keys can be revoked any time at <https://heyyumi.ai/dashboard>.
- `--no-browser` prints the URL instead of opening it. `--client-name NAME` labels the connection (it shows up as the source of reservation requests, e.g. `--client-name "My Agent"`).
- Already have a dashboard key? Set `HEYYUMI_API_KEY=hmp_...` and skip `login`.

## Commands

| Command | What it does |
|---|---|
| `search [KEYWORD] --region NAME [filters]` | Shortlist venues. `--region` takes Korean or romanized names, stations and landmarks (`Hongdae`, `강남역`, `제주공항`). Every `search_places` filter works as a flag (see `heyyumi tools search_places`). Returns 10 venues unless `--page-size` is given. |
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
- Unknown flags fail with `unknown_option` and a "did you mean" hint instead of being dropped, so a typo never turns into a silently wider search or a nameless booking. Search flags are checked against the live tool schema (cached for an hour), so new server filters work without a CLI update.
- When a follow-up command is needed, the output carries `cli.next`, e.g. `npx -y heyyumi wait <id>`.

## Rules for agents

- Only send `reserve` for venues whose result shows `yumiBooking.canRequest: true`. Confirm time, party size, name and phone with the user before sending; it reaches a real venue. Venues with `requestHours` review requests in those hours (Korea time). A request sent outside them comes back with `cli.deferred: true` and `cli.reviewStartsAt`: it is held, and the guest gets the answer by text or email, so don't wait for it now.
- A request starts as `pending`. Say it is booked only after `wait` returns `status: "confirmed"`. `cancelled` means the venue declined (relay `declineReason` if present); `expired` means no answer in time.
- `open_at` means the venue is open at that time, not that a table is free. Only a reservation answer says that.
- There are no star ratings (`rating` is always null). Do not invent one, and do not attribute review counts to any map platform.
- `associated_with` results are reported visits with a news link, not endorsements. Say "reportedly visited by".
- Link venue names to their `placeUrl`.

## Use it as an agent skill

Any agent or skill system that can run a shell command can wrap this CLI:

```bash
npx -y heyyumi login --client-name "My Agent"   # returns at once if already signed in
npx -y heyyumi search "<dish or venue>" --region "<area>" --page-size 5
```

A ready-to-copy skill in the common `SKILL.md` format is in [`examples/agent-skill`](https://github.com/hmp-dev/heyyumi-cli/blob/main/examples/agent-skill/SKILL.md). For Claude Code, copy it to `~/.claude/skills/heyyumi-restaurant/SKILL.md`; for other agents, adapt the same instructions to their skill or tool format. Treat `reserve` and `live` as actions that need the user's approval first, because they reach a real venue.

Not in a terminal? The same tools are available as an MCP server for ChatGPT, Claude, Perplexity and Cursor: `https://mcp.heyyumi.ai/mcp` ([setup guide](https://heyyumi.ai/mcp)). Building a product? See the [REST API](https://heyyumi.ai/developers).

## Environment

| Variable | Default |
|---|---|
| `HEYYUMI_API_KEY` | unset (use `login`) |
| `HEYYUMI_CONFIG_DIR` | `~/.config/heyyumi` |
| `HEYYUMI_CLIENT_NAME` | `HeyYumi CLI` |
| `HEYYUMI_MCP_URL` | `https://mcp.heyyumi.ai/mcp` |
| `HEYYUMI_ISSUER` | `https://heyyumi.ai` |

---

**한국어** · AI 에이전트가 터미널 명령 하나로 한국의 검증된 맛집 54만여 곳을 찾고, 매장에 예약 요청까지 보낼 수 있는 CLI입니다. `npx -y heyyumi login`을 한 번 실행해 구글로 로그인하면 바로 쓸 수 있고, 모든 결과는 JSON으로 옵니다. 예약 요청을 보내면 5분 안에 수락 여부를 알 수 있어요.

**日本語** · 韓国語が分からなくても、AIエージェントが韓国の飲食店54万件以上から店を探し、予約リクエストまで送れるCLIです。「ビビンバ」のように日本語の料理名でもそのまま検索できます。予約できたかどうかは5分以内に分かります。

**中文** · 不会韩语也没关系。这个 CLI 让 AI 助手在韩国 54 万多家经过核实的餐厅、咖啡馆和酒吧中搜索，并直接发送订位请求。可以用中文菜名搜索（例如“拌饭”），5 分钟内就能知道是否订位成功。

**Español** · Tu IA encuentra y reserva restaurantes reales en Corea sin que sepas coreano: más de 546.000 locales verificados, búsqueda por nombre de plato en tu idioma y solicitudes de reserva con respuesta en 5 minutos.

MIT License · © 2026 Hide Me Please, Inc.
