// 코인을 누르면 오른쪽에서 밀려 들어오는 코인 상세 페이지.
// 페이지 이동 없이(SPA) 목록 위에 겹쳐 띄우고, 방문 기록에 #coin/<id>를 한 칸 쌓는다 —
// 그래서 폰의 뒤로 가기·iOS 가장자리 스와이프로도 닫히고, 그 주소로 바로 열 수도 있다.
// 페이지 안에는 화면이 둘 있다:
//   1) 자체 차트 — coinchart.js가 SVG로 직접 그린다. 테마·글자 크기·표시 통화가 그대로 먹는다.
//   2) 트레이딩뷰 상세 — 지표·드로잉툴이 필요할 때만 "상세"로 연다.
// 트레이딩뷰 스크립트(tv.js)는 상세를 처음 누를 때 받아온다. 예전처럼 index.html에서
// 통째로 불러오면 차트를 한 번도 안 여는 사람까지 매번 그 스크립트를 내려받는다.
import { state } from "./state.js";
import { TV_RANGE_MAP } from "./constants.js";
import { prevValues, rollNumberByKey, flashOnChange } from "./animate.js";
import { fmtDisplayPrice, displayPriceNum, fmtChg, chgClass, fmtKrw, fmtPrice } from "./format.js";
import { findCoinAnywhere, renderGrid } from "./watchlist.js";
import { renderMarketGrid } from "./market.js";
import { ensureUsdKrw } from "./fx.js";
import { closeFxChart } from "./fxchart.js";
import { openCoinChart, closeCoinChart, refreshCoinChart } from "./coinchart.js";
import { fetchCoinCandles } from "./api.js";
import { range24hPct } from "./rangebar.js";

// 트레이딩뷰 상세를 보고 있는지. 코인을 바꿔도, 패널을 닫았다 열어도 그대로 따라간다 —
// 지표를 보려고 상세를 켠 사람은 다음 코인도 상세로 보고 싶어한다.
// 다만 새로고침까지 남기지는 않는다(설정과 달리 localStorage에 넣지 않는다). 앱을 열자마자
// 상세가 뜨면 tv.js를 매번 받게 되는데, 그걸 피하려고 지연 로드로 바꾼 것이기 때문이다.
let tvOpen = false;

// 차트 패널 우상단 가격. 자체 차트가 떠 있으면 그 차트가 "마지막 점 = 큰 숫자"로 맞춰 쓰므로
// 여기서 따로 건드리지 않고 다시 그리기만 시킨다.
export function updateChartPrice(){
  if(!state.selectedCoinId) return;
  const c = state.coinsList.find(x=>x.id===state.selectedCoinId) || findCoinAnywhere(state.selectedCoinId);
  if(c) renderCoinStats(c); // 시세 갱신마다 카드의 1일 등락률·시가총액도 새 값으로
  if(!tvOpen){ refreshCoinChart(); return; }
  if(!c) return;
  const el = document.getElementById("chartCoinPrice");
  const text = fmtDisplayPrice(c.current_price), num = displayPriceNum(c.current_price);
  rollNumberByKey("chart:price", el, text, num);
  flashOnChange(el.parentElement, c.id + ":" + state.displayCurrency, text, num);
}

// ---------- 페이지 여닫기 ----------
const page = document.getElementById("chartPanel");
const COIN_HASH = /^#coin\/(.+)$/;

function showPage(){
  if(page.classList.contains("open")) return;
  page.scrollTop = 0;
  page.setAttribute("aria-hidden", "false");
  document.body.classList.add("coin-page-open");
  page.classList.add("open");
}

function hidePage(){
  state.selectedCoinId = null;
  page.classList.remove("open");
  page.setAttribute("aria-hidden", "true");
  document.body.classList.remove("coin-page-open");
  closeCoinChart();
  teardownTv();   // iframe은 놓아준다. 다음에 열 때 다시 만든다 (tvOpen은 그대로 둔다)
  renderGrid();
  renderMarketGrid();
}

