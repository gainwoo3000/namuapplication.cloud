import { state } from "./state.js";
import { TV_RANGE_MAP, STABLECOINS } from "./constants.js";
import { prevValues, rollNumberByKey } from "./animate.js";
import { fmtDisplayPrice, displayPriceNum } from "./format.js";
import { findCoinAnywhere, renderGrid } from "./watchlist.js";
import { renderMarketGrid } from "./market.js";
import { ensureUsdKrw } from "./fx.js";

// 차트 패널 우상단 가격: "표시 통화" 설정(displayCurrency)에 맞춰 USD/KRW로 보여준다
export function updateChartPrice(){
  if(!state.selectedCoinId) return;
  const c = state.coinsList.find(x=>x.id===state.selectedCoinId) || findCoinAnywhere(state.selectedCoinId);
  if(!c) return;
  rollNumberByKey("chart:price", document.getElementById("chartCoinPrice"),
    fmtDisplayPrice(c.current_price), displayPriceNum(c.current_price));
}

// 시세/포트폴리오 어느 탭에서든 코인을 누르면 하단 차트 패널이 뜬다.
export async function selectCoin(id){
  const c = state.coinsList.find(x=>x.id===id) || findCoinAnywhere(id);
  if(!c) return;
  state.selectedCoinId = id;
  renderGrid();
  renderMarketGrid();
  const panel = document.getElementById("chartPanel");
  panel.style.display = "block";
  document.body.classList.add("chart-open");
  document.getElementById("chartCoinName").textContent = `${c.name} (${c.symbol.toUpperCase()})`;
  if(state.displayCurrency === "krw" && !state.usdKrw) await ensureUsdKrw();
  document.getElementById("chartCoinPrice").innerHTML = '<span class="roll-cur">' + fmtDisplayPrice(c.current_price) + '</span>';
  prevValues["chart:price"] = displayPriceNum(c.current_price);
  renderTVChart(c, state.currentDays);
}

export function closeChart(){
  state.selectedCoinId = null;
  document.getElementById("chartPanel").style.display = "none";
  document.getElementById("tvChartContainer").innerHTML = "";
  document.body.classList.remove("chart-open");
  renderGrid();
  renderMarketGrid();
}
document.getElementById("chartCloseBtn").addEventListener("click", closeChart);

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
