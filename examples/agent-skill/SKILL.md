---
name: heyyumi-restaurant
description: Find Korean restaurants, cafes, bakeries and bars and send table requests with the HeyYumi CLI. Use when the user wants a place to eat or drink in Korea (by area, station, landmark, dish, opening time, parking, dietary needs), details on a venue, a reservation, or a live question to the venue such as the current wait. Works for questions in any language, e.g. "점심 뭐 먹지", "회식 장소 추천해 줘", "dinner near Hongdae for 4", "明洞でランチ".
license: MIT
---

# HeyYumi Restaurant

This skill uses the [`heyyumi`](https://www.npmjs.com/package/heyyumi) CLI to search verified restaurants, cafes, bakeries and bars across Korea and to send table requests.

## Start here

1. Run `npx -y heyyumi guide` once per task and follow it. The rules come from the HeyYumi server and stay current.
2. Before sending a table request, run `npx -y heyyumi guide reserve`. Before asking a venue a live question, run `npx -y heyyumi guide live`.

If a command exits with code `3`, sign in first: `npx -y heyyumi login --client-name "<your agent name>"`. A Google sign-in opens in the browser and the command finishes by itself once the user approves. With a dashboard key (`hmp_...`), set `HEYYUMI_API_KEY` instead.

## Commands

```bash
npx -y heyyumi search "<dish or venue>" --region "<area, station or landmark>"
npx -y heyyumi search --region Hongdae --subtype korean_bbq --open_at "2026-10-25 19:00"
npx -y heyyumi place <placeId>
npx -y heyyumi reserve <placeId> --time "2026-10-25 19:00" --party 2 --name "Kim" --phone 010-1234-5678
npx -y heyyumi live <placeId> --kind wait --topic "wait time"
```

Every search filter works as a flag; list them with `npx -y heyyumi tools search_places`. `npx -y heyyumi help` shows all commands.

## Always

- `reserve` and `live` reach a real venue. Confirm the details with the user first, and never run them just to test.
- When the output has `cli.next`, run that command next.
- Pass on the notes the output carries for the user, in the user's language.
- If a flag is rejected with `unknown_option`, retry with the name from the hint.

## When not to use

- Restaurants outside Korea
- Food delivery orders