// 시세/관심 코인/포트폴리오 어느 탭에서든 코인을 누르면 상세 페이지가 뜬다.
// fromHistory: 뒤로·앞으로 가기나 주소(#coin/<id>)로 여는 경우 — 방문 기록을 또 쌓지 않는다.
export async function selectCoin(id, fromHistory){
  const c = state.coinsList.find(x=>x.id===id) || findCoinAnywhere(id);
  if(!c) return false;
  if(!fromHistory){
    const url = "#coin/" + encodeURIComponent(id);
    // 이미 페이지가 떠 있으면(그럴 일은 드물지만) 기록을 갈아끼워 뒤로 한 번에 목록으로 돌아가게
    // pushed: 이 칸은 목록 위에 우리가 쌓은 것 — 닫을 때 뒤로 가기로 돌아가도 된다는 표시
    if(history.state && history.state.coinPage) history.replaceState({ coinPage: id, pushed: history.state.pushed }, "", url);
    else history.pushState({ coinPage: id, pushed: true }, "", url);
  }
  state.selectedCoinId = id;
  closeFxChart(); // 환율 그래프가 떠 있었으면 닫는다
  renderGrid();
  renderMarketGrid();
  document.getElementById("chartCoinName").textContent = `${c.name} (${c.symbol.toUpperCase()})`;
  showPage();
  if(state.displayCurrency === "krw" && !state.usdKrw) await ensureUsdKrw();
  // 차트가 그려지기 전 잠깐 채워두는 값. 곧 차트의 마지막 점으로 덮인다.
  document.getElementById("chartCoinPrice").innerHTML = '<span class="roll-cur">' + fmtDisplayPrice(c.current_price) + '</span>';
  prevValues["chart:price"] = displayPriceNum(c.current_price);
  renderCoinStats(c);
  if(tvOpen){
    // 상세를 보던 중이면 새 코인도 상세로 연다
    closeCoinChart();   // 자체 차트가 옛 코인을 붙들고 있지 않게 정리
    showTvChart();
    renderTVChart();
  }else{
    showSelfChart();
    openCoinChart(c);
  }
  return true;
}

