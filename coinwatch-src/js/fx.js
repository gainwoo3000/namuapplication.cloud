import { state } from "./state.js";
import { chgClass } from "./format.js";
import { renderMcapMini } from "./mcap.js";
import { fetchUsdKrw } from "./api.js";
import { renderGrid } from "./watchlist.js";
import { renderMarketGrid } from "./market.js";
import { renderPortfolio } from "./portfolio.js";
import { refreshFxChart } from "./fxchart.js";

// 헤더 지수 띠의 원/달러 칸 갱신: 현재가 + 전일 종가 대비 등락률(▲▼)
export function renderFxMini(){
  const box = document.getElementById("fxMini");
  if(!box) return;
  if(state.usdKrw){
    document.getElementById("fxRate").textContent =
      state.usdKrw.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    const chg = document.getElementById("fxChg");
    const prev = state.usdKrwPrev;
    if(prev > 0){
      const pct = (state.usdKrw - prev) / prev * 100;
      const cls = chgClass(pct);
      chg.textContent = (cls === "up" ? "▲" : cls === "down" ? "▼" : "") + Math.abs(pct).toFixed(2) + "%";
      chg.className = "tk-chg " + cls;
    }else{
      chg.textContent = ""; // 폴백 출처로 받은 환율이라 전일 종가를 모른다
    }
    box.classList.remove("is-loading"); // 자리표시를 걷고 진짜 값을 드러낸다
    box.disabled = false;               // 이제 눌러서 추이 그래프를 열 수 있다
    box.style.display = "";
    refreshFxChart(); // 환율 그래프가 열려 있으면 그래프도 같이 최신으로
    renderMcapMini(); // 원화로 보는 중이면 시총도 새 환율로
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
