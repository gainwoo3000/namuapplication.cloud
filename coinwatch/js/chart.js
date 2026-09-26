// 코인을 누르면 뜨는 하단(넓은 화면에서는 오른쪽) 패널.
// 패널 안에는 화면이 둘 있다:
//   1) 자체 차트 — coinchart.js가 SVG로 직접 그린다. 테마·글자 크기·표시 통화가 그대로 먹는다.
//   2) 트레이딩뷰 상세 — 지표·드로잉툴이 필요할 때만 "상세"로 연다.
// 트레이딩뷰 스크립트(tv.js)는 상세를 처음 누를 때 받아온다. 예전처럼 index.html에서
// 통째로 불러오면 차트를 한 번도 안 여는 사람까지 매번 그 스크립트를 내려받는다.
import { state } from "./state.js";
import { TV_RANGE_MAP } from "./constants.js";
import { prevValues, rollNumberByKey, flashOnChange } from "./animate.js";
import { fmtDisplayPrice, displayPriceNum, fmtChg, chgClass } from "./format.js";
import { findCoinAnywhere, renderGrid } from "./watchlist.js";
import { renderMarketGrid } from "./market.js";
import { ensureUsdKrw } from "./fx.js";
import { closeFxChart } from "./fxchart.js";
import { openCoinChart, closeCoinChart, refreshCoinChart } from "./coinchart.js";

// 트레이딩뷰 상세를 보고 있는지. 코인을 바꿔도, 패널을 닫았다 열어도 그대로 따라간다 —
// 지표를 보려고 상세를 켠 사람은 다음 코인도 상세로 보고 싶어한다.
// 다만 새로고침까지 남기지는 않는다(설정과 달리 localStorage에 넣지 않는다). 앱을 열자마자
// 상세가 뜨면 tv.js를 매번 받게 되는데, 그걸 피하려고 지연 로드로 바꾼 것이기 때문이다.
let tvOpen = false;

// 차트 패널 우상단 가격. 자체 차트가 떠 있으면 그 차트가 "마지막 점 = 큰 숫자"로 맞춰 쓰므로
// 여기서 따로 건드리지 않고 다시 그리기만 시킨다.
export function updateChartPrice(){
  if(!state.selectedCoinId) return;
  if(!tvOpen){ refreshCoinChart(); return; }
  const c = state.coinsList.find(x=>x.id===state.selectedCoinId) || findCoinAnywhere(state.selectedCoinId);
  if(!c) return;
  const el = document.getElementById("chartCoinPrice");
  const text = fmtDisplayPrice(c.current_price), num = displayPriceNum(c.current_price);
  rollNumberByKey("chart:price", el, text, num);
  flashOnChange(el.parentElement, c.id + ":" + state.displayCurrency, text, num);
}

// 시세/포트폴리오 어느 탭에서든 코인을 누르면 차트 패널이 뜬다.
export async function selectCoin(id){
  const c = state.coinsList.find(x=>x.id===id) || findCoinAnywhere(id);
  if(!c) return;
  state.selectedCoinId = id;
  closeFxChart(); // 환율 그래프와 같은 자리를 쓰므로 둘 중 하나만 열린다
  renderGrid();
  renderMarketGrid();
  const panel = document.getElementById("chartPanel");
  panel.style.display = "block";
  document.body.classList.add("chart-open");
  document.getElementById("chartCoinName").textContent = `${c.name} (${c.symbol.toUpperCase()})`;
  if(state.displayCurrency === "krw" && !state.usdKrw) await ensureUsdKrw();
  // 차트가 그려지기 전 잠깐 채워두는 값. 곧 차트의 마지막 점으로 덮인다.
  document.getElementById("chartCoinPrice").innerHTML = '<span class="roll-cur">' + fmtDisplayPrice(c.current_price) + '</span>';
  prevValues["chart:price"] = displayPriceNum(c.current_price);
  if(tvOpen){
    // 상세를 보던 중이면 새 코인도 상세로 연다
    closeCoinChart();   // 자체 차트가 옛 코인을 붙들고 있지 않게 정리
    showTvChart();
    renderTVChart();
  }else{
    showSelfChart();
    openCoinChart(c);
  }
}

export function closeChart(){
  state.selectedCoinId = null;
  document.getElementById("chartPanel").style.display = "none";
  closeCoinChart();
  teardownTv();   // iframe은 놓아준다. 다음에 열 때 다시 만든다 (tvOpen은 그대로 둔다)
  document.body.classList.remove("chart-open");
  renderGrid();
  renderMarketGrid();
}
document.getElementById("chartCloseBtn").addEventListener("click", closeChart);

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
