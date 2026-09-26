import { BINANCE, GECKO, CMC_PROXY, CG_MARKETS_PROXY, FX_HISTORY_PROXY, FX_RATE_PROXY, API_BASE, UPBIT_CANDLES_PROXY, FX_SOURCE_LABEL, NAME_MAP, CANDLE_SPEC } from "./constants.js";
import { state } from "./state.js";

// ---------- 시세 그리드 ----------
// 순위는 시가총액 기준(CoinGecko)으로 매기고, 가격/등락률은 가능하면 바이낸스 실시간 값으로 덮어써서 사용
async function fetchGeckoPage(page){
  const res = await fetch(`${GECKO}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&price_change_percentage=24h`);
  if(!res.ok) throw new Error("gecko http " + res.status);
  return res.json();
}

// 시총 1~500위를 CoinGecko 원본 형식(우리가 쓰는 필드만) 배열로 반환.
// 1순위: 워커 프록시(/cg/markets, 엣지 캐시라 429 거의 없음). 실패 시 CoinGecko 직접(250개씩 2페이지).
async function fetchGeckoMarkets(){
  try{
    // 60초 단위 캐시 버킷을 쿼리에 붙인다. 클라우드플레어가 엣지 캐시에서 나간 응답의
    // cache-control을 존 설정값(max-age=14400)으로 덮어쓰기 때문에, 버킷이 없으면
    // 브라우저가 그 응답을 최대 4시간 재사용해 시세가 멈춘다. (/cmc/krw도 같은 이유로 버킷 사용)
    const r = await fetch(CG_MARKETS_PROXY + "?t=" + Math.floor(Date.now() / 60000));
    if(r.ok){
      const rows = await r.json();
      if(Array.isArray(rows) && rows.length) return rows;
    }
  }catch(e){ /* 프록시 미배포/오류 → 직접 호출로 폴백 */ }
  const [p1, p2] = await Promise.allSettled([fetchGeckoPage(1), fetchGeckoPage(2)]);
  if(p1.status !== "fulfilled") throw (p1.reason instanceof Error ? p1.reason : new Error("gecko page1 실패"));
  return p2.status === "fulfilled" ? p1.value.concat(p2.value) : p1.value;
}

// 갱신 주기가 짧아도 호출이 몰리지 않도록 GECKO_TTL 동안 직전 결과를 재사용(시세 목록은 몇 초 늦어도 무방).
let geckoCache = { data: null, at: 0 };
const GECKO_TTL = 60000;

export async function loadFromGecko(){
  if(geckoCache.data && Date.now() - geckoCache.at < GECKO_TTL) return geckoCache.data.slice();
  const rows = await fetchGeckoMarkets();
  const seen = new Set();
  const mapped = [];
  for(const c of rows){
    const short = (c.symbol || "").toUpperCase();
    const id = short + "USDT";
    if(!short || seen.has(id)) continue; // 심볼이 겹치는 마이너 코인은 시총 상위(먼저 나온) 것만
    seen.add(id);
    mapped.push({
      id,
      symbol: c.symbol,
      name: NAME_MAP[short] || c.name,
      enName: c.name, // 한글 이름(NAME_MAP)으로 name을 덮어써도 영문 이름으로 검색할 수 있게 따로 보관
      current_price: c.current_price,
      price_change_percentage_24h: c.price_change_percentage_24h,
      rank: c.market_cap_rank || null,
      marketCap: c.market_cap ?? null, // 달러 기준 시가총액 — 코인 상세 페이지 카드
      image: c.image || null, // 표 왼쪽 로고. 워커가 image를 안 내려주면 심볼 기준 아이콘으로 대체된다.
      // 등락률 아래 24시간 범위 바에 사용. 거래소에 상장된 코인은 곧바로
      // applyExchangeTickers()가 실시간 값으로 덮어쓰고, 여기 값은 그 외 코인용.
      high_24h: c.high_24h ?? null,
      low_24h: c.low_24h ?? null
    });
  }
  geckoCache = { data: mapped, at: Date.now() };
  return mapped.slice();
}

