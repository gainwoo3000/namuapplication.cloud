import { state } from "./state.js";
import { fetchUsdKrw } from "./api.js";
import { renderGrid } from "./watchlist.js";
import { renderMarketGrid } from "./market.js";
import { renderPortfolio } from "./portfolio.js";
import { syncFxChartPrice } from "./fxchart.js";

// 헤더의 원/달러 환율 표시 갱신
export function renderFxMini(){
  const box = document.getElementById("fxMini");
  if(!box) return;
  if(state.usdKrw){
    document.getElementById("fxRate").textContent =
      state.usdKrw.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    box.style.display = "block";
    syncFxChartPrice(); // 환율 그래프가 열려 있으면 패널 위 큰 숫자도 같이 갱신
  }else{
    box.style.display = "none";
  }
}

export async function ensureUsdKrw(){
  if(state.usdKrw) return state.usdKrw;
  const rate = await fetchUsdKrw();
  if(rate) state.usdKrw = rate;
  renderFxMini();
  return state.usdKrw;
}

// 주기적으로 환율을 다시 받아와 표시/원화 환산을 최신으로 유지 (실패 시 직전 값 유지)
export async function refreshUsdKrw(){
  const rate = await fetchUsdKrw();
  if(rate && rate !== state.usdKrw){
    state.usdKrw = rate;
    renderFxMini();
    renderGrid();
    renderMarketGrid();
    renderPortfolio();
  }else{
    renderFxMini();
  }
}
