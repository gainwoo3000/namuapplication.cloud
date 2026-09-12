import { state } from "./state.js";
import { fmtChg } from "./format.js";
import { getBinanceMap, fetchCoinbaseRates, fetchKrakenPricesFor, fetchOkxMap, fetchBybitMap, fetchUpbitPricesFor, fetchBithumbPrices } from "./api.js";
import { renderGrid, buildCoinsList } from "./watchlist.js";
import { renderPortfolio } from "./portfolio.js";
import { updateChartPrice } from "./chart.js";

// 사용자가 고른 국내 거래소들의 평균가(KRW)를 계산. 데이터가 하나도 없으면 null
// 코인 c의 가격을 exchangeSet(Set 또는 배열)에 담긴 거래소들의 원화(KRW) 평균으로 계산. 데이터가 없으면 null
export function exchangeAvgFor(c, exchangeSet){
  const set = exchangeSet instanceof Set ? exchangeSet : new Set(exchangeSet);
  const vals = [];
  if(c.domestic){
    if(set.has("upbit") && c.domestic.upbit) vals.push(c.domestic.upbit);
    if(set.has("bithumb") && c.domestic.bithumb) vals.push(c.domestic.bithumb);
  }
  // 해외 거래소는 실시간 환율(usdKrw)로 원화 환산해서 같이 평균낸다
  if(c.exUsd && state.usdKrw){
    if(set.has("binance") && c.exUsd.binance) vals.push(c.exUsd.binance * state.usdKrw);
    if(set.has("okx") && c.exUsd.okx) vals.push(c.exUsd.okx * state.usdKrw);
    if(set.has("bybit") && c.exUsd.bybit) vals.push(c.exUsd.bybit * state.usdKrw);
    if(set.has("coinbase") && c.exUsd.coinbase) vals.push(c.exUsd.coinbase * state.usdKrw);
    if(set.has("kraken") && c.exUsd.kraken) vals.push(c.exUsd.kraken * state.usdKrw);
  }
  if(vals.length === 0) return null;
  return vals.reduce((a,b)=>a+b,0) / vals.length;
}

export function myExchangeAvg(c){
  return exchangeAvgFor(c, state.myExchanges);
}

// "나의 거래소" 표시값(KRW). 고른 거래소 중 어디에도 데이터가 없으면(업비트 미상장 등)
// 1순위: CoinMarketCap 원화가(프록시 경유), 2순위: CoinGecko USD가×환율 추정.
// 둘 다 실제 "국내 거래소" 체결가는 아니라서 est:true로 표시(≈)한다.
export function myExchangeValue(c){
  const real = myExchangeAvg(c);
  if(real !== null) return { krw: real, est: false };
  const sym = c.symbol.toUpperCase();
  if(state.cmcKrwMap[sym] != null) return { krw: state.cmcKrwMap[sym], est: true };
  if(c.current_price != null && !isNaN(c.current_price) && state.usdKrw){
    return { krw: c.current_price * state.usdKrw, est: true };
  }
  return { krw: null, est: false };
}

// ---------- 김치 프리미엄 ----------
// 프리미엄 = (나의 거래소 원화가 − 시세기준가×환율) / (시세기준가×환율) × 100.
// 시세 탭 "나의 거래소" 셀 하단에 회색으로 함께 표시된다.
export function premiumPct(c, myxVal){
  if(myxVal === null || myxVal === undefined || !state.usdKrw) return null;
  const intlKrw = c.current_price * state.usdKrw;
  if(!intlKrw) return null;
  return ((myxVal - intlKrw) / intlKrw) * 100;
}

// 시세 탭 "나의 거래소" 셀 하단에 붙는 김치 프리미엄 텍스트. 실제 국내 체결가가 있을 때만(추정가 제외) 표시.
export function myxPremiumText(c, myx){
  if(!myx || myx.krw === null || myx.est) return "";
  const pct = premiumPct(c, myx.krw);
  if(pct === null) return "";
  return fmtChg(pct);
}

// 이 포트폴리오에서 고른 거래소 기준 가격을 USD로 반환(내부 계산은 USD 기준으로 통일). 데이터 없으면 null
export function pfCoinPriceUsd(c, exchangeSet){
  const krw = exchangeAvgFor(c, exchangeSet);
  if(krw !== null && state.usdKrw) return krw / state.usdKrw;
  return null;
}