export async function loadFromBinance(){
  const res = await fetch(`${BINANCE}/ticker/24hr`);
  if(!res.ok) throw new Error("binance http " + res.status);
  const all = await res.json();
  const usdt = all.filter(t =>
    t.symbol.endsWith("USDT") &&
    !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol) &&
    parseFloat(t.quoteVolume) > 0
  );
  usdt.sort((a,b)=> parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
  return usdt.slice(0,500).map((t,idx)=>{
    const short = t.symbol.replace("USDT","");
    return {
      id: t.symbol,
      symbol: short.toLowerCase(),
      name: NAME_MAP[short] || short,
      current_price: parseFloat(t.lastPrice),
      price_change_percentage_24h: parseFloat(t.priceChangePercent),
      rank: idx+1, // 시총 데이터를 못 가져왔을 때의 임시 순위(거래대금 기준)
      high_24h: parseFloat(t.highPrice),
      low_24h: parseFloat(t.lowPrice)
    };
  });
}

// ---------- 해외 거래소(코인베이스/크라켄/바이낸스) ----------
async function fetchBinanceMap(){
  const res = await fetch(`${BINANCE}/ticker/24hr`);
  if(!res.ok) throw new Error("binance http " + res.status);
  const all = await res.json();
  const map = {};
  all.forEach(t=>{ if(t.symbol.endsWith("USDT")) map[t.symbol] = t; });
  return map;
}

// 바이낸스 24시간 티커 맵을 짧게 캐시해서 여러 곳(검색 가격 채우기 등)에서 재사용
let binanceMapCache = { data: null, at: 0 };
const BINANCE_MAP_TTL = 30000;
export async function getBinanceMap(){
  if(binanceMapCache.data && Date.now() - binanceMapCache.at < BINANCE_MAP_TTL) return binanceMapCache.data;
  try{
    const m = await fetchBinanceMap();
    binanceMapCache = { data: m, at: Date.now() };
    return m;
  }catch(e){ return binanceMapCache.data || {}; }
}

export async function fetchCoinbaseRates(){
  try{
    const res = await fetch("https://api.coinbase.com/v2/exchange-rates?currency=USD");
    if(!res.ok) return {};
    const data = await res.json();
    return (data.data && data.data.rates) || {};
  }catch(e){ return {}; }
}

// 심볼 -> 크라켄 USD 페어 키 매핑을 최초 1회만 만들어 캐싱
async function getKrakenPairMap(){
  if(state.krakenPairMap) return state.krakenPairMap;
  try{
    const res = await fetch("https://api.kraken.com/0/public/AssetPairs");
    const data = await res.json();
    const map = {};
    Object.entries(data.result || {}).forEach(([key, info])=>{
      if(!info.wsname) return;
      const parts = info.wsname.split("/");
      if(parts[1] !== "USD") return;
      let sym = parts[0].toUpperCase();
      if(sym === "XBT") sym = "BTC";
      if(sym === "XDG") sym = "DOGE";
      map[sym] = key;
    });
    state.krakenPairMap = map;
  }catch(e){
    state.krakenPairMap = {};
  }
  return state.krakenPairMap;
}

