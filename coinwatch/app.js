// 바이낸스를 1순위 소스로 사용 (키 불필요, 요청 한도가 넉넉하고 CORS 허용).
// 바이낸스 응답이 실패하면 CoinGecko(키 없는 공개 API, 분당 호출 제한 있음)로 자동 대체.
const BINANCE = "https://api.binance.com/api/v3";
const GECKO = "https://api.coingecko.com/api/v3";
let coinsList = [];      // 현재 화면에 표시되는 관심 코인 목록(최대 30개)
let allTickers = [];     // 검색/추가용 전체 마켓 풀
let watchlist = [];      // 사용자가 선택한 코인 id 목록 (순서 유지)
let editMode = false;    // 삭제 버튼 표시 여부
let visibleCount = 8;
let selectedCoinId = null;
let intlExchangeFilter = new Set(); // 빈 값 = 5개 해외 거래소 전체 평균, 값이 있으면 그것들만 평균
const EX_LABEL = {binance:"바이낸스", okx:"OKX", bybit:"바이빗", coinbase:"코인베이스", kraken:"크라켄"};
let refreshSec = 30;
let currentDays = 1;
let refreshTimer = null;
let usdKrw = null;
let lastSource = "binance";
let myExchanges = new Set(["upbit","bithumb"]); // "나의 거래소" 평균에 포함할 국내 거래소
let displayCurrency = "usd"; // "usd" | "krw" - 나의 거래소/가격 컬럼 표시 통화
let krakenPairMap = null;    // 심볼 -> 크라켄 페어 키 (최초 1회 캐싱)
let upbitMarketSet = null;   // 업비트에 상장된 심볼 집합 (최초 1회 캐싱)
const enrichedCache = {};    // id -> 마지막으로 보강된 가격/등락률/거래소별 시세
const virtualCoins = {};     // id -> 트레이딩뷰 검색으로 추가한, 우리 가격 풀에 없는 코인(새로고침에도 유지)
let cmcKrwMap = {};          // 심볼(대문자) -> KRW. CoinMarketCap(프록시 경유) — 국내 거래소에 없는 코인 메꿈용
const CMC_PROXY = "https://api.namuapplication.cloud/cmc/krw";

// watchlist + allTickers(기본 시세)에 마지막으로 보강된 데이터(있다면)를 합쳐 coinsList를 구성
// id 하나를 allTickers(기본 정보) + enrichedCache(있다면 최신 보강값)를 합쳐 조회
function findCoinAnywhere(id){
  const base = allTickers.find(c=>c.id===id);
  if(!base) return null;
  const cached = enrichedCache[id];
  return cached ? {...base, ...cached} : base;
}

function buildCoinsList(){
  return watchlist.map(id=>findCoinAnywhere(id)).filter(Boolean);
}

// 상위 종목 표시용 한글/영문 이름 매핑 (없으면 심볼 그대로 표시)
const NAME_MAP = {
  BTC:"비트코인", ETH:"이더리움", BNB:"바이낸스코인", SOL:"솔라나", XRP:"리플",
  ADA:"에이다", DOGE:"도지코인", TRX:"트론", TON:"톤코인", AVAX:"아발란체",
  DOT:"폴카닷", MATIC:"폴리곤", LINK:"체인링크", LTC:"라이트코인", BCH:"비트코인캐시",
  SHIB:"시바이누", UNI:"유니스왑", ATOM:"코스모스", XLM:"스텔라루멘", ETC:"이더리움클래식",
  NEAR:"니어프로토콜", APT:"앱토스", ARB:"아비트럼", OP:"옵티미즘", FIL:"파일코인",
  SUI:"수이", INJ:"인젝티브", RNDR:"렌더", HBAR:"헤데라", VET:"비체인", ICP:"인터넷컴퓨터"
};

// ---------- 유틸 ----------
const prevValues = {}; // 숫자 롤링 애니메이션용 이전 값 저장소
let rowAnimating = false; // 코인 행 삭제 애니메이션 중에는 목록 재렌더를 잠깐 멈춤

// wrapEl(.roll-wrap)을 자릿수(문자) 단위로 굴려서 newText로 교체.
// 이전 텍스트와 길이/구두점 구조가 같을 때만 바뀐 자리만 위/아래로 슬라이드,
// 구조가 다르면 애니메이션 없이 즉시 다시 그림.
// 등락률 셀에 방향색(초록/빨강)을 잠깐 입혔다가 CSS 애니메이션으로 서서히 지운다
function flashChg(cellEl, dir){
  if(!cellEl || !dir) return;
  const cls = dir > 0 ? "flash-up" : "flash-down";
  cellEl.classList.remove("flash-up", "flash-down");
  void cellEl.offsetWidth; // 리플로우로 애니메이션 재시작 보장
  cellEl.classList.add(cls);
  clearTimeout(cellEl._flashTimer);
  cellEl._flashTimer = setTimeout(()=>cellEl.classList.remove("flash-up", "flash-down"), 1500);
}

function rollUpdate(wrapEl, newText, up){
  if(!wrapEl) return;
  newText = String(newText);
  const structured = wrapEl.firstElementChild && wrapEl.firstElementChild.classList.contains("roll-col");
  const prev = structured ? wrapEl.textContent : null;
  if(structured && prev === newText) return;

  if(!structured || prev.length !== newText.length){
    wrapEl.innerHTML = "";
    for(const ch of newText){
      const col = document.createElement("span");
      col.className = "roll-col";
      const s = document.createElement("span");
      s.textContent = ch;
      col.appendChild(s);
      wrapEl.appendChild(col);
    }
    return;
  }

  const cols = wrapEl.children;
  for(let i = 0; i < newText.length; i++){
    if(prev[i] === newText[i]) continue;
    const col = cols[i];
    while(col.children.length > 1) col.removeChild(col.firstElementChild); // 진행 중이던 애니메이션 정리
    const cur = col.firstElementChild;
    cur.className = ""; cur.style.cssText = "";
    const nxt = document.createElement("span");
    nxt.className = "roll-anim";
    nxt.textContent = newText[i];
    nxt.style.transform = "translateY(" + (up ? "100%" : "-100%") + ")";
    col.appendChild(nxt);
    void nxt.offsetWidth;
    requestAnimationFrame(()=>{
      cur.style.transition = "transform .3s cubic-bezier(.4,0,.2,1)";
      nxt.style.transition = "transform .3s cubic-bezier(.4,0,.2,1)";
      cur.style.transform = "translateY(" + (up ? "-100%" : "100%") + ")";
      nxt.style.transform = "translateY(0)";
    });
    setTimeout(function(){
      if(cur.parentNode === col) col.removeChild(cur);
      nxt.className = ""; nxt.style.cssText = "";
    }, 340);
  }
}

// row를 부드럽게 접은 뒤(높이/투명도 트랜지션) done() 실행 — 목록 중간 삭제가 뚝 끊기지 않게
function collapseRow(row, done){
  const h = row.offsetHeight;
  row.style.height = h + "px";
  row.style.overflow = "hidden";
  row.style.transition = "height .28s ease, opacity .28s ease, padding .28s ease, border-width .28s ease";
  void row.offsetHeight;
  row.style.height = "0px";
  row.style.opacity = "0";
  row.style.paddingTop = "0px";
  row.style.paddingBottom = "0px";
  row.style.borderWidth = "0px";
  rowAnimating = true;
  setTimeout(function(){ rowAnimating = false; done(); }, 300);
}

// 저장된 이전 값과 비교해 오른 방향(up=true)/내린 방향(up=false)을 판단하며 롤링 적용
function rollNumberByKey(key, wrapEl, newText, newNumeric){
  const prev = prevValues[key];
  const up = prev === undefined ? true : newNumeric >= prev;
  rollUpdate(wrapEl, newText, up);
  prevValues[key] = newNumeric;
}

function fmtPrice(n){
  if(n === null || n === undefined || isNaN(n)) return "-";
  if(n >= 1000) return "$" + n.toLocaleString(undefined,{maximumFractionDigits:0});
  if(n >= 1) return "$" + n.toLocaleString(undefined,{maximumFractionDigits:2});
  return "$" + n.toLocaleString(undefined,{maximumFractionDigits:6});
}
function fmtKrw(n){
  if(n === null || n === undefined || isNaN(n)) return "-";
  return "₩" + Math.round(n).toLocaleString();
}
function fmtChg(n){
  if(n === null || n === undefined || isNaN(n)) return "-";
  if(Math.abs(n) < 0.005) return "0.00%"; // 0.00%로 표시되는 값엔 +/- 안 붙임
  const s = n>0? "+":"";
  return s + n.toFixed(2) + "%";
}
// 등락률 색상 클래스: 0.00%로 표시되는 값(|n|<0.005)은 회색(flat), 그 외 초록/빨강
function chgClass(n){
  if(n === null || n === undefined || isNaN(n)) return "flat";
  if(Math.abs(n) < 0.005) return "flat";
  return n > 0 ? "up" : "down";
}

