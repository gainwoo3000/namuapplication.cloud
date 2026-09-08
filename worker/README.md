# coinwatch-api

`api.namuapplication.cloud/cmc/krw` — CoinMarketCap KRW 시세를 CORS 허용 + 엣지 캐시로 중계하는 Cloudflare Worker.

정적 페이지(코인워치)는 CoinMarketCap을 직접 못 부른다(CORS 없음 + API 키 노출). 이 워커가 서버에서 대신 호출하고 캐시해서 돌려준다.

## 응답

```
GET https://api.namuapplication.cloud/cmc/krw
```
```json
{
  "updated": 1730900000000,
  "data": {
    "BTC": { "krw": 91234567, "rank": 1 },
    "ETH": { "krw": 3456789,  "rank": 2 }
  }
}
```
응답 헤더 `x-cache`: `HIT`(캐시) / `MISS`(방금 CMC 호출) / `STALE`(CMC 실패 → 마지막 정상값).

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
```
- `200` + JSON 나오면 성공
- Cloudflare 대시보드 → **Workers & Pages → coinwatch-api** 에 로그(`npx wrangler tail`)
- `401` 나오면 CMC_KEY 잘못 등록 → 3번 다시

## 튜닝
- 크레딧 여유 확인 후 신선도를 높이려면 `wrangler.toml` 의 `CMC_TTL_SECONDS` 를 `300`(5분)으로.
- 허용 오리진 변경: `ALLOW_ORIGIN`.

## 로컬 테스트
```bash
echo 'CMC_KEY = "여기에_키"' > .dev.vars   # git에 안 올라감
npx wrangler dev
curl "http://localhost:8787/cmc/krw"
```