export async function fetchKrakenPricesFor(symbolsUpper){
  const map = await getKrakenPairMap();
  const pairs = [...new Set(symbolsUpper.map(s=>map[s]).filter(Boolean))];
  if(pairs.length === 0) return {};
  try{
    const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pairs.join(",")}`);
    if(!res.ok) return {};
    const data = await res.json();
    const reverse = {};
    Object.entries(map).forEach(([sym,key])=>{ reverse[key] = sym; });
    const out = {};
    Object.entries(data.result || {}).forEach(([key, tick])=>{
      const sym = reverse[key];
      if(sym && tick.c && tick.c[0]) out[sym] = parseFloat(tick.c[0]);
    });
    return out;
  }catch(e){ return {}; }
}

// 코인베이스/크라켄/바이낸스 3사 평균을 "가격(USD)"으로 사용
// OKX/Bybit 맵의 값 형식: { price, chg, high, low } — 심볼(대문자) 기준.
// 가격 평균 계산에는 price만 쓰고, 나머지는 시세 탭 목록을 거래소 실시간 값으로
// 덮어쓸 때(applyExchangeTickers) 함께 사용한다.
// OKX/바이빗 맵도 바이낸스처럼 짧게 캐시한다. 한 갱신 주기 안에서
// applyExchangeTickers(시세 목록)와 enrichIntlPrices(관심 코인)가 각각 부르기 때문에,
// 캐시가 없으면 같은 데이터를 주기마다 두 번씩 받아오게 된다.
const EX_MAP_TTL = 30000;
let okxMapCache = { data: null, at: 0 };
let bybitMapCache = { data: null, at: 0 };

// OKX: 스팟 전체 티커를 한 번에 반환 (instId 형식 예: BTC-USDT)
export async function fetchOkxMap(){
  if(okxMapCache.data && Date.now() - okxMapCache.at < EX_MAP_TTL) return okxMapCache.data;
  try{
    const res = await fetch("https://www.okx.com/api/v5/market/tickers?instType=SPOT");
    if(!res.ok) return {};
    const data = await res.json();
    const out = {};
    (data.data || []).forEach(t=>{
      if(t.instId && t.instId.endsWith("-USDT") && t.last){
        const price = parseFloat(t.last);
        const open = parseFloat(t.open24h);
        out[t.instId.replace("-USDT","")] = {
          price,
          chg: open > 0 ? ((price - open) / open) * 100 : null, // OKX는 등락률 대신 24시간 시가를 준다
          high: parseFloat(t.high24h),
          low: parseFloat(t.low24h)
        };
      }
    });
    okxMapCache = { data: out, at: Date.now() };
    return out;
  }catch(e){ return okxMapCache.data || {}; }
}

// Bybit: 스팟 전체 티커를 한 번에 반환 (symbol 형식 예: BTCUSDT)
export async function fetchBybitMap(){
  if(bybitMapCache.data && Date.now() - bybitMapCache.at < EX_MAP_TTL) return bybitMapCache.data;
  try{
    const res = await fetch("https://api.bybit.com/v5/market/tickers?category=spot");
    if(!res.ok) return {};
    const data = await res.json();
    const out = {};
    (data.result && data.result.list || []).forEach(t=>{
      if(t.symbol && t.symbol.endsWith("USDT") && t.lastPrice){
        const pcnt = parseFloat(t.price24hPcnt); // 비율(0.0123 = +1.23%)
        out[t.symbol.replace("USDT","")] = {
          price: parseFloat(t.lastPrice),
          chg: isNaN(pcnt) ? null : pcnt * 100,
          high: parseFloat(t.highPrice24h),
          low: parseFloat(t.lowPrice24h)
        };
      }
    });
    bybitMapCache = { data: out, at: Date.now() };
    return out;
  }catch(e){ return bybitMapCache.data || {}; }
}

// ---------- 국내 거래소(업비트/빗썸/코인원) ----------
// 업비트는 브라우저(Origin 헤더가 붙은) 요청을 아주 작은 한도로 묶고 넘으면 CORS 헤더 없는
// 429를 주고, 코인원은 CORS 헤더가 아예 없다 → 둘 다 워커를 거쳐 부른다.
// 워커가 KRW 마켓 전체를 {심볼: 원화가}로 주므로 그 키가 곧 상장 목록이다. 빗썸만 직접 부른다.
const proxyMapCache = {};
async function getProxyMap(route){
  const hit = proxyMapCache[route];
  if(hit && Date.now() - hit.at < EX_MAP_TTL) return hit.data;
  try{
    const res = await fetch(`${API_BASE}/${route}?t=${Math.floor(Date.now() / 5000)}`);
    if(!res.ok) throw new Error(route + " proxy http " + res.status);
    const data = await res.json();
    proxyMapCache[route] = { data, at: Date.now() };
    return data;
  }catch(e){ return (hit && hit.data) || {}; }
}

function pickPrices(map, symbolsUpper){
  const out = {};
  symbolsUpper.forEach(s=>{ if(map[s] != null) out[s] = map[s]; });
  return out;
}

export async function fetchUpbitPricesFor(symbolsUpper){
  return pickPrices(await getProxyMap("upbit/krw"), symbolsUpper);
}
export async function fetchCoinonePricesFor(symbolsUpper){
  return pickPrices(await getProxyMap("coinone/krw"), symbolsUpper);
}

// 비트플라이어(일본): 엔화 마켓뿐이라 워커가 달러로 환산해 준다 → 해외 거래소(exUsd)와 같은 취급.
// CORS 헤더가 없어 역시 워커를 거친다.
export async function fetchBitflyerPricesFor(symbolsUpper){
  return pickPrices(await getProxyMap("bitflyer/usd"), symbolsUpper);
}

export async function fetchBithumbPrices(){
  try{
    const res = await fetch("https://api.bithumb.com/public/ticker/ALL_KRW");
    if(!res.ok) return {};
    const data = await res.json();
    const out = {};
    Object.entries(data.data || {}).forEach(([sym, v])=>{
      if(sym === "date" || !v || !v.closing_price) return;
      out[sym.toUpperCase()] = parseFloat(v.closing_price);
    });
    return out;
  }catch(e){ return {}; }
}

// USD/KRW 환율을 최초 1회만 가져와 캐싱(프리미엄 계산, 나의 거래소 환산에 공용으로 사용)
export async function fetchUsdKrw(){
  const sources = [
    // 1) 워커 경유 야후 KRW=X. 그래프(/fx/history)와 같은 출처라 헤더 숫자와 그래프 끝점이
    //    어긋나지 않는다 — 이게 폴백으로 밀리면 그만큼 두 값이 벌어질 수 있다.
    async ()=>{
      const r = await fetch(`${FX_RATE_PROXY}?t=${Math.floor(Date.now() / 60000)}`);
      if(!r.ok) return null;
      const d = await r.json();
      // 전일 종가 — 헤더 띠의 "전일 대비" 등락률. 이 출처만 준다(폴백들은 현재가뿐이라 그땐 비운다).
      state.usdKrwPrev = d && d.prev > 0 ? d.prev : null;
      return d && d.rate;
    },
    // 2) manana.kr — 야후 USD/KRW를 그대로 중계하는 제3자. 워커가 막혔을 때의 폴백.
    async ()=>{
      const r = await fetch("https://api.manana.kr/exchange/rate/USD/KRW.json");
      const d = await r.json();
      const row = Array.isArray(d) ? d[0] : d;
      if(!row || !(row.rate > 0)) return null;
      // name이 "KRWUSD=X"면 rate가 1KRW당 USD값 → 뒤집어야 원/달러가 됨. "USDKRW=X"면 그대로.
      if(/^KRWUSD/i.test(row.name || "")) return 1 / row.rate;
      if(/^USDKRW/i.test(row.name || "")) return row.rate;
      return row.rate < 0.1 ? 1 / row.rate : row.rate; // 이름을 못 읽으면 값 크기로 방향 추정
    },
    // 3) frankfurter (ECB 참고환율, 영업일 1회 고시) — 실시간보다 몇 원 벌어질 수 있는 폴백
    async ()=>{
      const r = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW");
      const d = await r.json();
      return d.rates && d.rates.KRW;
    },
    // 4) open.er-api (일 1회 갱신) — 마지막 폴백
    async ()=>{
      const r = await fetch("https://open.er-api.com/v6/latest/USD");
      const d = await r.json();
      return d.rates && d.rates.KRW;
    }
  ];
  for(const src of sources){
    try{
      const rate = await src();
      if(rate && isFinite(rate) && rate > 0) return rate;
    }catch(e){ /* 다음 소스로 시도 */ }
  }
  return null;
}

// 원/달러 환율의 추이. 헤더 환율 버튼 -> 그래프에서만 쓴다.
// 반환: { source:"출처 표시용", interval:"5분"|"1시간"|"1일", points:[{t:<unix초>, v:1389}, ...] }
// points는 오래된 -> 최신 순. 실패하면 null.
export async function fetchFxHistory(days){
  // 1) 워커 경유. 1일은 5분봉, 나머지는 1시간봉이라 선이 촘촘하다.
  //    (야후·네이버 모두 CORS를 안 줘서 브라우저에서 직접은 못 부른다)
  try{
    const bucket = days === 1 ? 120000 : 600000; // 워커 캐시 주기와 맞춘 캐시 무력화 버킷
    const r = await fetch(`${FX_HISTORY_PROXY}?days=${days}&t=${Math.floor(Date.now() / bucket)}`);
    if(r.ok){
      const j = await r.json();
      if(j && Array.isArray(j.points) && j.points.length > 1){
        return {
          source: FX_SOURCE_LABEL[j.source] || j.source,
          interval: j.interval || "",
          points: j.points
        };
      }
    }
  }catch(e){ /* 폴백으로 */ }

  // 2) frankfurter(ECB 참고환율) — 워커가 아직 배포 전이거나 막혔을 때의 폴백.
  //    CORS가 열려 있어 브라우저에서 직접 부를 수 있지만 영업일 1회 고시라,
  //    하루 안을 들여다보는 1일 구간에서는 점이 한두 개뿐이라 쓸 수 없다.
  if(days >= 30){
    try{
      const end = new Date();
      const start = new Date(end.getTime() - days * 86400000);
      const iso = d => d.toISOString().slice(0, 10);
      const r = await fetch(`https://api.frankfurter.dev/v1/${iso(start)}..${iso(end)}?base=USD&symbols=KRW`);
      const d = await r.json();
      const points = Object.entries((d && d.rates) || {})
        .map(([day, o]) => ({ t: Date.parse(day + "T00:00:00+09:00") / 1000, v: o && o.KRW }))
        .filter(pt => pt.v > 0 && !isNaN(pt.t))
        .sort((a, b) => a.t - b.t);
      if(points.length > 1) return { source: "ECB 참고환율", interval: "1일", points };
    }catch(e){ /* 아래에서 null */ }
  }

  return null;
}

