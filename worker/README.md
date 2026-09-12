# coinwatch-api

정적 페이지(코인워치)가 브라우저에서 직접 못 부르는 API를 CORS 허용 + 엣지 캐시로 중계하는 Cloudflare Worker.

| 경로 | 용도 | 캐시 |
|---|---|---|
| `GET /cmc/krw` | CoinMarketCap KRW 시세(시총 상위 200) | `CMC_TTL_SECONDS`(기본 600초) |
| `GET /cg/markets` | CoinGecko 시총 1~500위 | `CG_MARKETS_TTL`(기본 60초) |
| `GET /cg/search?q=<검색어>` | CoinGecko 코인 검색(순위 밖 포함) | `CG_SEARCH_TTL`(기본 3600초) |

`/cg/*` 가 필요한 이유: CoinGecko 키 없는 공개 API는 공유 IP 기준 분당 몇 콜만 허용 → 브라우저에서 직접 부르면 조금만 몰려도 429가 나고, **429 응답엔 CORS 헤더가 없어 `fetch` 자체가 실패**한다. 워커가 대신 부르고 엣지에 캐시하면 사용자가 몰려도 업스트림 콜은 캐시 주기당 1회.

## 응답 예시

```
GET https://api.namuapplication.cloud/cmc/krw
```
```json
{ "updated": 1730900000000, "data": { "BTC": { "krw": 91234567, "rank": 1 } } }
```
```
GET https://api.namuapplication.cloud/cg/search?q=kishu
```
```json
{ "coins": [ { "id":"kishu-inu","symbol":"kishu","name":"Kishu Inu","rank":1216,"price":1.0e-10,"change24h":-3.2 } ] }
```
응답 헤더 `x-cache`: `HIT`(캐시) / `MISS`(방금 업스트림 호출) / `STALE`(실패 → 마지막 정상값).

## 배포 순서

### 1. CoinMarketCap API 키 발급  ← 본인만 가능
- https://pro.coinmarketcap.com/signup 가입 → **Basic (무료)** 플랜
- Dashboard에서 **API Key** 복사

### 2. Cloudflare 로그인  ← 본인 계정
```bash
cd worker
npx wrangler login          # 브라우저 열림 → Authorize
```
`namuapplication.cloud` 존이 **이 계정에** 있어야 한다(대시보드에서 확인).

### 3. API 키를 시크릿으로 등록  ← 본인이 붙여넣기
```bash
npx wrangler secret put CMC_KEY
# 프롬프트에 1번에서 복사한 키 붙여넣고 Enter
```

### 4. 배포
```bash
npx wrangler deploy
```
`custom_domain = true` 라 `api.namuapplication.cloud` DNS 레코드와 인증서가 자동 생성된다(1~2분).
> 이미 `api` DNS 레코드가 있으면 충돌하니 먼저 지울 것.

### 5. 확인
```bash
curl -i https://api.namuapplication.cloud/cmc/krw
curl -s "https://api.namuapplication.cloud/cg/search?q=kishu"
curl -s "https://api.namuapplication.cloud/cg/markets" | head -c 200
```
- `200` + JSON 나오면 성공
- Cloudflare 대시보드 → **Workers & Pages → coinwatch-api** 에 로그(`npx wrangler tail`)
- `401` 나오면 CMC_KEY 잘못 등록 → 3번 다시

## 튜닝
- 크레딧 여유 확인 후 신선도를 높이려면 `wrangler.toml` 의 `CMC_TTL_SECONDS` 를 `300`(5분)으로.
- 허용 오리진 변경(`/cmc/krw` 만 해당): `ALLOW_ORIGIN`. `/cg/*` 는 공개 데이터라 항상 `*`.
- **(선택) CoinGecko Demo 키**로 검색 한도를 넉넉하게:
  ```bash
  # https://www.coingecko.com/en/developers/dashboard 에서 무료 Demo 키 발급
  npx wrangler secret put CG_KEY
  ```
  없어도 동작한다(엣지 캐시로 대부분 커버). 있으면 분당 30콜로 여유가 커진다.

## 로컬 테스트
```bash
echo 'CMC_KEY = "여기에_키"' > .dev.vars   # git에 안 올라감
npx wrangler dev
curl "http://localhost:8787/cmc/krw"
```
