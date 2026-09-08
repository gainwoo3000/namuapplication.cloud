// coinwatch-api — CoinMarketCap KRW 시세 프록시 (CORS 우회 + 엣지 캐시)
//
//   GET /cmc/krw
//     -> { updated: <ms>, data: { "BTC": { krw, rank }, ... } }   (시총 상위 200개)
//
// 왜 필요한가:
//   CoinMarketCap API는 브라우저에서 직접 못 부른다 (CORS 헤더 없음 + API 키가 노출됨).
//   이 워커가 서버 쪽에서 대신 호출하고, CORS 헤더를 붙여서 정적 페이지에 돌려준다.
//
// 크레딧 보호:
//   CMC 무료(Basic) 티어는 월 10,000 콜 크레딧. listings/latest?limit=200 = 1 크레딧/콜.
//   결과를 엣지 캐시에 CMC_TTL_SECONDS(기본 600초) 동안 저장 → 그 사이 요청은 캐시로만 응답.
//   600초 캐시면 하루 ~144콜 ≈ 월 4,300 크레딧으로 여유. (TTL을 300으로 줄이면 ~8,600/월)
//   CMC 호출이 실패하면 최근 24시간 내 마지막 정상 응답(LKG)으로 폴백한다.

const FRESH_KEY = "https://cache.internal/cmc-krw/fresh";
const LKG_KEY = "https://cache.internal/cmc-krw/last-known-good";
const CMC_URL =
  "https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=200&convert=KRW";

export default {
  async fetch(request, env, ctx) {
    const cors = {
      "access-control-allow-origin": env.ALLOW_ORIGIN || "*",
      "access-control-allow-methods": "GET, OPTIONS",
      vary: "origin",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, cors);

    const url = new URL(request.url);
    if (url.pathname !== "/cmc/krw") return json({ error: "not_found" }, 404, cors);

    const cache = caches.default;

    // 1) 신선한 캐시가 있으면 그대로 반환
    const fresh = await cache.match(new Request(FRESH_KEY));
    if (fresh) return withHeaders(fresh, { ...cors, "x-cache": "HIT" });

    // 2) 캐시 미스 → CMC 호출
    const ttl = Number(env.CMC_TTL_SECONDS || "600");
    try {
      const upstream = await fetch(CMC_URL, {
        headers: { "X-CMC_PRO_API_KEY": env.CMC_KEY, accept: "application/json" },
      });
      if (!upstream.ok) throw new Error("cmc http " + upstream.status);

      const raw = await upstream.json();
      const data = {};
      for (const c of raw.data || []) {
        const krw = c.quote && c.quote.KRW && c.quote.KRW.price;
        if (typeof krw === "number") data[c.symbol] = { krw, rank: c.cmc_rank ?? null };
      }
      if (Object.keys(data).length === 0) throw new Error("cmc empty");

      const body = JSON.stringify({ updated: Date.now(), data });
      const freshResp = new Response(body, {
        headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` },
      });
      const lkgResp = new Response(body, {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=86400" },
      });
      ctx.waitUntil(cache.put(new Request(FRESH_KEY), freshResp.clone()));
      ctx.waitUntil(cache.put(new Request(LKG_KEY), lkgResp));

      return withHeaders(freshResp, { ...cors, "x-cache": "MISS" });
    } catch (err) {
      // 3) CMC 실패 → 마지막 정상 응답으로 폴백
      const lkg = await cache.match(new Request(LKG_KEY));
      if (lkg) return withHeaders(lkg, { ...cors, "x-cache": "STALE" });
      return json({ error: "upstream_unavailable", detail: String(err) }, 502, cors);
    }
  },
};

function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
}

function withHeaders(resp, extra) {
  const h = new Headers(resp.headers);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(resp.body, { status: resp.status, headers: h });
}
