// coinwatch-api — 시세용 프록시 (CORS 우회 + 엣지 캐시)
//
//   GET /cmc/krw
//     -> { updated:<ms>, data:{ "BTC":{krw,rank}, ... } }        시총 상위 200개, CoinMarketCap
//
//   GET /cg/markets
//     -> [ {symbol,name,current_price,price_change_percentage_24h,market_cap_rank,high_24h,low_24h}, ... ]
//        시총 1~500위, CoinGecko. 엣지 캐시 CG_MARKETS_TTL(기본 60초).
//
//   GET /cg/search?q=<검색어>
//     -> { coins:[ {id,symbol,name,rank,price,change24h}, ... ] }
//        CoinGecko 코인 검색(순위 밖 코인 포함). 엣지 캐시 CG_SEARCH_TTL(기본 3600초).
//
//   GET /fx/history?days=<1|30|90|180|365>
//     -> { source:"yahoo"|"naver", interval:"5분"|"1시간"|"1일", points:[ {t:<unix초>, v:1389}, ... ] }
//        원/달러 추이. 1일은 5분봉, 나머지는 1시간봉(야후 파이낸스) — 하루치 종가만 쓰면
//        한 달이 20점밖에 안 돼 선이 듬성듬성해진다. 야후가 막히면 네이버 일별 종가로 폴백.
//        엣지 캐시 FX_TTL(기본 600초, 1일 구간은 120초).
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
const NAVER_FX = "https://api.stock.naver.com/marketindex/exchange/FX_USDKRW/prices";
const NAVER_FX_PAGE = 60; // 네이버가 한 번에 주는 최대 행 수 — 61 이상을 요청하면 JSON이 아닌 에러가 온다
const YAHOO_FX = "https://query1.finance.yahoo.com/v8/finance/chart/KRW=X";
// 기간 -> 야후 range/interval. 화면 폭이 500px 남짓이라 이보다 촘촘해도 눈에 안 보인다.
const FX_RANGE = {
  1:   { range: "1d",  interval: "5m", label: "5분" },
  30:  { range: "1mo", interval: "1h", label: "1시간" },
  90:  { range: "3mo", interval: "1h", label: "1시간" },
  180: { range: "6mo", interval: "1h", label: "1시간" },
  365: { range: "1y",  interval: "1h", label: "1시간" },
};
const FX_MAX_POINTS = 500;

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
    if (url.pathname === "/fx/history") return handleFxHistory(url, env, ctx, openCors("*"));
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
  // 응답에 담는 필드가 바뀌면 v를 올린다 — 안 올리면 옛 모양의 캐시가 만료될 때까지 그대로 나간다
  const key = new Request("https://cache.internal/cg-markets/v2");
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
        image: c.image ?? null, // 표 왼쪽 코인 로고
        high_24h: c.high_24h ?? null, // 등락률 아래 24시간 범위 바에 사용
        low_24h: c.low_24h ?? null,
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
  const key = new Request("https://cache.internal/cg-search/v2/" + encodeURIComponent(q));
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
        image: c.large || c.thumb || (m && m.image) || null, // 표 왼쪽 코인 로고
        price: m ? m.current_price : null,
        change24h: m ? m.price_change_percentage_24h : null,
      };
    });
    // 검색 결과는 코인 이름·순위라 사실상 변하지 않고, 가격이 조금 낡아도 클라이언트가
    // 거래소 티커로 메꾼다(fillSearchPrices). 같은 검색어의 재검색이 업스트림을 다시
    // 때리지 않도록 넉넉히 캐시한다 — 무료 한도(월 1만 콜)를 지키는 핵심.
    const ttl = Number(env.CG_SEARCH_TTL || "3600");
    const resp = new Response(JSON.stringify({ coins: out }), {
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` },
    });
    ctx.waitUntil(cache.put(key, resp.clone()));
    return withHeaders(resp, { ...cors, "x-cache": "MISS" });
  } catch (err) {
    // 실패해도 200 + 빈 목록(+CORS) → 클라이언트는 조용히 로컬 결과만 보여준다
    return json({ coins: [], error: String(err) }, 200, cors);
  }
}

// ---------- 원/달러 추이 ----------
// 브라우저에서 직접 못 부른다: 야후도 네이버도 CORS 헤더를 주지 않고,
// 네이버는 Origin 헤더가 붙은 요청에 403으로 답한다. 워커가 대신 부르고 엣지에 캐시한다.
async function handleFxHistory(url, env, ctx, cors) {
  const asked = Number(url.searchParams.get("days"));
  const days = FX_RANGE[asked] ? asked : 90;

  const cache = caches.default;
  // v2: 응답 모양이 바뀌었다(t가 "YYYY-MM-DD" 문자열 -> unix초, interval 필드 추가)
  const key = new Request("https://cache.internal/fx-history/v2/" + days);
  const hit = await cache.match(key);
  if (hit) return withHeaders(hit, { ...cors, "x-cache": "HIT" });

  const lkgKey = new Request("https://cache.internal/fx-history/lkg2/" + days);
  // 1일 구간은 장중에 계속 움직이므로 짧게 잡는다
  const ttl = days === 1 ? 120 : Number(env.FX_TTL || "600");
  try {
    let source = "yahoo";
    let interval = FX_RANGE[days].label;
    let points;
    try {
      points = await fetchYahooFx(days);
    } catch (e) {
      // 야후가 막히면(그쪽은 공유 IP에 429를 잘 뱉는다) 네이버 일별 종가로 내려간다.
      // 하루 단위라 1일 구간은 점이 1~2개뿐이라 의미가 없어 그때는 포기한다.
      if (days === 1) throw e;
      points = await fetchNaverFx(days);
      source = "naver";
      interval = "1일";
    }

    const body = JSON.stringify({ source, interval, points: thinPoints(points, FX_MAX_POINTS) });
    const resp = new Response(body, {
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` },
    });
    const lkg = new Response(body, {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=86400" },
    });
    ctx.waitUntil(cache.put(key, resp.clone()));
    ctx.waitUntil(cache.put(lkgKey, lkg));
    return withHeaders(resp, { ...cors, "x-cache": "MISS" });
  } catch (err) {
    const lkg = await cache.match(lkgKey);
    if (lkg) return withHeaders(lkg, { ...cors, "x-cache": "STALE" });
    // 502를 주면 클라이언트가 ECB 폴백으로 넘어간다
    return json({ error: "upstream_unavailable", detail: String(err) }, 502, cors);
  }
}

