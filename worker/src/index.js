// coinwatch-api — 시세용 프록시 (CORS 우회 + 엣지 캐시)
//
//   GET /cmc/krw
//     -> { updated:<ms>, data:{ "BTC":{krw,rank}, ... } }        시총 상위 200개, CoinMarketCap
//
//   GET /cg/markets
//     -> [ {symbol,name,current_price,price_change_percentage_24h,market_cap_rank}, ... ]
//        시총 1~500위, CoinGecko. 엣지 캐시 CG_MARKETS_TTL(기본 60초).
//
//   GET /cg/search?q=<검색어>
//     -> { coins:[ {id,symbol,name,rank,price,change24h}, ... ] }
//        CoinGecko 코인 검색(순위 밖 코인 포함). 엣지 캐시 120초.
//
// 왜 필요한가:
//   - CoinMarketCap: 브라우저에서 못 부른다 (CORS 없음 + 키 노출).
//   - CoinGecko: 키 없는 공개 API는 공유 IP 기준으로 분당 몇 콜만 허용 → 브라우저에서 직접
//     부르면 조금만 몰려도 429(그리고 429에는 CORS 헤더가 없어 fetch 자체가 실패)한다.
//     워커가 대신 부르고 결과를 엣지에 캐시하면, 사용자가 몰려도 업스트림 콜은 캐시 주기당 1회.
//   - CG_KEY(선택): CoinGecko Demo 키를 secret으로 넣으면 분당 30콜로 여유가 커진다.
//       npx wrangler secret put CG_KEY

const CMC_FRESH_KEY = "https://cache.internal/cmc-krw/fresh";
const CMC_LKG_KEY = "https://cache.internal/cmc-krw/last-known-good";
const CMC_URL =
  "https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=200&convert=KRW";
const CG = "https://api.coingecko.com/api/v3";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // 검색·시세 목록은 공개 데이터라 어디서 부르든 허용, CMC만 배포 오리진으로 제한
    const strictOrigin = env.ALLOW_ORIGIN || "*";
    const openCors = (origin) => ({
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, OPTIONS",
      vary: "origin",
    });

    if (request.method === "OPTIONS") return new Response(null, { headers: openCors("*") });
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, openCors("*"));

    if (url.pathname === "/cmc/krw") return handleCmc(env, ctx, openCors(strictOrigin));
    if (url.pathname === "/cg/markets") return handleCgMarkets(env, ctx, openCors("*"));
    if (url.pathname === "/cg/search") return handleCgSearch(url, env, ctx, openCors("*"));
    return json({ error: "not_found" }, 404, openCors("*"));
  },
};

// ---------- CoinMarketCap KRW ----------
async function handleCmc(env, ctx, cors) {
  const cache = caches.default;
  const fresh = await cache.match(new Request(CMC_FRESH_KEY));
  if (fresh) return withHeaders(fresh, { ...cors, "x-cache": "HIT" });

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
    ctx.waitUntil(cache.put(new Request(CMC_FRESH_KEY), freshResp.clone()));
    ctx.waitUntil(cache.put(new Request(CMC_LKG_KEY), lkgResp));
    return withHeaders(freshResp, { ...cors, "x-cache": "MISS" });
  } catch (err) {
    const lkg = await cache.match(new Request(CMC_LKG_KEY));
    if (lkg) return withHeaders(lkg, { ...cors, "x-cache": "STALE" });
    return json({ error: "upstream_unavailable", detail: String(err) }, 502, cors);
  }
}

// ---------- CoinGecko: 시총 1~500위 ----------
async function handleCgMarkets(env, ctx, cors) {
  const cache = caches.default;
  const key = new Request("https://cache.internal/cg-markets/v1");
  const hit = await cache.match(key);
  if (hit) return withHeaders(hit, { ...cors, "x-cache": "HIT" });

  const ttl = Number(env.CG_MARKETS_TTL || "60");
  try {
    const pages = await Promise.all([1, 2].map((p) =>
      cgFetch(env, `${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${p}&price_change_percentage=24h`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
    ));
    const rows = pages.flat();
    if (rows.length === 0) throw new Error("cg markets empty");
    const seen = new Set();
    const out = [];
    for (const c of rows) {
      const s = (c.symbol || "").toUpperCase();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push({
        symbol: c.symbol,
        name: c.name,
        current_price: c.current_price,
        price_change_percentage_24h: c.price_change_percentage_24h,
        market_cap_rank: c.market_cap_rank ?? null,
      });
    }
    const body = JSON.stringify(out);
    const resp = new Response(body, {
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` },
    });
    const lkg = new Response(body, {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=86400" },
    });
    ctx.waitUntil(cache.put(key, resp.clone()));
    ctx.waitUntil(cache.put(new Request("https://cache.internal/cg-markets/lkg"), lkg));
    return withHeaders(resp, { ...cors, "x-cache": "MISS" });
  } catch (err) {
    const lkg = await cache.match(new Request("https://cache.internal/cg-markets/lkg"));
    if (lkg) return withHeaders(lkg, { ...cors, "x-cache": "STALE" });
    return json({ error: "upstream_unavailable", detail: String(err) }, 502, cors);
  }
}

// ---------- CoinGecko: 코인 검색(순위 밖 포함) ----------
async function handleCgSearch(url, env, ctx, cors) {
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  if (q.length < 2) return json({ coins: [] }, 200, cors);

  const cache = caches.default;
  const key = new Request("https://cache.internal/cg-search/" + encodeURIComponent(q));
  const hit = await cache.match(key);
  if (hit) return withHeaders(hit, { ...cors, "x-cache": "HIT" });

  try {
    const sr = await cgFetch(env, `${CG}/search?query=${encodeURIComponent(q)}`);
    if (!sr.ok) throw new Error("cg search " + sr.status);
    const coins = ((await sr.json()).coins || []).slice(0, 12);

    const priceMap = {};
    if (coins.length) {
      try {
        const ids = coins.map((c) => encodeURIComponent(c.id)).join(",");
        const pr = await cgFetch(env, `${CG}/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h`);
        if (pr.ok) for (const m of await pr.json()) priceMap[m.id] = m;
      } catch (e) { /* 가격 없이 이름·순위만 */ }
    }
    const out = coins.map((c) => {
      const m = priceMap[c.id];
      return {
        id: c.id,
        symbol: (c.symbol || "").toLowerCase(),
        name: c.name || c.symbol || "",
        rank: c.market_cap_rank ?? (m && m.market_cap_rank) ?? null,
        price: m ? m.current_price : null,
        change24h: m ? m.price_change_percentage_24h : null,
      };
    });
    const resp = new Response(JSON.stringify({ coins: out }), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=120" },
    });
    ctx.waitUntil(cache.put(key, resp.clone()));
    return withHeaders(resp, { ...cors, "x-cache": "MISS" });
  } catch (err) {
    // 실패해도 200 + 빈 목록(+CORS) → 클라이언트는 조용히 로컬 결과만 보여준다
    return json({ coins: [], error: String(err) }, 200, cors);
  }
}

// CoinGecko 호출. CG_KEY(Demo 키)가 있으면 헤더로 붙여 한도를 늘린다.
function cgFetch(env, u) {
  const headers = { accept: "application/json" };
  if (env.CG_KEY) headers["x-cg-demo-api-key"] = env.CG_KEY;
  return fetch(u, { headers });
}

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
