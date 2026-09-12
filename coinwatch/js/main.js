import { state } from "./state.js";
import { loadFromGecko, loadFromBinance, fetchCmcKrw } from "./api.js";
import { enrichIntlPrices, enrichDomesticPrices } from "./pricing.js";
import { buildCoinsList, renderGrid } from "./watchlist.js";
import { renderMarketGrid } from "./market.js";
import { renderPortfolio } from "./portfolio.js";
import { updateChartPrice } from "./chart.js";
import { ensureUsdKrw, refreshUsdKrw, renderFxMini } from "./fx.js";
import { loadFearGreed } from "./fng.js";
import { loadState, applyLoadedUIState } from "./persist.js";
import { restartRefreshTimer } from "./settings.js";

// 이 모듈들은 자기 파일 안에서 이벤트 리스너를 등록하는 부수효과를 가지므로
// import만으로 화면 배선이 끝난다. 서로 순환 참조하지만 실제 호출은
// 전부 함수 본문 안(이벤트 콜백 등)에서 일어나므로 로드 순서 문제는 없다.
import "./chart.js";

export async function loadMarkets(){
  try{
    let list = await loadFromGecko();
    state.allTickers = list;
    state.lastSource = "gecko";
  }catch(e1){
    try{
      state.allTickers = await loadFromBinance();
      state.lastSource = "binance";
    }catch(e2){
      document.getElementById("gridWrap").innerHTML =
        '<div class="loading">시세를 불러오지 못했습니다.<br>(' + e1.message + ' / ' + e2.message + ')<br>네트워크 연결을 확인하고 아래 버튼을 눌러주세요.</div>' +
        '<button class="more-btn" id="marketsRetryBtn" style="margin-top:0;">다시 시도</button>';
      document.getElementById("marketsRetryBtn").addEventListener("click", loadMarkets);
      return;
    }
  }
  // allTickers는 매번 새로 받아오므로, 검색으로 추가한 시총 500위 밖 코인은 여기서 다시 합쳐줌
  Object.values(state.virtualCoins).forEach(v=>{
    if(!state.allTickers.find(c=>c.id===v.id)) state.allTickers.push(v);
  });
  // 최초 로드 시에는 시총 상위 8개를 기본 관심 코인으로 지정
  if(state.watchlist.length === 0){
    state.watchlist = state.allTickers.slice(0,8).map(c=>c.id);
  }
  state.coinsList = buildCoinsList(); // 우선 캐시된 값(있다면)으로 즉시 렌더
  renderGrid();
  renderMarketGrid();
  document.getElementById("updatedAt").textContent = "업데이트: " + new Date().toLocaleTimeString() + (state.lastSource==="gecko" ? " (대체 소스)":"");
  if(state.coinsList.length > 0){
    let enriched = await enrichIntlPrices(state.coinsList);
    await ensureUsdKrw();
    enriched = await enrichDomesticPrices(enriched);
    enriched.forEach(c=>{
      state.enrichedCache[c.id] = {
        current_price: c.current_price,
        price_change_percentage_24h: c.price_change_percentage_24h,
        exUsd: c.exUsd,
        baseUsdPrice: c.baseUsdPrice,
        domestic: c.domestic
      };
    });
    state.coinsList = buildCoinsList();
    renderGrid();
    renderMarketGrid();
  }
  updateChartPrice();
  renderPortfolio();
}

async function loadCmcKrw(){
  try{
    const m = await fetchCmcKrw();
    if(m){
      state.cmcKrwMap = m;
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
