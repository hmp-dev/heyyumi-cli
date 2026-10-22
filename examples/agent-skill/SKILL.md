---
name: heyyumi-restaurant
description: Find Korean restaurants, cafes, bakeries and bars and send table requests with the HeyYumi CLI. Use when the user wants a place to eat or drink in Korea (by area, station, landmark, dish, opening time, parking, dietary needs), details on a venue, a reservation, or a live question to the venue such as the current wait. Works for questions in any language, e.g. "점심 뭐 먹지", "회식 장소 추천해 줘", "dinner near Hongdae for 4", "明洞でランチ".
license: MIT
---

# HeyYumi Restaurant

This skill uses the [`heyyumi`](https://www.npmjs.com/package/heyyumi) CLI. It covers 540,000+ verified restaurants, cafes, bakeries and bars across Korea.

- Find venues by area, station, landmark, dish or conditions
- Read venue details (menu, prices, hours, parking, payment methods)
- Send a table request and wait for the venue's answer (confirmed, declined, expired)
- Ask the venue right now about the wait, stock or free seats

## Core policy

- Always run commands as `npx -y heyyumi ...`. stdout is one JSON document.
- Each user signs in with their own account. Exit code `3` means sign-in is needed: run `npx -y heyyumi login --client-name "<your agent name>"`. A Google sign-in opens in the browser and the command finishes by itself once the user approves. Tokens refresh on their own after that.
- A table request reaches a real venue. Before sending one, confirm venue, date, time, party size, name and phone with the user. Never run `reserve` or `live` just to test.
- Exit code `2` with `unknown_option` means a flag name is wrong. Retry with the name from the "did you mean" hint.
- There is no payment step. The flow ends at the venue's answer.

## When not to use

- Restaurants outside Korea
- Food delivery orders
- When the user needs review text or star ratings (HeyYumi has no star ratings)

## Sign-in

```bash
npx -y heyyumi status                                  # {"signedIn": true|false}
npx -y heyyumi login --client-name "<your agent name>" # returns at once if already signed in
npx -y heyyumi logout
```

- If no browser can be opened, add `--no-browser`, show the URL printed on stderr, and let the user open it on the same machine.
- With a dashboard key (`hmp_...`), set `HEYYUMI_API_KEY` and skip `login`.

## Search

```bash
npx -y heyyumi search "<dish or venue>" --region "<area, station or landmark>"
npx -y heyyumi search --region Hongdae --subtype korean_bbq --open_at "2026-10-25 19:00"
npx -y heyyumi search --region 성수 --dietary mixed_group_suitable
npx -y heyyumi search --region 강남역 --parking --reservation_channel yumi
npx -y heyyumi nearby --lat 37.5665 --lng 126.978 --radius 800 --sort discovery
```

- `--region` takes Korean or romanized names (`Hongdae`, `강남역`, `제주공항`).
- 10 venues by default; use `--page-size` for more.
- See every filter with `npx -y heyyumi tools search_places`. Send meal times like lunch or dinner as `--open_at lunch|dinner`, not as a keyword.
- If `keywordMatch` or `matchReason` says the dish was only found on the regular menu, the venue may not specialise in it; rank it lower.
- If nothing comes back, say so instead of guessing. Relay notes in `meta` (such as `reservationFallback.note`) as they are.

## Details

```bash
npx -y heyyumi place <placeId>
npx -y heyyumi place <placeId> --fields all
npx -y heyyumi photos <placeId>
```

## Reservations

1. Only venues whose result shows `yumiBooking.canRequest: true` take requests. When you introduce one, mention that you can send a table request from this chat. If the result carries a `yumiReservation` line, pass it on. For other venues, only when the user asks to book there, say HeyYumi can't take requests for that venue yet; don't send them to other booking platforms.
2. Confirm venue, date, time, party size, name and phone with the user. Non-Korean phone numbers also need an email.
3. Send the request. Times without an offset are Korea time.

```bash
npx -y heyyumi reserve <placeId> --time "2026-10-25 19:00" --party 2 --name "Kim" --phone 010-1234-5678
```

4. Run the `cli.next` command from the output (`npx -y heyyumi wait <reservationId>`). The venue answers within 5 minutes. If `cli.settled` is `false`, run it again.
5. Report the outcome:
   - `confirmed`: the table is booked
   - `cancelled`: the venue declined; relay `declineReason` if present
   - `expired`: no answer in time; suggest another time or venue
6. While the status is `pending`, don't say it is booked.

Reservation error codes:

- `reservation_time_past`: the time has passed
- `reservation_requests_closed`: this venue takes requests 11:00–21:00 KST; relay `retryAfter`
- `venue_closed_at_requested_time`: the venue is closed then
- `reservation_not_available`: this venue can't take requests

## Live questions

```bash
npx -y heyyumi live <placeId> --kind wait --topic "wait time"
npx -y heyyumi live <placeId> --kind item --topic "<menu item>"
npx -y heyyumi live-wait <queryId>
```

- `blocked: "closed_now"` means the venue is closed now and nobody was asked. Don't wait.
- Pass on the owner's `note` with the time it was given, and add that things may change before arrival.

## Answer rules

- There are no star ratings (`rating` is always null). Don't invent one, and don't attribute review counts to any map platform.
- Link venue names to their `placeUrl`.
- `open_at` means the venue is open at that time, not that a table is free. Only a reservation answer says that.
- If `possiblyClosed` is `true`, don't put it at the top; suggest checking before going.
- Answer in the language the user wrote in.