// 바이낸스/OKX/바이빗/코인베이스/크라켄 5사 평균을 "가격(USD)"으로 사용
// 현재 필터(intlExchangeFilter)에 맞춰 5개 해외 거래소 중 선택된 것만으로 평균을 계산.
// 필터가 비어있으면(=5개 평균 모드) 전부 사용. 선택된 거래소에 값이 하나도 없으면 5개 전체 평균으로, 그마저 없으면 기준가로 대체.
export function intlPriceAvg(c){
  if(!c.exUsd) return c.baseUsdPrice != null ? c.baseUsdPrice : c.current_price;
  const entries = [
    ["coinbase", c.exUsd.coinbase], ["kraken", c.exUsd.kraken], ["binance", c.exUsd.binance],
    ["okx", c.exUsd.okx], ["bybit", c.exUsd.bybit]
  ];
  const filtered = state.intlExchangeFilter.size === 0 ? entries : entries.filter(([k])=>state.intlExchangeFilter.has(k));
  let vals = filtered.map(([,v])=>v).filter(v => v && isFinite(v) && v > 0);
  if(vals.length === 0){
    vals = entries.map(([,v])=>v).filter(v => v && isFinite(v) && v > 0); // 선택한 거래소에 값이 없으면 전체 평균으로 대체
  }
  if(vals.length === 0) return c.baseUsdPrice != null ? c.baseUsdPrice : c.current_price;
  return vals.reduce((a,b)=>a+b,0) / vals.length;
}

export async function enrichIntlPrices(list){
  const symbolsUpper = list.map(c=>c.symbol.toUpperCase());
  const [binanceMap, coinbaseRates, krakenMap, okxMap, bybitMap] = await Promise.all([
    getBinanceMap(),
    fetchCoinbaseRates(),
    fetchKrakenPricesFor(symbolsUpper),
    fetchOkxMap(),
    fetchBybitMap()
  ]);
  return list.map(c=>{
    const sym = c.symbol.toUpperCase();
    const bin = binanceMap[c.id] ? parseFloat(binanceMap[c.id].lastPrice) : null;
    const cbRate = coinbaseRates[sym] ? parseFloat(coinbaseRates[sym]) : null;
    const cb = (cbRate && cbRate > 0) ? 1/cbRate : null;
    const kr = krakenMap[sym] || null;
    const okx = okxMap[sym] || null;
    const bybit = bybitMap[sym] || null;
    const chg = binanceMap[c.id] ? parseFloat(binanceMap[c.id].priceChangePercent) : c.price_change_percentage_24h;
    // 등락률 아래 범위 바용 24시간 고저가. 가격을 거래소에서 가져오므로 고저가도 바이낸스 값을 우선.
    const t = binanceMap[c.id];
    const binHi = t ? parseFloat(t.highPrice) : null;
    const binLo = t ? parseFloat(t.lowPrice) : null;
    const useBin = binHi > binLo;
    const withEx = {...c, baseUsdPrice: c.current_price, price_change_percentage_24h: chg,
      high_24h: useBin ? binHi : c.high_24h, low_24h: useBin ? binLo : c.low_24h,
      exUsd:{ coinbase: cb, kraken: kr, binance: bin, okx, bybit }};
    withEx.current_price = intlPriceAvg(withEx);
    return withEx;
  });
}

// 시세 탭 목록(allTickers)에 24시간 고저가가 비어 있으면(워커 프록시 구버전) 바이낸스 티커로 메꾼다.
// 바뀐 게 있으면 true — 호출부에서 그때만 다시 그리도록.
export async function fillRange24h(list){
  const need = list.filter(c => !(c.high_24h > c.low_24h));
  if(need.length === 0) return false;
  const map = await getBinanceMap();
  let filled = 0;
  for(const c of need){
    const t = map[c.id];
    if(!t) continue;
    const hi = parseFloat(t.highPrice), lo = parseFloat(t.lowPrice);
    if(hi > lo){ c.high_24h = hi; c.low_24h = lo; filled++; }
  }
  return filled > 0;
}

// 필터가 바뀌었을 때 새로 API를 호출하지 않고 캐시된 거래소별 시세로 즉시 재계산
export function reapplyIntlFilter(){
  Object.keys(state.enrichedCache).forEach(id=>{
    const e = state.enrichedCache[id];
    if(e && e.exUsd){
      e.current_price = intlPriceAvg(e);
    }
  });
  state.coinsList = buildCoinsList();
  renderGrid();
  renderPortfolio();
  updateChartPrice();
}

export async function enrichDomesticPrices(list){
  const symbolsUpper = list.map(c=>c.symbol.toUpperCase());
  const [upbitMap, bithumbMap] = await Promise.all([
    fetchUpbitPricesFor(symbolsUpper),
    fetchBithumbPrices()
  ]);
  return list.map(c=>{
    const sym = c.symbol.toUpperCase();
    return {...c, domestic:{
      upbit: upbitMap[sym] || null,
      bithumb: bithumbMap[sym] || null
    }};
  });
}