// 국내 거래소에 없는 코인의 원화 시세를 CoinMarketCap(프록시 경유)에서 받아 메꿈용으로 보관.
// 10분 단위 캐시 버킷을 쿼리에 붙여 브라우저/CDN 캐시가 그 주기로만 갱신되게 함(워커도 10분 캐시 → CMC 크레딧 절약).
export async function fetchCmcKrw(){
  const res = await fetch(CMC_PROXY + "?t=" + Math.floor(Date.now() / 600000));
  if(!res.ok) return null;
  const j = await res.json();
  if(!j || !j.data) return null;
  const m = {};
  for(const [sym, v] of Object.entries(j.data)){
    if(v && typeof v.krw === "number") m[sym] = v.krw;
  }
  return m;
}

// ---------- 코인 캔들(차트용) ----------
// 어느 거래소에서 받든 { t:<unix초>, o,h,l,c, v } 배열(오래된 -> 최신)로 맞춰서 돌려준다.
// v는 거래량(코인 개수 기준). 거래소마다 단위가 같도록 원화·달러 거래대금이 아니라 수량을 쓴다.
// 거래소마다 정렬 방향과 필드 순서가 제각각이라 어댑터를 하나씩 둔다.
const CANDLE_FETCHERS = {
  // 바이낸스: 오래된 -> 최신, [openTime(ms), o, h, l, c, 거래량, ...]
  async binance(sym, spec){
    const r = await fetch(`${BINANCE}/klines?symbol=${sym}USDT&interval=${spec.i}&limit=${spec.n}`);
    if(!r.ok) return null;
    const rows = await r.json();
    return rows.map(k => ({ t: k[0] / 1000, o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  },
  // OKX: 최신 -> 오래된, [ts(ms), o, h, l, c, 거래량, ...]
  async okx(sym, spec){
    const r = await fetch(`https://www.okx.com/api/v5/market/candles?instId=${sym}-USDT&bar=${spec.i}&limit=${spec.n}`);
    if(!r.ok) return null;
    const j = await r.json();
    return (j.data || []).map(k => ({ t: +k[0] / 1000, o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })).reverse();
  },
  // 바이빗: 최신 -> 오래된, [start(ms), o, h, l, c, 거래량, ...]
  async bybit(sym, spec){
    const r = await fetch(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${sym}USDT&interval=${spec.i}&limit=${spec.n}`);
    if(!r.ok) return null;
    const j = await r.json();
    return ((j.result && j.result.list) || []).map(k => ({ t: +k[0] / 1000, o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })).reverse();
  },
  // 크라켄: 오래된 -> 최신, [time(초), o, h, l, c, vwap, 거래량, 체결수]. 달러(USD) 페어라
  // 테더처럼 ○○/USDT 페어가 있을 수 없는 코인도 USDT/USD로 받을 수 있다.
  // 결과 키가 요청한 이름과 다르다(USDTUSD -> USDTZUSD, XBTUSD -> XXBTZUSD) — 첫 키를 쓴다.
  async kraken(sym, spec){
    const pair = (KRAKEN_ALIAS[sym] || sym) + "USD";
    const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${spec.i}`);
    if(!r.ok) return null;
    const j = await r.json();
    if(!j || (j.error && j.error.length) || !j.result) return null;
    const rows = j.result[Object.keys(j.result).find(k => k !== "last")];
    if(!Array.isArray(rows)) return null;
    return rows.slice(-spec.n).map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[6] }));
  },
  // 업비트: 최신 -> 오래된, 객체. 값은 원화라 quote가 KRW가 된다
  async upbit(sym, spec){
    const r = await fetch(`${UPBIT_CANDLES_PROXY}?unit=${spec.p}&market=KRW-${sym}&count=${spec.n}`);
    if(!r.ok) return null;
    const rows = await r.json();
    if(!Array.isArray(rows)) return null;
    return rows.map(k => ({
      t: Date.parse(k.candle_date_time_utc + "Z") / 1000,
      o: k.opening_price, h: k.high_price, l: k.low_price, c: k.trade_price, v: k.candle_acc_trade_volume
    })).reverse();
  },
  // 빗썸: 오래된 -> 최신, [ts(ms), 시가, 종가, 고가, 저가, 거래량] — 고저가 자리가 다른 곳과 다르다.
  // 개수 지정이 없어 전체 이력을 주므로 뒤에서 필요한 만큼만 잘라 쓴다.
  async bithumb(sym, spec){
    const r = await fetch(`https://api.bithumb.com/public/candlestick/${sym}_KRW/${spec.i}`);
    if(!r.ok) return null;
    const j = await r.json();
    if(j.status !== "0000" || !Array.isArray(j.data)) return null;
    const rows = j.data.slice(-spec.n).map(k => ({ t: +k[0] / 1000, o: +k[1], c: +k[2], h: +k[3], l: +k[4], v: +k[5] }));
    return spec.week ? toWeekly(rows) : rows;
  }
};

