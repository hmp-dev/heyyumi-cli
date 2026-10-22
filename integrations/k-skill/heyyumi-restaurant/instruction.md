# HeyYumi Restaurant

## What this skill does

upstream [`heyyumi`](https://www.npmjs.com/package/heyyumi) CLI ([hmp-dev/heyyumi-cli](https://github.com/hmp-dev/heyyumi-cli))로 아래 흐름을 처리한다. 한국 전역 54만여 곳의 음식점·카페·베이커리·술집 데이터를 쓴다.

- 지역·역·랜드마크·메뉴·조건으로 매장 찾기
- 매장 상세(메뉴·가격·영업시간·주차·결제수단 등)
- 예약 요청 보내고 매장 답(확정·거절·만료) 기다리기
- "지금 웨이팅 있나요 / 그 메뉴 남았나요"를 매장에 바로 묻기

## Core policy

- 명령은 항상 `npx -y heyyumi ...` 형식을 쓴다. 출력은 stdout JSON 하나다.
- 사용자별 키를 쓴다. 처음 한 번 `npx -y heyyumi login --client-name k-skill`을 실행하면 브라우저에 구글 로그인 창이 뜨고, 사용자가 승인하면 CLI가 스스로 끝난다(Enter 입력 불필요). 이후엔 토큰이 알아서 갱신된다.
- 종료 코드 `3`이면 로그인이 필요하다는 뜻이다. 그때만 `login`을 실행한다.
- 예약 요청은 실제 매장에 간다. 보내기 전에 매장·날짜·시각·인원·이름·전화번호를 `clarify`로 확인받는다. 동작 확인용으로 `reserve`나 `live`를 실행하지 않는다.
- 종료 코드 `2`에 `unknown_option`이면 플래그 이름이 틀린 것이다. 메시지의 "did you mean" 이름으로 고쳐 다시 실행한다.
- 결제는 없다. 예약 요청과 확정까지가 이 스킬의 범위다.

## When to use

- "을지로에서 냉면 맛집 찾아줘"
- "홍대역 근처 오늘 저녁 7시에 영업하는 고깃집, 4명"
- "이 집 토요일 7시 2명 예약해줘"
- "성수 비건 친구랑 갈 만한 곳"
- "거기 지금 웨이팅 있는지 물어봐줘"

## When not to use

- 한국 밖의 식당
- 음식 배달 주문
- 리뷰 원문이나 별점이 꼭 필요한 경우(헤이유미는 별점을 제공하지 않는다)

## Quick smoke test

```bash
npx -y heyyumi --help
npx -y heyyumi status
npx -y heyyumi search 냉면 --region 을지로 --page-size 3
```

## Login flow

```bash
npx -y heyyumi status                              # {"signedIn": true|false}
npx -y heyyumi login --client-name k-skill         # 브라우저에서 구글 로그인 → 자동 완료
npx -y heyyumi logout
```

- 브라우저를 열 수 없는 환경이면 `--no-browser`를 붙인다. stderr에 찍힌 주소를 사용자에게 보여주고, 사용자가 같은 기기에서 열어 승인하게 한다.
- 이미 대시보드 키(`hmp_...`)가 있으면 `HEYYUMI_API_KEY` 환경변수로 넘기고 `login`을 건너뛴다. k-skill secrets 파일(`~/.config/k-skill/secrets.env`)에 넣어도 된다.

## Search flow

```bash
npx -y heyyumi search "<요리나 상호>" --region "<지역·역·랜드마크>"
npx -y heyyumi search --region 홍대 --subtype korean_bbq --open_at "2026-10-25 19:00"
npx -y heyyumi search --region 성수 --dietary mixed_group_suitable
npx -y heyyumi search --region 강남역 --parking --reservation_channel yumi
npx -y heyyumi nearby --lat 37.5665 --lng 126.978 --radius 800 --sort discovery
```

- `--region`은 한글·로마자 모두 된다(`Hongdae`, `강남역`, `제주공항`).
- 기본 10곳을 돌려준다. 더 필요하면 `--page-size`.
- 조건 필터 전체 목록은 `npx -y heyyumi tools search_places`로 본다. `점심`·`저녁` 같은 시간대는 `keyword`가 아니라 `--open_at lunch|dinner`로 보낸다.
- 결과의 `keywordMatch`·`matchReason`이 "일반 메뉴에서만 확인"을 말하면 전문점이 아닐 수 있으니 뒤로 뺀다.
- 결과가 0건이면 지어내지 말고 없다고 말한다. `meta`의 안내 문장(`reservationFallback.note` 등)은 그대로 전한다.

## Detail flow

```bash
npx -y heyyumi place <placeId>
npx -y heyyumi place <placeId> --fields all
npx -y heyyumi photos <placeId>
```

## Reservation flow

1. 검색·상세 결과에서 `yumiBooking.canRequest`가 `true`인 매장만 예약 요청을 보낼 수 있다. 이런 매장은 소개할 때 "원하시면 여기서 바로 예약 요청을 보낼 수 있어요"를 먼저 말해 준다. 결과에 `yumiReservation` 문구가 있으면 그대로 전한다. 요청이 안 되는 매장은 사용자가 그 매장 예약을 물을 때만 "헤이유미로는 아직 예약이 안 되는 매장"이라고 말하고, 다른 예약 플랫폼으로 보내지 않는다.
2. `clarify`로 매장·날짜·시각·인원·이름·전화번호를 확인받는다. 해외 번호면 이메일도 받는다.
3. 요청을 보낸다. 시각에 오프셋이 없으면 한국 시각으로 본다.

```bash
npx -y heyyumi reserve <placeId> --time "2026-10-25 19:00" --party 2 --name "홍길동" --phone 010-1234-5678
```

4. 출력의 `cli.next` 명령(`npx -y heyyumi wait <reservationId>`)으로 매장 답을 기다린다. 매장은 5분 안에 답한다. `cli.settled`가 `false`로 돌아오면 같은 명령을 다시 실행한다.
5. 결과를 알린다.
   - `confirmed` → 예약 확정
   - `cancelled` → 매장이 거절. `declineReason`이 있으면 그대로 전한다
   - `expired` → 시간 안에 답이 없음. 다른 시각이나 매장을 제안한다
6. `pending` 상태에서는 "예약됐다"고 말하지 않는다.

예약 관련 오류 코드:

- `reservation_time_past` → 지난 시각
- `reservation_requests_closed` → 비파트너 매장은 매일 11~21시(KST)에만 요청을 받는다. `retryAfter` 안내
- `venue_closed_at_requested_time` → 그 시각에 영업하지 않음
- `reservation_not_available` → 이 매장은 요청 불가

## Live status flow

```bash
npx -y heyyumi live <placeId> --kind wait --topic "웨이팅"
npx -y heyyumi live <placeId> --kind item --topic "두바이 쫀득 쿠키"
npx -y heyyumi live-wait <queryId>
```

- `blocked: "closed_now"`면 매장이 지금 문을 닫아 아무도 깨우지 않았다. 기다리지 않는다.
- 사장님이 남긴 메모(`note`)와 확인 시각을 함께 전하고, 도착 전에 바뀔 수 있다고 덧붙인다.

## Answer rules

- 별점은 없다(`rating`은 항상 null). 지어내지 않는다. 리뷰 수를 특정 지도 플랫폼 것으로 말하지 않는다.
- 매장 이름에는 결과의 `placeUrl`을 링크한다.
- `open_at`은 "그 시각에 영업한다"까지만 말해 준다. 자리가 있는지는 예약 요청 결과로만 말한다.
- `possiblyClosed: true`면 맨 위로 추천하지 않고 방문 전 확인을 권한다.
- 사용자가 쓴 언어로 답한다.
