import { GECKO, CG_SEARCH_PROXY, ALIAS_MAP } from "./constants.js";
import { state } from "./state.js";
import { getBinanceMap } from "./api.js";

// 로컬 풀(state.allTickers) 코인 하나가 대문자 검색어 q(예: "SOLANA")와 일치하는지.
// 심볼/이름(한글로 덮어썼을 수 있음)/영문 원본 이름(enName)/수동 별칭(ALIAS_MAP) 순으로 확인.
export function matchesLocalQuery(c, q){
  if(c.symbol.toUpperCase().includes(q)) return true;
  if((c.name || "").toUpperCase().includes(q)) return true;
  if((c.enName || "").toUpperCase().includes(q)) return true;
  const aliases = ALIAS_MAP[c.symbol.toUpperCase()];
  return !!aliases && aliases.some(a => a.toUpperCase().includes(q));
}

// 검색 결과 원소 하나 → 시세 목록에 끼워넣을 코인 형태
function makeSearchCoin(o){
  const short = (o.symbol || "").toUpperCase();
  return {
    id: short + "USDT",
    symbol: (o.symbol || "").toLowerCase(),
    name: o.name || short,
    current_price: (o.price ?? o.current_price ?? null),
    price_change_percentage_24h: (o.change24h ?? o.price_change_percentage_24h ?? null),
    rank: (o.rank ?? o.market_cap_rank ?? null),
    searchOnly: true
  };
}

// 같은 티커(SYMBOL)로 여러 코인이 잡히면 시총 순위가 가장 높은 것만 남긴다.
// (어차피 목록은 SYMBOL+USDT id로 한 줄만 그리므로, 대표 코인이 남도록)
export function dedupeSearchBySymbol(coins){
  const best = new Map();
  for(const c of coins){
    const key = c.id;
    const cur = best.get(key);
    const r = c.rank == null ? Infinity : c.rank;
    if(!cur || r < (cur.rank == null ? Infinity : cur.rank)) best.set(key, c);
  }
  // 관련도 순서를 유지하면서 티커별 대표만 남긴다
  return coins.filter(c => best.get(c.id) === c);
}

// 바이낸스·바이빗 스팟 USDT 티커(심볼 -> {price, chg%})를 짧게 캐시.
// 검색 결과 중 CoinGecko가 가격을 안 준 코인의 가격/등락률을 여기서 메꾼다.
let exFillCache = { at: 0, map: {} };
const EX_FILL_TTL = 30000;
async function getExFillMap(){
  if(Date.now() - exFillCache.at < EX_FILL_TTL && Object.keys(exFillCache.map).length) return exFillCache.map;
  const map = {};
  const put = (sym, price, chg) => {
    if(!sym || !(price > 0) || map[sym]) return;
    map[sym] = { price, chg: (chg == null || isNaN(chg)) ? null : chg };
  };
  await Promise.all([
    getBinanceMap().then(b => { for(const k in b){ const t = b[k];
      put(k.replace(/USDT$/, ""), parseFloat(t.lastPrice), parseFloat(t.priceChangePercent)); } }).catch(()=>{}),
    fetch("https://api.bybit.com/v5/market/tickers?category=spot").then(r => r.ok ? r.json() : null).then(d => {
      (d && d.result && d.result.list || []).forEach(t => { if(t.symbol && t.symbol.endsWith("USDT"))
        put(t.symbol.replace(/USDT$/, ""), parseFloat(t.lastPrice), parseFloat(t.price24hPcnt) * 100); });
    }).catch(()=>{})
  ]);
  if(Object.keys(map).length) exFillCache = { at: Date.now(), map };
  return exFillCache.map;
}

// 가격/등락률이 비어 있는 검색 결과를 거래소 티커로 채운다.
// 티커가 겹치는 무명 코인에 엉뚱한 가격이 붙지 않도록, 시총 순위가 어느 정도 있는 코인만 채운다.
async function fillSearchPrices(coins){
  const need = coins.filter(c => (c.current_price == null || c.price_change_percentage_24h == null)
    && c.rank != null && c.rank <= 2500);
  if(need.length === 0) return coins;
  const ex = await getExFillMap();
  for(const c of need){
    const t = ex[(c.symbol || "").toUpperCase()];
    if(!t) continue;
    if(c.current_price == null) c.current_price = t.price;
    if(c.price_change_percentage_24h == null && t.chg != null) c.price_change_percentage_24h = t.chg;
  }
  return coins;
}

// 시총 500위 밖 코인까지 이름/심볼로 검색.
// 1순위: 워커 프록시(/cg/search — 엣지 캐시 + 항상 CORS + 가격·순위 포함).
// 2순위: CoinGecko 직접(/search 1콜). 어느 쪽이든 가격이 비면 거래소(바이낸스·바이빗) 티커로 채운다.
export async function searchExternalCoins(query){
  let coins = null;
  try{
    const r = await fetch(`${CG_SEARCH_PROXY}?q=${encodeURIComponent(query)}`);
    if(r.ok){
      const arr = (await r.json()).coins || [];
      if(arr.length) coins = arr.map(makeSearchCoin);
    }
  }catch(e){ /* 프록시 미배포/오류 → 직접 호출로 폴백 */ }
  if(!coins){
    try{
      const res = await fetch(`${GECKO}/search?query=${encodeURIComponent(query)}`);
      if(res.ok) coins = ((await res.json()).coins || []).slice(0, 12).map(makeSearchCoin);
    }catch(e){ /* 무시 */ }
  }
  if(!coins || !coins.length) return [];
  return fillSearchPrices(dedupeSearchBySymbol(coins));
}

// 검색 결과(시총 500위 밖이라 기본 풀에 없는 코인)를 가격 풀에 등록해 관심 코인/포트폴리오에 담을 수 있게 한다.
// 이미 같은 심볼로 등록된 코인이 있으면(예: 이전에 다른 화면에서 추가한 적 있음) 그 항목을 재사용.
export function resolveOrCreateSearchCoin(sc){
  let coin = state.allTickers.find(c => c.id === sc.id || c.symbol.toUpperCase() === sc.symbol.toUpperCase());
  if(!coin){
    coin = {
      id: sc.id,
      symbol: sc.symbol,
      name: sc.name,
      current_price: sc.current_price,
      price_change_percentage_24h: sc.price_change_percentage_24h,
      rank: sc.rank || null
    };
    state.allTickers.push(coin);
    state.virtualCoins[coin.id] = coin;
  }
  return coin;
}