// 일봉 -> 주봉. 다른 거래소 주봉과 같게 월요일(UTC) 시작으로 끊는다.
// 1970-01-01이 목요일이라 4일을 빼면 월요일 기준 주 번호가 된다.
function toWeekly(days){
  const out = [];
  let cur = null, curWeek = null;
  for(const k of days){
    const week = Math.floor((k.t - 4 * 86400) / (7 * 86400));
    if(week !== curWeek){
      cur = { t: week * 7 * 86400 + 4 * 86400, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v || 0 };
      curWeek = week;
      out.push(cur);
    }else{
      cur.h = Math.max(cur.h, k.h);
      cur.l = Math.min(cur.l, k.l);
      cur.c = k.c;
      cur.v += k.v || 0;
    }
  }
  return out;
}

const CANDLE_QUOTE = { binance:"USD", okx:"USD", bybit:"USD", kraken:"USD", upbit:"KRW", bithumb:"KRW" };
// 크라켄은 몇몇 코인을 옛 이름으로 부른다
const KRAKEN_ALIAS = { BTC: "XBT", DOGE: "XDG" };

// 그 코인이 실제로 거래되는 곳만, 시세 탭과 같은 우선순위로 훑는다.
// (거래소 정보가 아직 없으면 바이낸스부터 순서대로 찔러본다)
function candleSourcesFor(c){
  const ex = c.exUsd || {}, dom = c.domestic || {};
  const known = [];
  if(ex.binance)  known.push("binance");
  if(ex.okx)      known.push("okx");
  if(ex.bybit)    known.push("bybit");
  if(ex.kraken)   known.push("kraken");
  if(dom.upbit)   known.push("upbit");
  if(dom.bithumb) known.push("bithumb");
  // 테더 자신은 ○○/USDT 페어가 있을 수 없다(USDTUSDT) — 달러 페어(크라켄 USDT/USD)를 맨 앞에
  if((c.symbol || "").toUpperCase() === "USDT") known.unshift("kraken");
  // 보강 전이라 거래소를 모를 때도 차트가 비지 않도록 나머지를 뒤에 붙인다
  const all = ["binance","okx","bybit","kraken","upbit","bithumb"];
  return [...new Set(known)].concat(all.filter(s => !known.includes(s)));
}