// "가격(USD)" 컬럼 표시값: displayCurrency에 따라 USD 그대로 또는 KRW로 환산해서 보여줌
function displayPriceNum(usdVal){
  if(usdVal === null || usdVal === undefined || isNaN(usdVal)) return null;
  if(displayCurrency === "krw"){
    if(!usdKrw) return null;
    return usdVal * usdKrw;
  }
  return usdVal;
}
function fmtDisplayPrice(usdVal){
  const v = displayPriceNum(usdVal);
  if(v === null) return "-";
  return displayCurrency === "krw" ? fmtKrw(v) : fmtPrice(v);
}
// "나의 거래소" 컬럼 표시값: displayCurrency에 따라 KRW 그대로 또는 USD로 환산해서 보여줌
function displayMyxNum(krwVal){
  if(krwVal === null || krwVal === undefined || isNaN(krwVal)) return null;
  if(displayCurrency === "usd"){
    if(!usdKrw) return null;
    return krwVal / usdKrw;
  }
  return krwVal;
}
function fmtDisplayMyx(krwVal){
  const v = displayMyxNum(krwVal);
  if(v === null) return "-";
  return displayCurrency === "usd" ? fmtPrice(v) : fmtKrw(v);
}
function priceColumnLabel(){
  return "가격(" + (displayCurrency === "krw" ? "KRW" : "USD") + ")";
}

// 차트 패널 우상단 가격: "표시 통화" 설정(displayCurrency)에 맞춰 USD/KRW로 보여준다
function updateChartPrice(){
  if(!selectedCoinId) return;
  const c = coinsList.find(x=>x.id===selectedCoinId) || findCoinAnywhere(selectedCoinId);
  if(!c) return;
  rollNumberByKey("chart:price", document.getElementById("chartCoinPrice"),
    fmtDisplayPrice(c.current_price), displayPriceNum(c.current_price));
}

// ---------- 시세 그리드 ----------
// 순위는 시가총액 기준(CoinGecko)으로 매기고, 가격/등락률은 가능하면 바이낸스 실시간 값으로 덮어써서 사용
async function loadFromGecko(){
  const res = await fetch(`${GECKO}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=200&page=1&price_change_percentage=24h`);
  if(!res.ok) throw new Error("gecko http " + res.status);
  const data = await res.json();
  return data.map(c=>{
    const short = c.symbol.toUpperCase();
    return {
      id: short + "USDT",
      symbol: c.symbol,
      name: NAME_MAP[short] || c.name,
      current_price: c.current_price,
      price_change_percentage_24h: c.price_change_percentage_24h,
      rank: c.market_cap_rank || null
    };
  });
}