// 야후 파이낸스 KRW=X (= 1달러당 원). 분/시간 단위라 선이 촘촘하게 그려진다.
// 헤더에 찍히는 실시간 환율(manana.kr)도 야후를 중계한 값이라 출처가 같다.
async function fetchYahooFx(days) {
  const { range, interval } = FX_RANGE[days];
  const r = await fetch(`${YAHOO_FX}?range=${range}&interval=${interval}`, {
    headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
  });
  if (!r.ok) throw new Error("yahoo http " + r.status);
  const j = await r.json();
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  const ts = res && res.timestamp;
  const q = res && res.indicators && res.indicators.quote && res.indicators.quote[0];
  if (!ts || !q || !q.close) throw new Error("yahoo empty");

  const points = [];
  for (let i = 0; i < ts.length; i++) {
    const v = q.close[i];
    // 거래가 없던 구간은 close가 null로 온다 — 선이 0으로 떨어지지 않게 걸러낸다
    if (typeof v === "number" && v > 0) points.push({ t: ts[i], v: Math.round(v * 100) / 100 });
  }
  if (points.length < 2) throw new Error("yahoo too few");
  return points;
}

// 네이버 금융 일별 종가(하나은행 고시). 하루 한 점뿐이라 폴백 전용.
async function fetchNaverFx(days) {
  // 환율은 영업일에만 고시되므로 달력 일수의 약 5/7만 행으로 돌아온다.
  // 주말·공휴일을 감안해 0.75를 곱해 넉넉히 잡고, 최대 5페이지(=300영업일 ≈ 14개월)까지만 부른다.
  const pages = Math.min(5, Math.max(1, Math.ceil((days * 0.75) / NAVER_FX_PAGE)));
  const chunks = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      fetch(`${NAVER_FX}?page=${i + 1}&pageSize=${NAVER_FX_PAGE}`, {
        headers: {
          // 이 두 헤더가 없으면 네이버가 403으로 막는다
          "user-agent": "Mozilla/5.0",
          referer: "https://m.stock.naver.com/",
          accept: "application/json",
        },
      })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
    )
  );

  const from = Date.now() - days * 86400000;
  const seen = new Set();
  const points = [];
  for (const row of chunks.flat()) {
    const day = row && row.localTradedAt;
    if (!day || seen.has(day)) continue;
    // closePrice는 "1,389.00" 같은 천단위 콤마 문자열로 온다
    const v = parseFloat(String(row.closePrice || "").replace(/,/g, ""));
    if (!(v > 0)) continue;
    const t = Date.parse(day + "T00:00:00+09:00"); // 고시 기준은 한국 시각
    if (isNaN(t) || t < from) continue;
    seen.add(day);
    points.push({ t: Math.floor(t / 1000), v });
  }
  if (points.length < 2) throw new Error("naver too few");
  points.sort((a, b) => a.t - b.t); // 오래된 -> 최신 (그래프가 왼쪽부터 그려지도록)
  return points;
}

// 1시간봉 1년치는 6천 점이 넘는데 그래프 폭은 500px 남짓이라 그대로 보내봐야 보이지도 않는다.
// 균등 간격으로 솎아내되 마지막(가장 최근) 점은 반드시 남긴다 — 그 값이 패널 위 큰 숫자가 된다.
function thinPoints(points, max) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
  const last = points[points.length - 1];
  if (out[out.length - 1].t !== last.t) out.push(last);
  return out;
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