// 반환: { source:"binance", quote:"USD"|"KRW", candles:[...] } — 전부 실패하면 null
// 같은 코인·기간을 여러 곳(차트, 52주 카드, 기술적 지표)이 거의 동시에 부르므로 잠깐 같은 결과를 나눠 쓴다.
// 55초 — 차트의 "봉이 새로 생겼으면 다시 받기"(최소 60초 간격)를 가로막지 않는 선.
const candleMemo = new Map(); // "SYM:days" -> { at, promise }
const CANDLE_MEMO_MS = 55000;

export function fetchCoinCandles(c, days){
  const key = (c.symbol || "").toUpperCase() + ":" + days;
  const hit = candleMemo.get(key);
  if(hit && Date.now() - hit.at < CANDLE_MEMO_MS) return hit.promise;
  const promise = fetchCoinCandlesFresh(c, days);
  candleMemo.set(key, { at: Date.now(), promise });
  promise.then(res => { if(!res) candleMemo.delete(key); }); // 실패는 붙들지 않는다 — 곧바로 다시 시도할 수 있게
  return promise;
}

async function fetchCoinCandlesFresh(c, days){
  const spec = CANDLE_SPEC[days] || CANDLE_SPEC[1];
  const sym = (c.symbol || "").toUpperCase();
  if(!sym) return null;
  for(const source of candleSourcesFor(c)){
    if(!spec[source]) continue;
    try{
      const candles = await CANDLE_FETCHERS[source](sym, spec[source]);
      // 점이 하나뿐이면 선을 못 그린다 — 상장 직후이거나 심볼이 다른 코인일 수 있으니 다음 거래소로
      if(candles && candles.length > 1 && candles.every(k => k.c > 0)){
        return { source, quote: CANDLE_QUOTE[source], candles };
      }
    }catch(e){ /* 다음 거래소로 */ }
  }
  return null;
}