async function loadFromBinance(){
  const res = await fetch(`${BINANCE}/ticker/24hr`);
  if(!res.ok) throw new Error("binance http " + res.status);
  const all = await res.json();
  const usdt = all.filter(t =>
    t.symbol.endsWith("USDT") &&
    !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol) &&
    parseFloat(t.quoteVolume) > 0
  );
  usdt.sort((a,b)=> parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
  return usdt.slice(0,200).map((t,idx)=>{
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
// 트레이딩뷰의 (비공식) 심볼 검색 엔드포인트로 우리 자체 시세 풀에 없는 코인까지 폭넓게 검색.
// 비공식 API라 응답 형식이 바뀌거나 막힐 수 있어, 실패하면 조용히 빈 배열을 반환해 로컬 검색만 쓰게 함.
async function searchTradingViewSymbols(query){
  if(!query || !query.trim()) return [];
  try{
    const url = `https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(query)}&hl=1&lang=en&search_type=crypto&domain=production`;
    const res = await fetch(url);
    if(!res.ok) return [];
    const data = await res.json();
    const raw = data.symbols || data.data || (Array.isArray(data) ? data : []);
    const strip = s => (s || "").replace(/<\/?em>/g, "");
    return raw
      .filter(s => s && s.symbol && (!s.type || s.type === "crypto" || s.type === "spot"))
      .map(s => {
        const sym = strip(s.symbol);
        const exch = s.exchange || s.exchange_name || "";
        return {
          tvSymbol: exch ? `${exch}:${sym}` : sym,
          symbol: sym,
          exchange: exch,
          description: strip(s.description || s.name || sym)
        };
      })
      .slice(0, 15);
  }catch(e){
    return [];
  }
}

async function fetchBinanceMap(){
  const res = await fetch(`${BINANCE}/ticker/24hr`);
  if(!res.ok) throw new Error("binance http " + res.status);
  const all = await res.json();
  const map = {};
  all.forEach(t=>{ if(t.symbol.endsWith("USDT")) map[t.symbol] = t; });
  return map;
}

async function fetchCoinbaseRates(){
  try{
    const res = await fetch("https://api.coinbase.com/v2/exchange-rates?currency=USD");
    if(!res.ok) return {};
    const data = await res.json();
    return (data.data && data.data.rates) || {};
  }catch(e){ return {}; }
}

// 심볼 -> 크라켄 USD 페어 키 매핑을 최초 1회만 만들어 캐싱
async function getKrakenPairMap(){
  if(krakenPairMap) return krakenPairMap;
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
    krakenPairMap = map;
  }catch(e){
    krakenPairMap = {};
  }
  return krakenPairMap;
}

async function fetchKrakenPricesFor(symbolsUpper){
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
async function fetchOkxMap(){
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
async function fetchBybitMap(){
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

// 바이낸스/OKX/바이빗/코인베이스/크라켄 5사 평균을 "가격(USD)"으로 사용
// 현재 필터(intlExchangeFilter)에 맞춰 5개 해외 거래소 중 선택된 것만으로 평균을 계산.
// 필터가 비어있으면(=5개 평균 모드) 전부 사용. 선택된 거래소에 값이 하나도 없으면 5개 전체 평균으로, 그마저 없으면 기준가로 대체.
function intlPriceAvg(c){
  if(!c.exUsd) return c.baseUsdPrice != null ? c.baseUsdPrice : c.current_price;
  const entries = [
    ["coinbase", c.exUsd.coinbase], ["kraken", c.exUsd.kraken], ["binance", c.exUsd.binance],
    ["okx", c.exUsd.okx], ["bybit", c.exUsd.bybit]
  ];
  const filtered = intlExchangeFilter.size === 0 ? entries : entries.filter(([k])=>intlExchangeFilter.has(k));
  let vals = filtered.map(([,v])=>v).filter(v => v && isFinite(v) && v > 0);
  if(vals.length === 0){
    vals = entries.map(([,v])=>v).filter(v => v && isFinite(v) && v > 0); // 선택한 거래소에 값이 없으면 전체 평균으로 대체
  }
  if(vals.length === 0) return c.baseUsdPrice != null ? c.baseUsdPrice : c.current_price;
  return vals.reduce((a,b)=>a+b,0) / vals.length;
}

async function enrichIntlPrices(list){
  const symbolsUpper = list.map(c=>c.symbol.toUpperCase());
  const [binanceMap, coinbaseRates, krakenMap, okxMap, bybitMap] = await Promise.all([
    fetchBinanceMap().catch(()=>({})),
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
    const withEx = {...c, baseUsdPrice: c.current_price, price_change_percentage_24h: chg,
      exUsd:{ coinbase: cb, kraken: kr, binance: bin, okx, bybit }};
    withEx.current_price = intlPriceAvg(withEx);
    return withEx;
  });
}

// 필터가 바뀌었을 때 새로 API를 호출하지 않고 캐시된 거래소별 시세로 즉시 재계산
function reapplyIntlFilter(){
  Object.keys(enrichedCache).forEach(id=>{
    const e = enrichedCache[id];
    if(e && e.exUsd){
      e.current_price = intlPriceAvg(e);
    }
  });
  coinsList = buildCoinsList();
  renderGrid();
  renderPortfolio();
  if(document.getElementById("view-premium").classList.contains("active")) renderPremiumGrid();
  updateChartPrice();
}

// ---------- 국내 거래소(업비트/빗썸/코인원) ----------
async function getUpbitMarketSet(){
  if(upbitMarketSet) return upbitMarketSet;
  try{
    const res = await fetch("https://api.upbit.com/v1/market/all");
    const data = await res.json();
    upbitMarketSet = new Set(
      data.filter(m=>m.market.startsWith("KRW-")).map(m=>m.market.replace("KRW-",""))
    );
  }catch(e){
    upbitMarketSet = new Set();
  }
  return upbitMarketSet;
}

async function fetchUpbitPricesFor(symbolsUpper){
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

async function fetchBithumbPrices(){
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

async function enrichDomesticPrices(list){
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

// 사용자가 고른 국내 거래소들의 평균가(KRW)를 계산. 데이터가 하나도 없으면 null
// 코인 c의 가격을 exchangeSet(Set 또는 배열)에 담긴 거래소들의 원화(KRW) 평균으로 계산. 데이터가 없으면 null
function exchangeAvgFor(c, exchangeSet){
  const set = exchangeSet instanceof Set ? exchangeSet : new Set(exchangeSet);
  const vals = [];
  if(c.domestic){
    if(set.has("upbit") && c.domestic.upbit) vals.push(c.domestic.upbit);
    if(set.has("bithumb") && c.domestic.bithumb) vals.push(c.domestic.bithumb);
  }
  // 해외 거래소는 실시간 환율(usdKrw)로 원화 환산해서 같이 평균낸다
  if(c.exUsd && usdKrw){
    if(set.has("binance") && c.exUsd.binance) vals.push(c.exUsd.binance * usdKrw);
    if(set.has("okx") && c.exUsd.okx) vals.push(c.exUsd.okx * usdKrw);
    if(set.has("bybit") && c.exUsd.bybit) vals.push(c.exUsd.bybit * usdKrw);
    if(set.has("coinbase") && c.exUsd.coinbase) vals.push(c.exUsd.coinbase * usdKrw);
    if(set.has("kraken") && c.exUsd.kraken) vals.push(c.exUsd.kraken * usdKrw);
  }
  if(vals.length === 0) return null;
  return vals.reduce((a,b)=>a+b,0) / vals.length;
}

function myExchangeAvg(c){
  return exchangeAvgFor(c, myExchanges);
}

// "나의 거래소" 표시값(KRW). 고른 거래소 중 어디에도 데이터가 없으면(업비트 미상장 등)
// 1순위: CoinMarketCap 원화가(프록시 경유), 2순위: CoinGecko USD가×환율 추정.
// 둘 다 실제 "국내 거래소" 체결가는 아니라서 est:true로 표시(≈)한다.
function myExchangeValue(c){
  const real = myExchangeAvg(c);
  if(real !== null) return { krw: real, est: false };
  const sym = c.symbol.toUpperCase();
  if(cmcKrwMap[sym] != null) return { krw: cmcKrwMap[sym], est: true };
  if(c.current_price != null && !isNaN(c.current_price) && usdKrw){
    return { krw: c.current_price * usdKrw, est: true };
  }
  return { krw: null, est: false };
}

// USD/KRW 환율을 최초 1회만 가져와 캐싱(프리미엄 계산, 나의 거래소 환산에 공용으로 사용)
async function fetchUsdKrw(){
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

async function ensureUsdKrw(){
  if(usdKrw) return usdKrw;
  const rate = await fetchUsdKrw();
  if(rate) usdKrw = rate;
  renderFxMini();
  return usdKrw;
}

// 헤더의 원/달러 환율 표시 갱신
function renderFxMini(){
  const box = document.getElementById("fxMini");
  if(!box) return;
  if(usdKrw){
    document.getElementById("fxRate").textContent =
      usdKrw.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    box.style.display = "block";
  }else{
    box.style.display = "none";
  }
}

// 주기적으로 환율을 다시 받아와 표시/원화 환산을 최신으로 유지 (실패 시 직전 값 유지)
async function refreshUsdKrw(){
  const rate = await fetchUsdKrw();
  if(rate && rate !== usdKrw){
    usdKrw = rate;
    renderFxMini();
    renderGrid();
    if(document.getElementById("view-premium").classList.contains("active")) renderPremiumGrid();
    renderPortfolio();
  }else{
    renderFxMini();
  }
}

async function loadMarkets(){
  try{
    let list = await loadFromGecko();
    allTickers = list;
    lastSource = "gecko";
  }catch(e1){
    try{
      allTickers = await loadFromBinance();
      lastSource = "binance";
    }catch(e2){
      document.getElementById("gridWrap").innerHTML =
        '<div class="loading">시세를 불러오지 못했습니다.<br>(' + e1.message + ' / ' + e2.message + ')<br>네트워크 연결을 확인하고 아래 버튼을 눌러주세요.</div>' +

        '<button class="more-btn" onclick="loadMarkets()" style="margin-top:0;">다시 시도</button>';
      return;
    }
  }
  // allTickers는 매번 새로 받아오므로, 검색으로 추가한 가상(트레이딩뷰 전용) 코인은 여기서 다시 합쳐줌
  Object.values(virtualCoins).forEach(v=>{
    if(!allTickers.find(c=>c.id===v.id)) allTickers.push(v);
  });
  // 최초 로드 시에는 시총 상위 8개를 기본 관심 코인으로 지정
  if(watchlist.length === 0){
    watchlist = allTickers.slice(0,8).map(c=>c.id);
  }
  coinsList = buildCoinsList(); // 우선 캐시된 값(있다면)으로 즉시 렌더
  renderGrid();
  document.getElementById("updatedAt").textContent = "업데이트: " + new Date().toLocaleTimeString() + (lastSource==="gecko" ? " (대체 소스)":"");
  if(coinsList.length > 0){
    let enriched = await enrichIntlPrices(coinsList);
    await ensureUsdKrw();
    enriched = await enrichDomesticPrices(enriched);
    enriched.forEach(c=>{
      enrichedCache[c.id] = {
        current_price: c.current_price,
        price_change_percentage_24h: c.price_change_percentage_24h,
        exUsd: c.exUsd,
        baseUsdPrice: c.baseUsdPrice,
        domestic: c.domestic
      };
    });
    coinsList = buildCoinsList();
    renderGrid();
    if(document.getElementById("view-premium").classList.contains("active")) renderPremiumGrid();
  }
  updateChartPrice();
  renderPortfolio();
}

let lastGridSignature = null;

function gridSignature(){
  const ids = coinsList.slice(0, visibleCount).map(c=>c.id).join(",");
  return editMode + "|" + visibleCount + "|" + selectedCoinId + "|" + displayCurrency + "|" + ids;
}

function renderGrid(){
  if(rowAnimating) return; // 삭제 애니메이션 중에는 재렌더 보류
  const sig = gridSignature();
  if(sig === lastGridSignature){
    updateGridValues(); // 목록 구조는 그대로, 가격/등락률만 롤링 애니메이션으로 갱신
    return;
  }
  lastGridSignature = sig;
  const wrap = document.getElementById("gridWrap");
  let html = `<div class="grid-row grid-head"><div>코인</div><div class="myx-head" id="myxHeadBtn">나의 거래소 ▾</div><div style="text-align:right">${priceColumnLabel()} <span class="col-help" id="priceHelpBtn" role="button" aria-label="가격 기준 안내">?</span></div><div style="text-align:right">등락률</div></div>`;
  if(coinsList.length === 0){
    html += '<div class="loading">관심 코인이 없습니다. "+ 코인 추가"로 보고 싶은 코인을 담아보세요.</div>';
  }
  coinsList.slice(0, visibleCount).forEach(c=>{
    const chgCls = chgClass(c.price_change_percentage_24h);
    const selCls = c.id === selectedCoinId ? "selected":"";
    const editCls = editMode ? "editing":"";
    const myx = myExchangeValue(c);
    const myxText = myx.krw === null ? "-" : (myx.est ? "≈ " : "") + fmtDisplayMyx(myx.krw);
    const rankText = c.rank ? `${c.rank}위 · ` : "";
    html += `<div class="grid-row ${selCls} ${editCls}" data-id="${c.id}">
      ${editMode ? `<div class="row-del" data-del="${c.id}">✕</div>` : ""}
      <div><div class="coin-name">${c.name}</div><div class="coin-sym">${rankText}${c.symbol.toUpperCase()}</div></div>
      <div class="myx-price ${myx.est ? "myx-est" : ""}"><span class="roll-wrap"><span class="roll-cur">${myxText}</span></span></div>
      <div class="price"><span class="roll-wrap"><span class="roll-cur">${fmtDisplayPrice(c.current_price)}</span></span></div>
      <div class="chg ${chgCls}"><span class="roll-wrap"><span class="roll-cur">${fmtChg(c.price_change_percentage_24h)}</span></span></div>
    </div>`;
    const priceNum = displayPriceNum(c.current_price);
    const myxNum = displayMyxNum(myx.krw);
    if(priceNum !== null) prevValues[c.id+":price"] = priceNum;
    prevValues[c.id+":chg"] = c.price_change_percentage_24h;
    if(myxNum !== null) prevValues[c.id+":myx"] = myxNum;
  });
  wrap.innerHTML = html;
  wrap.querySelectorAll(".grid-row[data-id]").forEach(row=>{
    row.addEventListener("click", (e)=>{
      if(e.target.closest(".row-del")) return;
      selectCoin(row.dataset.id);
    });
  });
  wrap.querySelectorAll(".row-del").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      removeCoin(btn.dataset.del);
    });
  });
  const moreBtn = document.getElementById("moreBtn");
  moreBtn.style.display = visibleCount < coinsList.length ? "block":"none";
  moreBtn.textContent = `10개 더 보기 (${Math.min(visibleCount, coinsList.length)}/${coinsList.length})`;
}

// 구조는 그대로 둔 채 각 행의 가격/등락률/나의거래소만 자릿수 단위로 굴려서 갱신
function updateGridValues(){
  const wrap = document.getElementById("gridWrap");
  coinsList.slice(0, visibleCount).forEach(c=>{
    const row = wrap.querySelector(`.grid-row[data-id="${c.id}"]`);
    if(!row) return;
    const priceEl = row.querySelector(".price .roll-wrap");
    const chgEl = row.querySelector(".chg .roll-wrap");
    const myxEl = row.querySelector(".myx-price .roll-wrap");
    const priceNum = displayPriceNum(c.current_price);
    if(priceNum !== null){
      rollNumberByKey(c.id+":price", priceEl, fmtDisplayPrice(c.current_price), priceNum);
    }else{
      rollUpdate(priceEl, "-", true);
    }
    const prevChg = prevValues[c.id+":chg"];
    rollNumberByKey(c.id+":chg", chgEl, fmtChg(c.price_change_percentage_24h), c.price_change_percentage_24h);
    if(prevChg !== undefined && c.price_change_percentage_24h != null && c.price_change_percentage_24h !== prevChg){
      flashChg(row.querySelector(".chg"), c.price_change_percentage_24h - prevChg);
    }
    const myx = myExchangeValue(c);
    const myxNum = displayMyxNum(myx.krw);
    if(myxNum !== null){
      rollNumberByKey(c.id+":myx", myxEl, (myx.est ? "≈ " : "") + fmtDisplayMyx(myx.krw), myxNum);
    }else{
      rollUpdate(myxEl, "-", true);
    }
    row.querySelector(".myx-price").classList.toggle("myx-est", myx.est);
    const chgDiv = row.querySelector(".chg");
    const cls = chgClass(c.price_change_percentage_24h);
    chgDiv.classList.toggle("up", cls === "up");
    chgDiv.classList.toggle("down", cls === "down");
    chgDiv.classList.toggle("flat", cls === "flat");
  });
  const moreBtn = document.getElementById("moreBtn");
  moreBtn.style.display = visibleCount < coinsList.length ? "block":"none";
  moreBtn.textContent = `10개 더 보기 (${Math.min(visibleCount, coinsList.length)}/${coinsList.length})`;
}

document.getElementById("gridWrap").addEventListener("click", (e)=>{
  if(e.target.closest(".myx-head")){
    e.stopPropagation();
    const panel = document.getElementById("myxPanel");
    const opening = panel.style.display === "none";
    panel.style.display = opening ? "block" : "none";
    document.getElementById("priceHelpPop").style.display = "none";
    if(opening){
      document.getElementById("addCoinPanel").style.display = "none";
      document.getElementById("addCoinBtn").classList.remove("active");
    }
  }
  if(e.target.closest("#priceHelpBtn")){
    e.stopPropagation();
    const pop = document.getElementById("priceHelpPop");
    pop.style.display = pop.style.display === "none" ? "block" : "none";
    document.getElementById("myxPanel").style.display = "none";
  }
});

document.getElementById("priceHelpGoBtn").addEventListener("click", ()=>{
  document.getElementById("priceHelpPop").style.display = "none";
  document.querySelector('.tab[data-tab="settings"]').click();
  document.getElementById("exchangeOpts").scrollIntoView({behavior:"smooth", block:"center"});
});

// 위에 뜬 말풍선/패널 바깥을 아무 데나 탭하면 자동으로 닫힘
document.addEventListener("click", (e)=>{
  const myx = document.getElementById("myxPanel");
  if(myx.style.display !== "none" && !e.target.closest("#myxPanel") && !e.target.closest(".myx-head")){
    myx.style.display = "none";
  }
  const addPanel = document.getElementById("addCoinPanel");
  if(addPanel.style.display !== "none" && !e.target.closest("#addCoinPanel") && !e.target.closest("#addCoinBtn")){
    addPanel.style.display = "none";
    document.getElementById("addCoinBtn").classList.remove("active");
  }
  const priceHelp = document.getElementById("priceHelpPop");
  if(priceHelp.style.display !== "none" && !e.target.closest("#priceHelpPop") && !e.target.closest("#priceHelpBtn")){
    priceHelp.style.display = "none";
  }
});

document.querySelectorAll(".myx-check").forEach(cb=>{
  cb.addEventListener("change", ()=>{
    myExchanges = new Set([...document.querySelectorAll(".myx-check:checked")].map(el=>el.value));
    renderGrid();
    if(document.getElementById("view-premium").classList.contains("active")) renderPremiumGrid();
    saveState();
  });
});

document.getElementById("moreBtn").addEventListener("click", ()=>{
  visibleCount = Math.min(30, visibleCount+10);
  renderGrid();
});

// ---------- 관심 코인 편집/추가/삭제 ----------
document.getElementById("editModeBtn").addEventListener("click", (e)=>{
  editMode = !editMode;
  e.target.classList.toggle("active", editMode);
  renderGrid();
});

document.getElementById("addCoinBtn").addEventListener("click", (e)=>{
  const panel = document.getElementById("addCoinPanel");
  const showing = panel.style.display !== "none";
  panel.style.display = showing ? "none" : "block";
  e.target.classList.toggle("active", !showing);
  if(!showing){
    document.getElementById("myxPanel").style.display = "none";
    renderAddResults("");
  }
});

document.getElementById("addCoinSearch").addEventListener("input", (e)=>{
  const q = e.target.value.trim();
  renderAddResults(q); // 로컬 풀 결과는 즉시 표시
  clearTimeout(addSearchDebounce);
  if(q.length === 0) return;
  addSearchDebounce = setTimeout(async ()=>{
    const tvResults = await searchTradingViewSymbols(q);
    if(document.getElementById("addCoinSearch").value.trim() === q){
      renderAddResults(q, tvResults); // 트레이딩뷰 결과를 합쳐서 다시 렌더
    }
  }, 350);
});

let addSearchDebounce = null;
let currentAddResults = []; // renderAddResults가 만든 목록(로컬+TV 혼합), 클릭 시 이 배열로 조회

function renderAddResults(query, tvResults){
  tvResults = tvResults || [];
  const box = document.getElementById("addCoinResults");
  const q = query.toUpperCase();
  const localMatches = query
    ? allTickers.filter(c => c.symbol.toUpperCase().includes(q) || c.name.toUpperCase().includes(q))
    : allTickers;
  const localSymbols = new Set(localMatches.map(c=>c.symbol.toUpperCase()));
  const tvOnly = tvResults.filter(t => t.symbol && !localSymbols.has(t.symbol.toUpperCase()));
  currentAddResults = [
    ...localMatches.map(c=>({kind:"local", coin:c})),
    ...tvOnly.map(t=>({kind:"tv", item:t}))
  ];
  if(currentAddResults.length === 0){
    box.innerHTML = '<div class="add-empty">일치하는 코인이 없습니다.</div>';
    return;
  }
  box.innerHTML = currentAddResults.map((entry, idx)=>{
    if(entry.kind === "local"){
      const c = entry.coin;
      const already = watchlist.includes(c.id);
      return `
      <div class="add-result-row" data-pick="${idx}" style="${already ? 'opacity:0.45;' : 'cursor:pointer;'}">
        <div><span class="rank">${c.rank ? c.rank+"위" : "-"}</span>${c.name} <span style="color:var(--muted)">${c.symbol.toUpperCase()}</span></div>
        ${already
          ? '<span style="font-size:11px; color:var(--muted);">담김</span>'
          : `<button class="add-plus" data-pick="${idx}">+ 담기</button>`}
      </div>`;
    }else{
      const t = entry.item;
      return `
      <div class="add-result-row" data-pick="${idx}" style="cursor:pointer;">
        <div><span class="rank" style="color:var(--gold);">TV</span>${t.description} <span style="color:var(--muted)">${t.tvSymbol}</span></div>
        <button class="add-plus" data-pick="${idx}">+ 담기</button>
      </div>`;
    }
  }).join("");
  box.querySelectorAll("[data-pick]").forEach(el=>{
    el.addEventListener("click", (e)=>{
      e.stopPropagation();
      pickAddResult(Number(el.dataset.pick));
    });
  });
}

function pickAddResult(idx){
  const entry = currentAddResults[idx];
  if(!entry) return;
  if(entry.kind === "local"){
    if(!watchlist.includes(entry.coin.id)) addCoin(entry.coin.id);
  }else{
    addVirtualCoin(entry.item);
  }
}

function addCoin(id){
  if(watchlist.includes(id)) return;
  if(watchlist.length >= 30){
    alert("관심 코인은 최대 30개까지 담을 수 있어요.");
    return;
  }
  watchlist.push(id);
  visibleCount = Math.max(visibleCount, Math.min(30, watchlist.length));
  coinsList = buildCoinsList();
  renderGrid();
  renderAddResults(document.getElementById("addCoinSearch").value.trim());
  saveState();
}

// 트레이딩뷰 검색 결과(로컬 가격 데이터가 없는 코인)를 담기 목록에 추가.
// 심볼이 우리 가격 소스(바이낸스 등)와 우연히 일치하면 자동으로 가격도 붙고,
// 아니면 차트는 트레이딩뷰로 보이되 가격/등락률은 "-"로 표시됨.
function resolveOrCreateVirtualCoin(tvItem){
  let base = tvItem.symbol.replace(/(USDT|USDC|BUSD|FDUSD|USD|KRW)$/i, "");
  if(!base) base = tvItem.symbol;
  const guessId = base.toUpperCase() + "USDT";
  let coin = allTickers.find(c => c.id === guessId || c.symbol.toUpperCase() === base.toUpperCase());
  if(coin){
    coin.tvSymbol = tvItem.tvSymbol;
  }else{
    coin = {
      id: guessId,
      symbol: base.toLowerCase(),
      name: tvItem.description || base,
      current_price: null,
      price_change_percentage_24h: null,
      rank: null,
      tvSymbol: tvItem.tvSymbol
    };
    allTickers.push(coin);
    virtualCoins[coin.id] = coin;
  }
  return coin;
}

function addVirtualCoin(tvItem){
  const coin = resolveOrCreateVirtualCoin(tvItem);
  addCoin(coin.id);
  return coin;
}

function removeCoin(id){
  const commit = ()=>{
    watchlist = watchlist.filter(x=>x!==id);
    coinsList = buildCoinsList();
    if(selectedCoinId === id) closeChart();
    lastGridSignature = null; // 구조가 바뀌었으니 강제로 다시 그림
    renderGrid();
    saveState();
  };
  const row = document.querySelector(`#gridWrap .grid-row[data-id="${id}"]`);
  if(row) collapseRow(row, commit);
  else commit();
}

// ---------- 차트 ----------
// 시세/프리미엄/포트폴리오 어느 탭에서든 코인을 누르면 하단 차트 패널이 뜬다.
async function selectCoin(id){
  const c = coinsList.find(x=>x.id===id) || findCoinAnywhere(id);
  if(!c) return;
  selectedCoinId = id;
  renderGrid();
  const panel = document.getElementById("chartPanel");
  panel.style.display = "block";
  document.body.classList.add("chart-open");
  document.getElementById("chartCoinName").textContent = `${c.name} (${c.symbol.toUpperCase()})`;
  if(displayCurrency === "krw" && !usdKrw) await ensureUsdKrw();
  document.getElementById("chartCoinPrice").innerHTML = '<span class="roll-cur">' + fmtDisplayPrice(c.current_price) + '</span>';
  prevValues["chart:price"] = displayPriceNum(c.current_price);
  renderTVChart(c, currentDays);
}

function closeChart(){
  selectedCoinId = null;
  document.getElementById("chartPanel").style.display = "none";
  document.getElementById("tvChartContainer").innerHTML = "";
  document.body.classList.remove("chart-open");
  renderGrid();
}
document.getElementById("chartCloseBtn").addEventListener("click", closeChart);

// range 버튼 값(1/7/30/365) -> 트레이딩뷰 interval/range 매핑
const TV_RANGE_MAP = {
  1:   { interval: "15",  range: "1D"  },
  7:   { interval: "60",  range: "5D"  },
  30:  { interval: "240", range: "1M"  },
  365: { interval: "D",   range: "12M" }
};

// 차트가 의미 없는(항상 ≈$1) 스테이블코인들 — TradingView에 SYMUSDT 페어가 없어 "Invalid symbol"이 뜬다
const STABLECOINS = new Set([
  "USDT","USDC","DAI","USDE","USD1","FDUSD","TUSD","USDD","PYUSD","USDP","GUSD",
  "USDS","BUSD","USDL","USDG","USD0","USDX","USR","LUSD","FRAX","USDB","USDTB","RLUSD","EURC","EURT"
]);

// 코인이 실제로 거래되는 거래소 데이터(c.exUsd / c.domestic)를 근거로 유효한 트레이딩뷰 심볼을 고른다.
// 예전엔 무조건 "BINANCE:SYMUSDT"로 찍어서, 바이낸스에 없는 코인(래핑 토큰·코인베이스 전용·국내 상장 등)은 차트가 안 떴다.
function guessTvSymbol(c){
  if(c.tvSymbol) return c.tvSymbol;
  const sym = c.symbol.toUpperCase();
  const ex = c.exUsd || {};
  if(ex.binance)  return "BINANCE:"  + sym + "USDT";
  if(ex.okx)      return "OKX:"      + sym + "USDT";
  if(ex.bybit)    return "BYBIT:"    + sym + "USDT";
  if(ex.coinbase) return "COINBASE:" + sym + "USD";
  if(ex.kraken)   return "KRAKEN:"   + sym + "USD";
  if(c.domestic && c.domestic.upbit)   return "UPBIT:"   + sym + "KRW";
  if(c.domestic && c.domestic.bithumb) return "BITHUMB:" + sym + "KRW";
  return "BINANCE:" + (c.id || sym + "USDT"); // 최후의 추정
}

function renderTVChart(c, days){
  const container = document.getElementById("tvChartContainer");
  container.innerHTML = ""; // 이전 위젯 제거
  const cfg = TV_RANGE_MAP[days] || TV_RANGE_MAP[1];

  // 스테이블코인은 차트 대신 안내만 (SYMUSDT 페어가 없어서 어차피 "Invalid symbol"이 뜸)
  if(!c.tvSymbol && STABLECOINS.has(c.symbol.toUpperCase())){
    container.innerHTML =
      '<div class="loading" style="padding:40px 12px;">스테이블코인이라 가격이 항상 ≈ $1 — 시세 차트를 생략했어요.</div>';
    document.getElementById("chartSrcNote").textContent = "가격 기준: 스테이블코인 (달러 페그)";
    return;
  }

  const tvSymbol = guessTvSymbol(c);
  try{
    new TradingView.widget({
      autosize: true,
      symbol: tvSymbol,
      interval: cfg.interval,
      range: cfg.range,
      timezone: "Asia/Seoul",
      theme: "dark",
      style: "1",
      locale: "kr",
      toolbar_bg: "#121821",
      enable_publishing: false,
      hide_top_toolbar: false,
      hide_legend: true,
      allow_symbol_change: false,
      save_image: false,
      container_id: "tvChartContainer"
    });
    document.getElementById("chartSrcNote").textContent = "차트: TradingView (" + tvSymbol + ")";
  }catch(e){
    document.getElementById("chartSrcNote").textContent = "TradingView 차트를 불러오지 못했습니다. 트레이딩뷰에 없는 심볼일 수 있어요.";
  }
}



// ---------- 탭 전환 ----------
document.querySelectorAll(".tab").forEach(tab=>{
  tab.addEventListener("click", async ()=>{
    document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("view-"+tab.dataset.tab).classList.add("active");
    if(tab.dataset.tab === "premium"){
      if(!usdKrw){
        document.getElementById("premGridWrap").innerHTML = '<div class="loading">환율 정보를 불러오는 중입니다…</div>';
        await ensureUsdKrw();
      }
      renderPremiumGrid();
    }
  });
});

// ---------- 설정 ----------
document.getElementById("exchangeOpts").addEventListener("click", (e)=>{
  const opt = e.target.closest(".opt");
  if(!opt) return;
  const ex = opt.dataset.ex;
  if(ex === "avg"){
    intlExchangeFilter.clear(); // "평균" = 개별 필터 초기화 → 자동으로 5개 전체 평균
  }else{
    if(intlExchangeFilter.has(ex)) intlExchangeFilter.delete(ex);
    else intlExchangeFilter.add(ex);
  }
  renderExchangeOpts();
  reapplyIntlFilter();
  saveState();
});

function renderExchangeOpts(){
  const isAvg = intlExchangeFilter.size === 0;
  document.querySelectorAll("#exchangeOpts .opt").forEach(o=>{
    const ex = o.dataset.ex;
    const active = ex === "avg" ? isAvg : (!isAvg && intlExchangeFilter.has(ex));
    o.classList.toggle("active", active);
  });
  const label = isAvg ? "5거래소 평균" : [...intlExchangeFilter].map(x=>EX_LABEL[x]).join("+");
  if(document.getElementById("chartPanel").style.display !== "none"){
    document.getElementById("chartSrcNote").textContent = "가격 기준: " + label;
  }
}

document.getElementById("currencyOpts").addEventListener("click", async (e)=>{
  const opt = e.target.closest(".opt");
  if(!opt) return;
  document.querySelectorAll("#currencyOpts .opt").forEach(o=>o.classList.remove("active"));
  opt.classList.add("active");
  displayCurrency = opt.dataset.cur;
  if(!usdKrw) await ensureUsdKrw();
  renderGrid(); // gridSignature에 displayCurrency가 포함돼 있어 자동으로 헤더까지 다시 그려짐
  updateChartPrice();
  if(document.getElementById("view-premium").classList.contains("active")) renderPremiumGrid();
  renderPortfolio();
  saveState();
});

document.getElementById("themeOpts").addEventListener("click", (e)=>{
  const opt = e.target.closest(".opt");
  if(!opt) return;
  document.querySelectorAll("#themeOpts .opt").forEach(o=>o.classList.remove("active"));
  opt.classList.add("active");
  document.body.classList.toggle("light-theme", opt.dataset.theme === "light");
  saveState();
});

document.getElementById("refreshOpts").addEventListener("click", (e)=>{
  const opt = e.target.closest(".opt");
  if(!opt) return;
  document.querySelectorAll("#refreshOpts .opt").forEach(o=>o.classList.remove("active"));
  opt.classList.add("active");
  refreshSec = Number(opt.dataset.sec);
  restartRefreshTimer();
  saveState();
});

function restartRefreshTimer(){
  if(refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(loadMarkets, refreshSec*1000);
}

// ---------- 프리미엄(김치 프리미엄) ----------
function premiumPct(c, myxVal){
  if(myxVal === null || myxVal === undefined || !usdKrw) return null;
  const intlKrw = c.current_price * usdKrw;
  if(!intlKrw) return null;
  return ((myxVal - intlKrw) / intlKrw) * 100;
}

let lastPremSignature = null;

function premSignature(){
  const ids = coinsList.map(c=>c.id).join(",");
  return displayCurrency + "|" + [...myExchanges].sort().join(",") + "|" + ids;
}

function renderPremiumGrid(){
  const wrap = document.getElementById("premGridWrap");
  if(!wrap) return;
  if(coinsList.length === 0){
    lastPremSignature = null;
    wrap.innerHTML = '<div class="loading">관심 코인이 없습니다. 시세 탭에서 코인을 담아보세요.</div>';
    return;
  }
  const sig = premSignature();
  if(sig === lastPremSignature){
    updatePremiumValues(); // 구성은 그대로, 값만 롤링 애니메이션으로 갱신
    return;
  }
  lastPremSignature = sig;
  let html = `<div class="grid-row grid-head"><div>코인</div><div style="text-align:right">나의 거래소</div><div style="text-align:right">${priceColumnLabel()}</div><div style="text-align:right">김치프리미엄</div></div>`;
  coinsList.forEach(c=>{
    const myxVal = myExchangeAvg(c);
    const premPct = premiumPct(c, myxVal);
    const premCls = premPct === null ? "" : chgClass(premPct);
    const premText = premPct === null ? "-" : fmtChg(premPct);
    html += `<div class="grid-row" data-id="${c.id}">
      <div><div class="coin-name">${c.name}</div><div class="coin-sym">${c.symbol.toUpperCase()}</div></div>
      <div class="myx-price"><span class="roll-wrap"><span class="roll-cur">${fmtDisplayMyx(myxVal)}</span></span></div>
      <div class="price"><span class="roll-wrap"><span class="roll-cur">${fmtDisplayPrice(c.current_price)}</span></span></div>
      <div class="chg ${premCls}"><span class="roll-wrap"><span class="roll-cur">${premText}</span></span></div>
    </div>`;
    const myxNum = displayMyxNum(myxVal);
    const priceNum = displayPriceNum(c.current_price);
    if(myxNum !== null) prevValues["prem:"+c.id+":myx"] = myxNum;
    if(priceNum !== null) prevValues["prem:"+c.id+":price"] = priceNum;
    if(premPct !== null) prevValues["prem:"+c.id+":pct"] = premPct;
  });
  wrap.innerHTML = html;
  wrap.querySelectorAll(".grid-row[data-id]").forEach(row=>{
    row.addEventListener("click", ()=> selectCoin(row.dataset.id));
  });
}

// 구성은 그대로 둔 채 나의거래소/가격/프리미엄 값만 위아래로 슬라이드시키며 갱신
function updatePremiumValues(){
  const wrap = document.getElementById("premGridWrap");
  if(!wrap) return;
  coinsList.forEach(c=>{
    const row = wrap.querySelector(`.grid-row[data-id="${c.id}"]`);
    if(!row) return;
    const myxVal = myExchangeAvg(c);
    const premPct = premiumPct(c, myxVal);
    const myxEl = row.querySelector(".myx-price .roll-wrap");
    const priceEl = row.querySelector(".price .roll-wrap");
    const pctEl = row.querySelector(".chg .roll-wrap");
    const myxNum = displayMyxNum(myxVal);
    const priceNum = displayPriceNum(c.current_price);
    if(myxNum !== null) rollNumberByKey("prem:"+c.id+":myx", myxEl, fmtDisplayMyx(myxVal), myxNum);
    else myxEl.innerHTML = '<span class="roll-cur">-</span>';
    if(priceNum !== null) rollNumberByKey("prem:"+c.id+":price", priceEl, fmtDisplayPrice(c.current_price), priceNum);
    else priceEl.innerHTML = '<span class="roll-cur">-</span>';
    if(premPct !== null) rollNumberByKey("prem:"+c.id+":pct", pctEl, fmtChg(premPct), premPct);
    else pctEl.innerHTML = '<span class="roll-cur">-</span>';
    const chgDiv = row.querySelector(".chg");
    if(premPct !== null){
      const cls = chgClass(premPct);
      chgDiv.classList.toggle("up", cls === "up");
      chgDiv.classList.toggle("down", cls === "down");
      chgDiv.classList.toggle("flat", cls === "flat");
    }
  });
}

// ---------- 포트폴리오 ----------
const MAX_PORTFOLIOS = 10;
let portfolios = [ { name:"포트폴리오 1", holdings:[], exchanges:["upbit"] } ]; // {name, holdings:[{id,symbol,name,amount}], exchanges:[...]}
let activePortfolioIdx = 0;

function currentPortfolio(){ return portfolios[activePortfolioIdx]; }

let pfSelectedCoin = null; // 포트폴리오에 담을 코인으로 현재 선택된 항목
let pfCurrentResults = [];
let pfSearchDebounce = null;
let pfEditMode = false; // 보유 코인 수량 수정 + 삭제 모드

document.getElementById("pfCoinSearch").addEventListener("input", (e)=>{
  pfSelectedCoin = null; // 다시 타이핑하면 이전 선택은 해제
  const q = e.target.value.trim();
  renderPfResults(q); // 로컬 풀 결과(빈 값이면 시총 순위)는 즉시 표시
  clearTimeout(pfSearchDebounce);
  if(q.length === 0) return;
  pfSearchDebounce = setTimeout(async ()=>{
    const tvResults = await searchTradingViewSymbols(q);
    if(document.getElementById("pfCoinSearch").value.trim() === q){
      renderPfResults(q, tvResults);
    }
  }, 350);
});

document.getElementById("pfCoinSearch").addEventListener("focus", ()=>{
  if(!pfSelectedCoin) renderPfResults(document.getElementById("pfCoinSearch").value.trim());
});

document.addEventListener("click", (e)=>{
  if(!e.target.closest("#pfCoinResults") && !e.target.closest("#pfCoinSearch")){
    document.getElementById("pfCoinResults").style.display = "none";
  }
  if(!e.target.closest("#pfPortfolioPanel") && !e.target.closest("#pfPortfolioBtn")){
    document.getElementById("pfPortfolioPanel").style.display = "none";
  }
  if(!e.target.closest("#pfExPanel") && !e.target.closest("#pfExBtn")){
    document.getElementById("pfExPanel").style.display = "none";
  }
});

// query가 비어 있으면 시세 탭 "+ 코인 추가"처럼 시총 순위대로 전체 목록을 보여준다.
function renderPfResults(query, tvResults){
  tvResults = tvResults || [];
  const box = document.getElementById("pfCoinResults");
  const q = (query || "").toUpperCase();
  const localMatches = q
    ? allTickers.filter(c => c.symbol.toUpperCase().includes(q) || c.name.toUpperCase().includes(q)).slice(0, 30)
    : allTickers.slice(0, 50);
  const localSymbols = new Set(localMatches.map(c=>c.symbol.toUpperCase()));
  const tvOnly = tvResults.filter(t => t.symbol && !localSymbols.has(t.symbol.toUpperCase()));
  pfCurrentResults = [
    ...localMatches.map(c=>({kind:"local", coin:c})),
    ...tvOnly.map(t=>({kind:"tv", item:t}))
  ];
  box.style.display = "block";
  if(pfCurrentResults.length === 0){
    box.innerHTML = '<div class="add-empty">일치하는 코인이 없습니다.</div>';
    return;
  }
  box.innerHTML = pfCurrentResults.map((entry, idx)=>{
    if(entry.kind === "local"){
      const c = entry.coin;
      return `<div class="add-result-row" data-pfpick="${idx}" style="cursor:pointer;">
        <div><span class="rank">${c.rank ? c.rank+"위" : "-"}</span>${c.name} <span style="color:var(--muted)">${c.symbol.toUpperCase()}</span></div>
      </div>`;
    }
    const t = entry.item;
    return `<div class="add-result-row" data-pfpick="${idx}" style="cursor:pointer;">
      <div><span class="rank" style="color:var(--gold);">TV</span>${t.description} <span style="color:var(--muted)">${t.tvSymbol}</span></div>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-pfpick]").forEach(el=>{
    el.addEventListener("click", ()=> pickPfResult(Number(el.dataset.pfpick)));
  });
}

function pickPfResult(idx){
  const entry = pfCurrentResults[idx];
  if(!entry) return;
  const coin = entry.kind === "local" ? entry.coin : resolveOrCreateVirtualCoin(entry.item);
  pfSelectedCoin = coin;
  document.getElementById("pfCoinSearch").value = `${coin.name} (${coin.symbol.toUpperCase()})`;
  document.getElementById("pfCoinResults").style.display = "none";
  document.getElementById("pfAmount").focus();
}

document.getElementById("pfAddBtn").addEventListener("click", ()=>{
  const amount = parseFloat(document.getElementById("pfAmount").value);
  if(!pfSelectedCoin || !amount || amount<=0) return;
  const id = pfSelectedCoin.id;
  const holdings = currentPortfolio().holdings;
  const existing = holdings.find(p=>p.id===id);
  if(existing) existing.amount += amount;
  else holdings.push({id, symbol:pfSelectedCoin.symbol.toUpperCase(), name:pfSelectedCoin.name, amount});
  document.getElementById("pfAmount").value = "";
  document.getElementById("pfCoinSearch").value = "";
  pfSelectedCoin = null;
  renderPortfolio();
  saveState();
});

document.getElementById("pfEditBtn").addEventListener("click", (e)=>{
  pfEditMode = !pfEditMode;
  e.target.classList.toggle("active", pfEditMode);
  renderPortfolio();
});

// 이 포트폴리오에서 고른 거래소 기준 가격을 USD로 반환(내부 계산은 USD 기준으로 통일). 데이터 없으면 null
function pfCoinPriceUsd(c, exchangeSet){
  const krw = exchangeAvgFor(c, exchangeSet);
  if(krw !== null && usdKrw) return krw / usdKrw;
  return null;
}

function renderPortfolio(){
  if(rowAnimating) return; // 삭제 애니메이션 중에는 재렌더 보류
  const list = document.getElementById("pfList");
  const totalLabel = displayCurrency === "krw" ? "₩0" : "$0.00";
  const holdings = currentPortfolio().holdings;
  const exSet = new Set(currentPortfolio().exchanges);
  if(holdings.length === 0){
    list.innerHTML = '<div class="empty">보유 코인을 추가하면 여기에 표시됩니다.</div>';
    document.getElementById("pfTotal").textContent = totalLabel;
    return;
  }
  let total = 0;
  let html = "";
  holdings.forEach((p, idx)=>{
    const c = findCoinAnywhere(p.id);
    const priceUsd = c ? pfCoinPriceUsd(c, exSet) : null;
    const value = priceUsd !== null ? priceUsd * p.amount : null;
    if(value !== null) total += value;
    const amtCell = pfEditMode
      ? `<input class="pf-amt-edit" type="number" step="any" min="0" value="${p.amount}" data-idx="${idx}">`
      : `${p.amount}`;
    const delCell = pfEditMode ? `<div class="del" data-idx="${idx}">✕</div>` : `<div></div>`;
    html += `<div class="pf-row" data-id="${p.id}">
      <div>${p.name}<div class="coin-sym">${p.symbol}</div></div>
      <div>${amtCell}</div>
      <div class="price">${value !== null ? fmtDisplayPrice(value) : "-"}</div>
      ${delCell}
    </div>`;
  });
  list.innerHTML = html;
  list.querySelectorAll(".pf-row").forEach(row=>{
    row.addEventListener("click", (e)=>{
      if(e.target.closest(".del") || e.target.closest(".pf-amt-edit")) return;
      selectCoin(row.dataset.id);
    });
  });
  list.querySelectorAll(".del").forEach(d=>{
    d.addEventListener("click", (e)=>{
      e.stopPropagation();
      const idx = Number(d.dataset.idx);
      const go = ()=>{ holdings.splice(idx,1); renderPortfolio(); saveState(); };
      const row = d.closest(".pf-row");
      if(row) collapseRow(row, go);
      else go();
    });
  });
  list.querySelectorAll(".pf-amt-edit").forEach(inp=>{
    inp.addEventListener("click", (e)=> e.stopPropagation());
    inp.addEventListener("change", ()=>{
      const v = parseFloat(inp.value);
      if(!isFinite(v) || v <= 0){ renderPortfolio(); return; }
      holdings[Number(inp.dataset.idx)].amount = v;
      renderPortfolio();
      saveState();
    });
  });
  document.getElementById("pfTotal").textContent = fmtDisplayPrice(total);
}

// ---------- 포트폴리오 전환 / 추가 / 삭제 ----------
function renderPortfolioHeaderBtn(){
  document.getElementById("pfPortfolioBtn").textContent = currentPortfolio().name + " ▾";
}

function renderPortfolioDropdown(){
  const box = document.getElementById("pfPortfolioPanel");
  let html = portfolios.map((p, idx)=>`
    <div class="add-result-row" data-pfsel="${idx}" style="cursor:pointer;">
      <div>${p.name}${idx===activePortfolioIdx ? ' <span style="color:var(--gold);">✓</span>' : ''}</div>
      <div style="display:flex; gap:10px; align-items:center; flex-shrink:0;">
        <span style="color:var(--muted); cursor:pointer;" data-pfrename="${idx}">✎</span>
        ${portfolios.length > 1 ? `<span style="color:var(--down); font-weight:700; cursor:pointer;" data-pfdel="${idx}">✕</span>` : ''}
      </div>
    </div>`).join("");
  html += `<div class="add-result-row" data-pfnew="1" style="cursor:pointer; justify-content:center; color:var(--gold); font-weight:700;">+ 포트폴리오 추가</div>`;
  box.innerHTML = html;
  box.querySelectorAll("[data-pfsel]").forEach(el=>{
    el.addEventListener("click", (e)=>{
      if(e.target.closest("[data-pfdel]") || e.target.closest("[data-pfrename]")) return;
      switchPortfolio(Number(el.dataset.pfsel));
    });
  });
  box.querySelectorAll("[data-pfrename]").forEach(el=>{
    el.addEventListener("click", (e)=>{
      e.stopPropagation();
      renamePortfolio(Number(el.dataset.pfrename));
    });
  });
  box.querySelectorAll("[data-pfdel]").forEach(el=>{
    el.addEventListener("click", (e)=>{
      e.stopPropagation();
      deletePortfolio(Number(el.dataset.pfdel));
    });
  });
  box.querySelector("[data-pfnew]").addEventListener("click", addPortfolio);
}

function switchPortfolio(idx){
  activePortfolioIdx = idx;
  renderPortfolioHeaderBtn();
  syncPfExCheckboxes();
  renderPortfolio();
  document.getElementById("pfPortfolioPanel").style.display = "none";
  saveState();
}

function addPortfolio(){
  if(portfolios.length >= MAX_PORTFOLIOS){
    alert("포트폴리오는 최대 " + MAX_PORTFOLIOS + "개까지 만들 수 있어요.");
    return;
  }
  portfolios.push({ name: "포트폴리오 " + (portfolios.length+1), holdings:[], exchanges:["upbit"] });
  activePortfolioIdx = portfolios.length - 1;
  renderPortfolioHeaderBtn();
  renderPortfolioDropdown();
  syncPfExCheckboxes();
  renderPortfolio();
  document.getElementById("pfPortfolioPanel").style.display = "none";
  saveState();
}

function renamePortfolio(idx){
  const p = portfolios[idx];
  const newName = prompt("포트폴리오 이름을 입력해주세요", p.name);
  if(newName === null) return; // 취소
  const trimmed = newName.trim();
  if(!trimmed) return;
  p.name = trimmed.slice(0, 20);
  renderPortfolioHeaderBtn();
  renderPortfolioDropdown();
  saveState();
}

function deletePortfolio(idx){
  if(portfolios.length <= 1) return; // 최소 1개는 유지
  const p = portfolios[idx];
  if(p.holdings.length > 0){
    const ok = confirm(`"${p.name}"에 담긴 코인 ${p.holdings.length}개가 함께 삭제됩니다. 정말 삭제하시겠어요?`);
    if(!ok) return;
  }
  portfolios.splice(idx, 1);
  if(activePortfolioIdx >= portfolios.length) activePortfolioIdx = portfolios.length - 1;
  else if(activePortfolioIdx > idx) activePortfolioIdx--;
  renderPortfolioHeaderBtn();
  renderPortfolioDropdown();
  syncPfExCheckboxes();
  renderPortfolio();
  saveState();
}

function syncPfExCheckboxes(){
  const set = new Set(currentPortfolio().exchanges);
  document.querySelectorAll(".pfex-check").forEach(cb=>{ cb.checked = set.has(cb.value); });
}

document.getElementById("pfPortfolioBtn").addEventListener("click", ()=>{
  renderPortfolioDropdown();
  const panel = document.getElementById("pfPortfolioPanel");
  panel.style.display = panel.style.display === "none" ? "block" : "none";
  document.getElementById("pfExPanel").style.display = "none";
});

document.getElementById("pfExBtn").addEventListener("click", ()=>{
  const panel = document.getElementById("pfExPanel");
  panel.style.display = panel.style.display === "none" ? "block" : "none";
  document.getElementById("pfPortfolioPanel").style.display = "none";
});

document.querySelectorAll(".pfex-check").forEach(cb=>{
  cb.addEventListener("change", ()=>{
    currentPortfolio().exchanges = [...document.querySelectorAll(".pfex-check:checked")].map(el=>el.value);
    renderPortfolio();
    saveState();
  });
});

// ---------- 로컬 저장 ----------
// 참고: 이 저장 기능은 파일을 다운로드해서 사파리/크롬 등 실제 브라우저로 직접 열었을 때만 동작합니다.
// 클로드 앱/웹 안의 파일 미리보기 화면에서는 브라우저 저장소 접근이 막혀 있어 저장되지 않아요.
const STORAGE_KEY = "coinwatch_state_v1";

function saveState(){
  try{
    const state = {
      watchlist,
      portfolios,
      activePortfolioIdx,
      myExchanges: [...myExchanges],
      intlExchangeFilter: [...intlExchangeFilter],
      displayCurrency,
      theme: document.body.classList.contains("light-theme") ? "light" : "dark",
      refreshSec,
      virtualCoins: Object.fromEntries(
        Object.entries(virtualCoins).map(([id,c])=>[id, {id:c.id, symbol:c.symbol, name:c.name, tvSymbol:c.tvSymbol}])
      )
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }catch(e){ /* 저장 실패(프라이빗 브라우징 등)해도 앱은 계속 동작 */ }
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return;
    const state = JSON.parse(raw);
    if(Array.isArray(state.watchlist)) watchlist = state.watchlist;
    if(Array.isArray(state.portfolios) && state.portfolios.length > 0){
      portfolios = state.portfolios.map(p=>({
        name: p.name || "포트폴리오",
        holdings: Array.isArray(p.holdings) ? p.holdings : [],
        exchanges: Array.isArray(p.exchanges) && p.exchanges.length ? p.exchanges : ["upbit"]
      })).slice(0, MAX_PORTFOLIOS);
      activePortfolioIdx = Number.isInteger(state.activePortfolioIdx) && state.activePortfolioIdx < portfolios.length
        ? state.activePortfolioIdx : 0;
    }else if(Array.isArray(state.portfolio)){
      // 구버전(단일 포트폴리오) 데이터 마이그레이션
      portfolios = [{ name:"포트폴리오 1", holdings: state.portfolio, exchanges:["upbit"] }];
      activePortfolioIdx = 0;
    }
    if(Array.isArray(state.myExchanges)) myExchanges = new Set(state.myExchanges);
    if(Array.isArray(state.intlExchangeFilter)) intlExchangeFilter = new Set(state.intlExchangeFilter);
    if(state.displayCurrency) displayCurrency = state.displayCurrency;
    if(state.refreshSec) refreshSec = state.refreshSec;
    if(state.virtualCoins){
      Object.entries(state.virtualCoins).forEach(([id,c])=>{
        virtualCoins[id] = {...c, current_price:null, price_change_percentage_24h:null, rank:null};
      });
    }
    if(state.theme === "light") document.body.classList.add("light-theme");
  }catch(e){ /* 저장된 값이 손상됐으면 무시하고 기본값 사용 */ }
}

// 불러온 설정값을 화면의 토글/체크박스에도 반영
function applyLoadedUIState(){
  document.querySelectorAll(".myx-check").forEach(cb=>{ cb.checked = myExchanges.has(cb.value); });
  renderExchangeOpts();
  document.querySelectorAll("#currencyOpts .opt").forEach(o=>{
    o.classList.toggle("active", o.dataset.cur === displayCurrency);
  });
  const isLight = document.body.classList.contains("light-theme");
  document.querySelectorAll("#themeOpts .opt").forEach(o=>{
    o.classList.toggle("active", (o.dataset.theme === "light") === isLight);
  });
  document.querySelectorAll("#refreshOpts .opt").forEach(o=>{
    o.classList.toggle("active", Number(o.dataset.sec) === refreshSec);
  });
  renderPortfolioHeaderBtn();
  syncPfExCheckboxes();
}

// ---------- 공포·탐욕 지수 ----------
// alternative.me의 크립토 Fear & Greed Index (0=극도의 공포 ~ 100=극도의 탐욕). 하루 1회 갱신.
const FNG_LABEL = {
  "Extreme Fear":"극도의 공포",
  "Fear":"공포",
  "Neutral":"중립",
  "Greed":"탐욕",
  "Extreme Greed":"극도의 탐욕"
};

function fngColor(v){
  if(v < 25) return "#F05464";
  if(v < 45) return "#E8833A";
  if(v < 55) return "#D9A441";
  if(v < 75) return "#7FC77E";
  return "#3ECF8E";
}

async function loadFearGreed(){
  const box = document.getElementById("fngMini");
  try{
    const res = await fetch("https://api.alternative.me/fng/?limit=1");
    if(!res.ok) throw new Error("fng http " + res.status);
    const data = await res.json();
    const d = data.data && data.data[0];
    if(!d) throw new Error("fng empty");
    const v = Math.max(0, Math.min(100, Math.round(Number(d.value))));
    const valEl = document.getElementById("fngVal");
    valEl.textContent = v;
    valEl.style.color = fngColor(v);
    const clsEl = document.getElementById("fngClass");
    clsEl.textContent = FNG_LABEL[d.value_classification] || d.value_classification || "-";
    clsEl.style.color = fngColor(v);
    box.style.display = "block";
  }catch(e){
    if(box) box.style.display = "none";
  }
}

// 국내 거래소에 없는 코인의 원화 시세를 CoinMarketCap(프록시 경유)에서 받아 메꿈용으로 보관.
// 10분 단위 캐시 버킷을 쿼리에 붙여 브라우저/CDN 캐시가 그 주기로만 갱신되게 함(워커도 10분 캐시 → CMC 크레딧 절약).
async function loadCmcKrw(){
  try{
    const res = await fetch(CMC_PROXY + "?t=" + Math.floor(Date.now() / 600000));
    if(!res.ok) return;
    const j = await res.json();
    if(j && j.data){
      const m = {};
      for(const [sym, v] of Object.entries(j.data)){
        if(v && typeof v.krw === "number") m[sym] = v.krw;
      }
      cmcKrwMap = m;
      renderGrid();
    }
  }catch(e){ /* 프록시 실패해도 앱은 계속 (usd×환율 추정으로 폴백) */ }
}

// ---------- 초기화 ----------
loadState();
applyLoadedUIState();
loadMarkets();
loadFearGreed();
ensureUsdKrw().then(renderFxMini);
setInterval(refreshUsdKrw, 120000); // 2분마다 환율 갱신
loadCmcKrw();
setInterval(loadCmcKrw, 600000);
restartRefreshTimer();