// 닫기(뒤로 버튼, 관심 코인에서 지운 코인 등). 우리가 쌓은 기록이 있으면 뒤로 가기로 닫아서
// 방문 기록과 화면이 어긋나지 않게 한다 — 실제로 닫는 건 popstate에서 hidePage가 한다.
export function closeChart(){
  if(!state.selectedCoinId && !page.classList.contains("open")) return;
  if(history.state && history.state.pushed) history.back();
  else{
    // 주소로 바로 열어 아래에 목록 칸이 없는 경우 — 여기서 뒤로 가면 사이트 밖으로 나가 버린다.
    // 주소의 #coin/… 만 지우고 닫는다
    if(COIN_HASH.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
    hidePage();
  }
}
document.getElementById("chartCloseBtn").addEventListener("click", closeChart);

window.addEventListener("popstate", e=>{
  const id = e.state && e.state.coinPage;
  if(id) selectCoin(id, true);         // 앞으로 가기로 다시 온 경우
  else if(page.classList.contains("open")) hidePage();
});

// 주소창에 #coin/<id>를 직접 넣은 경우(문서는 그대로라 새로 불러오지 않는다)
window.addEventListener("hashchange", ()=> openCoinFromHash());

// 주소가 #coin/<id>로 열렸으면 그 코인 페이지를 띄운다. 시세 목록이 도착한 뒤에 불러야
// 그 코인을 찾을 수 있다(main.js가 첫 로딩 뒤 부른다).
export function openCoinFromHash(){
  const m = location.hash.match(COIN_HASH);
  if(!m || page.classList.contains("open")) return;
  const id = decodeURIComponent(m[1]);
  selectCoin(id, true).then(ok=>{
    // 이 기록 칸에 표시를 달아 둬야 닫을 때·새로고침 뒤에도 같은 규칙으로 움직인다
    if(ok) history.replaceState({ coinPage: id }, "", location.href);
  });
}

// ---------- 차트 아래 요약 카드 ----------
// 시가총액은 CoinGecko(달러) 값을 표시 통화로 바꿔 쓰고, 1일 등락률은 시세 목록과 같은 값(거래소 24시간).
// 52주 등락률은 1년 봉을 따로 받아 첫 봉 종가 대비 마지막 봉 종가로 잰다 — 차트가 보고 있는 기간과
// 상관없이 늘 같은 기준. 코인마다 10분 동안은 다시 받지 않는다.
const yearCache = {};             // 코인 id -> { at, pct, short } (pct가 null이면 받을 수 없던 코인)
const YEAR_TTL = 10 * 60 * 1000;

function fmtBigKrw(v){
  if(v >= 1e12) return "₩" + (v / 1e12).toLocaleString(undefined, { maximumFractionDigits: v >= 1e14 ? 0 : 1 }) + "조";
  if(v >= 1e8)  return "₩" + Math.round(v / 1e8).toLocaleString() + "억";
  return "₩" + Math.round(v).toLocaleString();
}
function fmtBigUsd(v){
  if(v >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
  if(v >= 1e9)  return "$" + (v / 1e9).toFixed(v >= 1e11 ? 0 : 1) + "B";
  if(v >= 1e6)  return "$" + (v / 1e6).toFixed(v >= 1e8 ? 0 : 1) + "M";
  return "$" + Math.round(v).toLocaleString();
}

function setChg(el, pct){
  el.textContent = pct == null ? "-" : fmtChg(pct);
  el.className = "stat-value " + (pct == null ? "" : chgClass(pct));
}

// 막대 양 끝 가격. 카드 폭이 좁아 원화 큰 값은 줄여 쓴다(₩1.14억, ₩364만). 달러는 그대로.
// quote: 값이 들어 있는 통화("USD"|"KRW") — 표시 통화와 다르면 환율로 바꾼다.
function fmtEnd(v, quote){
  if(v == null || !(v > 0)) return "";
  const rate = state.usdKrw;
  if(state.displayCurrency === "krw"){
    const krw = quote === "KRW" ? v : (rate > 0 ? v * rate : null);
    if(krw == null) return fmtPrice(v);
    if(krw >= 1e8) return "₩" + (krw / 1e8).toFixed(2) + "억";
    if(krw >= 1e6) return "₩" + Math.round(krw / 1e4).toLocaleString() + "만";
    return fmtKrw(krw);
  }
  const usd = quote === "USD" ? v : (rate > 0 ? v / rate : null);
  return usd == null ? fmtKrw(v) : fmtPrice(usd);
}
function setEnds(loId, hiId, lo, hi, quote){
  document.getElementById(loId).textContent = fmtEnd(lo, quote);
  document.getElementById(hiId).textContent = fmtEnd(hi, quote);
}

// 표의 등락률 막대와 같은 모양. pos(0~100)가 없으면 자리는 두고 숨긴다. 점 색은 등락 방향(up/down).
function setBar(el, pos, pct){
  el.className = "range-bar" + (pos == null ? " is-empty" : "") + (pct == null ? "" : " " + chgClass(pct));
  el.firstElementChild.style.left = (pos == null ? 50 : pos) + "%";
}

function renderCoinStats(c){
  const cap = c.marketCap;
  const krw = state.displayCurrency === "krw" && state.usdKrw > 0;
  document.getElementById("statMcap").textContent =
    cap > 0 ? (krw ? fmtBigKrw(cap * state.usdKrw) : fmtBigUsd(cap)) : "-";
  document.getElementById("statMcapSub").textContent = c.rank ? "시총 " + c.rank + "위" : "";
  setChg(document.getElementById("stat1d"), c.price_change_percentage_24h ?? null);
  setBar(document.getElementById("stat1dBar"), range24hPct(c), c.price_change_percentage_24h ?? null);
  setEnds("stat1dLo", "stat1dHi", c.low_24h, c.high_24h, "USD"); // 시세 목록의 고저가는 달러 기준

  const el52 = document.getElementById("stat52w"), sub52 = document.getElementById("stat52wSub");
  const bar52 = document.getElementById("stat52wBar");
  const hit = yearCache[c.id];
  if(hit && hit.at){
    setChg(el52, hit.pct);
    setBar(bar52, hit.pos, hit.pct);
    setEnds("stat52wLo", "stat52wHi", hit.lo, hit.hi, hit.quote);
    sub52.textContent = hit.pct == null ? "데이터 없음" : hit.short ? "상장 이후 최저 ~ 최고" : "52주 최저 ~ 최고";
    if(Date.now() - hit.at < YEAR_TTL) return;
  }else{
    setChg(el52, null);          // 처음 받는 중
    setBar(bar52, null, null);
    setEnds("stat52wLo", "stat52wHi", null, null);
    sub52.textContent = "";
  }
  if(hit && hit.loading) return;  // 이미 받는 중이면 또 부르지 않는다
  yearCache[c.id] = { ...(hit || {}), loading: true };
  fetchCoinCandles(c, 365).then(res=>{
    const k = res && res.candles;
    const first = k && k[0], last = k && k[k.length - 1];
    const pct = first && last && first.c > 0 ? (last.c / first.c - 1) * 100 : null;
    // 받아온 기간이 1년에 한참 못 미치면 상장한 지 1년이 안 된 코인이다
    const short = !!(first && last && last.t - first.t < 330 * 86400);
    // 52주 최저~최고 사이 현재가 위치 (막대의 점). 같은 봉 묶음 안에서만 비교하니 통화와 무관하다.
    let pos = null, lo = null, hi = null;
    if(k && k.length){
      lo = Math.min(...k.map(p => p.l)); hi = Math.max(...k.map(p => p.h));
      if(hi > lo) pos = Math.max(0, Math.min(100, (last.c - lo) / (hi - lo) * 100));
    }
    yearCache[c.id] = { at: Date.now(), pct, short, pos, lo, hi, quote: res && res.quote };
  }).catch(()=>{
    yearCache[c.id] = { at: Date.now(), pct: null, short: false, pos: null };
  }).then(()=>{
    if(state.selectedCoinId === c.id) renderCoinStats(c); // 그 사이 다른 코인으로 넘어갔으면 그리지 않는다
  });
}

// ---------- 두 화면 전환 ----------
function showSelfChart(){
  tvOpen = false;
  document.getElementById("coinChartView").hidden = false;
  document.getElementById("tvChartView").hidden = true;
}

function showTvChart(){
  tvOpen = true;
  document.getElementById("coinChartView").hidden = true;
  document.getElementById("tvChartView").hidden = false;
}

document.getElementById("tvOpenBtn").addEventListener("click", ()=>{
  showTvChart();
  renderTVChart();
});
document.getElementById("tvBackBtn").addEventListener("click", ()=>{
  teardownTv();
  showSelfChart();
  const c = state.coinsList.find(x=>x.id===state.selectedCoinId) || findCoinAnywhere(state.selectedCoinId);
  if(c) openCoinChart(c); // 캐시가 남아 있어 재요청 없이 바로 그려진다
});

// ---------- 트레이딩뷰 ----------
// 코인이 실제로 거래되는 거래소 데이터(c.exUsd / c.domestic)를 근거로 유효한 심볼을 고른다.
// 무조건 "BINANCE:SYMUSDT"로 찍으면 바이낸스에 없는 코인(래핑 토큰·코인베이스 전용·국내 상장 등)은
// "Invalid symbol"이 뜬다.
function guessTvSymbol(c){
  if(c.tvSymbol) return c.tvSymbol;
  const sym = c.symbol.toUpperCase();
  if(sym === "USDT") return "KRAKEN:USDTUSD"; // USDT/USDT 페어는 없다
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

// tv.js는 한 번만 받아오고, 그 약속을 재사용한다.
let tvScript = null;
function loadTvScript(){
  if(tvScript) return tvScript;
  tvScript = new Promise((resolve, reject)=>{
    const s = document.createElement("script");
    s.src = "https://s3.tradingview.com/tv.js";
    s.async = true;
    s.onload = ()=> resolve();
    s.onerror = ()=>{ tvScript = null; reject(new Error("tv.js")); }; // 다음에 다시 시도할 수 있게
    document.head.appendChild(s);
  });
  return tvScript;
}

// 위젯은 iframe을 띄우고 그 안에서 또 한참 그린다. 그동안 시커먼 빈 칸을
// 보여주는 대신 자리표시로 덮어둔다.
let tvSkTimer = null, tvSkPoll = null;

function clearTvWatch(){
  clearTimeout(tvSkTimer); clearInterval(tvSkPoll);
  tvSkTimer = tvSkPoll = null;
}
function setTvSkeleton(on){
  const el = document.getElementById("tvChartSk");
  if(el) el.hidden = !on;
}

function watchTvChart(){
  clearTvWatch();
  setTvSkeleton(true);
  const done = ()=>{ clearTvWatch(); setTvSkeleton(false); };
  let tries = 0;
  tvSkPoll = setInterval(()=>{
    const frame = document.querySelector("#tvChartContainer iframe");
    if(frame){
      clearInterval(tvSkPoll); tvSkPoll = null;
      // load 이벤트만 믿으면 안 된다 — 리스너를 붙이기 전에 이미 지나갔으면 영영 안 온다.
      // 그래서 시간 제한을 같이 걸고, 둘 중 먼저 오는 쪽에 걷는다.
      frame.addEventListener("load", ()=>{
        clearTimeout(tvSkTimer);
        tvSkTimer = setTimeout(done, 350); // 문서가 뜬 뒤 실제 차트가 그려질 짬을 조금 준다
      }, { once: true });
      tvSkTimer = setTimeout(done, 1600);
    }else if(++tries > 50){  // 5초 동안 iframe이 안 생기면 포기하고 걷는다
      done();
    }
  }, 100);
}

function teardownTv(){
  clearTvWatch();
  setTvSkeleton(false);
  const box = document.getElementById("tvChartContainer");
  if(box) box.innerHTML = "";
}

// 위젯 색은 iframe 밖에서 정할 수 있는 만큼은 앱 테마에 맞춘다.
// (무료 위젯은 custom_css_url을 못 써서 글꼴·글자 크기까지는 못 넘긴다 —
//  그래서 평소 화면은 자체 차트를 쓴다.)
function tvTheme(){
  const css = getComputedStyle(document.documentElement);
  const v = name => css.getPropertyValue(name).trim();
  return {
    theme: document.body.classList.contains("light-theme") ? "light" : "dark",
    toolbar_bg: v("--panel"),
    overrides: {
      "paneProperties.background": v("--panel"),
      "paneProperties.backgroundType": "solid",
      "paneProperties.vertGridProperties.color": v("--line"),
      "paneProperties.horzGridProperties.color": v("--line"),
      "scalesProperties.textColor": v("--muted"),
      "scalesProperties.lineColor": v("--line"),
      "mainSeriesProperties.candleStyle.upColor": v("--up"),
      "mainSeriesProperties.candleStyle.downColor": v("--down"),
      "mainSeriesProperties.candleStyle.borderUpColor": v("--up"),
      "mainSeriesProperties.candleStyle.borderDownColor": v("--down"),
      "mainSeriesProperties.candleStyle.wickUpColor": v("--up"),
      "mainSeriesProperties.candleStyle.wickDownColor": v("--down")
    }
  };
}

async function renderTVChart(){
  const c = state.coinsList.find(x=>x.id===state.selectedCoinId) || findCoinAnywhere(state.selectedCoinId);
  if(!c) return;
  const container = document.getElementById("tvChartContainer");
  container.innerHTML = "";
  watchTvChart();

  // 제목 아래 등락 줄은 자체 차트가 "보이는 구간"을 적는 자리다. 상세에는 보이는 구간이라는
  // 게 없고(트레이딩뷰가 제 마음대로 잡는다), 그냥 두면 코인을 바꿔도 이전 코인 값이 남는다.
  // 여기서는 24시간 등락으로 채운다 — 어느 코인이든 맞는 값이다.
  const sub = document.getElementById("chartCoinSub");
  sub.className = "panel-sub " + chgClass(c.price_change_percentage_24h);
  sub.textContent = "24시간 " + fmtChg(c.price_change_percentage_24h);

  try{
    await loadTvScript();
  }catch(e){
    clearTvWatch(); setTvSkeleton(false);
    document.getElementById("chartSrcNote").textContent =
      "트레이딩뷰를 불러오지 못했습니다. 네트워크를 확인하고 다시 눌러주세요.";
    return;
  }
  if(!tvOpen) return; // 받아오는 사이에 돌아가기를 눌렀으면 그리지 않는다

  const cfg = TV_RANGE_MAP[state.currentDays] || TV_RANGE_MAP[1];
  const tvSymbol = guessTvSymbol(c);
  try{
    new TradingView.widget({
      autosize: true,
      symbol: tvSymbol,
      interval: cfg.interval,
      range: cfg.range,
      timezone: "Asia/Seoul",
      style: "1",
      locale: "kr",
      enable_publishing: false,
      hide_legend: true,
      allow_symbol_change: false,
      save_image: false,
      container_id: "tvChartContainer",
      ...tvTheme()
    });
    document.getElementById("chartSrcNote").textContent = "차트: TradingView (" + tvSymbol + ")";
  }catch(e){
    clearTvWatch(); setTvSkeleton(false);
    document.getElementById("chartSrcNote").textContent =
      "TradingView 차트를 불러오지 못했습니다. 트레이딩뷰에 없는 심볼일 수 있어요.";
  }
}

// 설정에서 테마를 바꿨을 때. 자체 차트는 CSS 변수를 그대로 쓰니 저절로 바뀌지만,
// 트레이딩뷰 iframe은 만들 때 정한 색을 그대로 들고 있어서 다시 만들어야 한다.
export function syncChartTheme(){
  if(tvOpen) renderTVChart();
}
