import { BINANCE, GECKO, CMC_PROXY, CG_MARKETS_PROXY, NAME_MAP } from "./constants.js";
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
    const r = await fetch(CG_MARKETS_PROXY);
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
      rank: c.market_cap_rank || null
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
      rank: idx+1 // 시총 데이터를 못 가져왔을 때의 임시 순위(거래대금 기준)
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
// OKX: 스팟 전체 티커를 한 번에 반환 (instId 형식 예: BTC-USDT)
export async function fetchOkxMap(){
  try{
    const res = await fetch("https://www.okx.com/api/v5/market/tickers?instType=SPOT");
    if(!res.ok) return {};
    const data = await res.json();
    const out = {};
    (data.data || []).forEach(t=>{
      if(t.instId && t.instId.endsWith("-USDT") && t.last){
        out[t.instId.replace("-USDT","")] = parseFloat(t.last);
      }
    });
    return out;
  }catch(e){ return {}; }
}

// Bybit: 스팟 전체 티커를 한 번에 반환 (symbol 형식 예: BTCUSDT)
export async function fetchBybitMap(){
  try{
    const res = await fetch("https://api.bybit.com/v5/market/tickers?category=spot");
    if(!res.ok) return {};
    const data = await res.json();
    const out = {};
    (data.result && data.result.list || []).forEach(t=>{
      if(t.symbol && t.symbol.endsWith("USDT") && t.lastPrice){
        out[t.symbol.replace("USDT","")] = parseFloat(t.lastPrice);
      }
    });
    return out;
  }catch(e){ return {}; }
}

// ---------- 국내 거래소(업비트/빗썸/코인원) ----------
async function getUpbitMarketSet(){
  if(state.upbitMarketSet) return state.upbitMarketSet;
  try{
    const res = await fetch("https://api.upbit.com/v1/market/all");
    const data = await res.json();
    state.upbitMarketSet = new Set(
      data.filter(m=>m.market.startsWith("KRW-")).map(m=>m.market.replace("KRW-",""))
    );
  }catch(e){
    state.upbitMarketSet = new Set();
  }
  return state.upbitMarketSet;
}

export async function fetchUpbitPricesFor(symbolsUpper){
  const set = await getUpbitMarketSet();
  const valid = [...new Set(symbolsUpper.filter(s=>set.has(s)))];
  if(valid.length === 0) return {};
  try{
    const markets = valid.map(s=>"KRW-"+s).join(",");
    const res = await fetch(`https://api.upbit.com/v1/ticker?markets=${markets}`);
    if(!res.ok) return {};
    const data = await res.json();
    const out = {};
    data.forEach(t=>{ out[t.market.replace("KRW-","")] = t.trade_price; });
    return out;
  }catch(e){ return {}; }
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
    // 1) manana.kr — 야후 파이낸스 USD/KRW를 그대로 중계. 장중에는 분 단위로 갱신되는 (거의) 실시간가.
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
    // 2) frankfurter (ECB 참고환율, 영업일 1회 고시) — 실시간보다 몇 원 벌어질 수 있는 폴백
    async ()=>{
      const r = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW");
      const d = await r.json();
      return d.rates && d.rates.KRW;
    },
    // 3) open.er-api (일 1회 갱신) — 마지막 폴백
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
