import { EX_LABEL } from "./constants.js";
import { state } from "./state.js";
import { reapplyIntlFilter } from "./pricing.js";
import { renderGrid } from "./watchlist.js";
import { renderMarketGrid } from "./market.js";
import { renderPortfolio } from "./portfolio.js";
import { updateChartPrice } from "./chart.js";
import { ensureUsdKrw } from "./fx.js";
import { saveState } from "./persist.js";
import { loadMarkets } from "./main.js";

// ---------- 탭 전환 ----------
document.querySelectorAll(".tab").forEach(tab=>{
  tab.addEventListener("click", async ()=>{
    document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("view-"+tab.dataset.tab).classList.add("active");
    if(tab.dataset.tab === "market") renderMarketGrid();
  });
});

// ---------- 설정 ----------
document.getElementById("exchangeOpts").addEventListener("click", (e)=>{
  const opt = e.target.closest(".opt");
  if(!opt) return;
  const ex = opt.dataset.ex;
  if(ex === "avg"){
    state.intlExchangeFilter.clear(); // "평균" = 개별 필터 초기화 → 자동으로 5개 전체 평균
  }else{
    if(state.intlExchangeFilter.has(ex)) state.intlExchangeFilter.delete(ex);
    else state.intlExchangeFilter.add(ex);
  }
  renderExchangeOpts();
  reapplyIntlFilter();
  saveState();
});

export function renderExchangeOpts(){
  const isAvg = state.intlExchangeFilter.size === 0;
  document.querySelectorAll("#exchangeOpts .opt").forEach(o=>{
    const ex = o.dataset.ex;
    const active = ex === "avg" ? isAvg : (!isAvg && state.intlExchangeFilter.has(ex));
    o.classList.toggle("active", active);
  });
  const label = isAvg ? "5거래소 평균" : [...state.intlExchangeFilter].map(x=>EX_LABEL[x]).join("+");
  if(document.getElementById("chartPanel").style.display !== "none"){
    document.getElementById("chartSrcNote").textContent = "가격 기준: " + label;
  }
}

document.getElementById("currencyOpts").addEventListener("click", async (e)=>{
  const opt = e.target.closest(".opt");
  if(!opt) return;
  document.querySelectorAll("#currencyOpts .opt").forEach(o=>o.classList.remove("active"));
  opt.classList.add("active");
  state.displayCurrency = opt.dataset.cur;
  if(!state.usdKrw) await ensureUsdKrw();
  renderGrid(); // gridSignature에 displayCurrency가 포함돼 있어 자동으로 헤더까지 다시 그려짐
  renderMarketGrid();
  updateChartPrice();
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
  state.refreshSec = Number(opt.dataset.sec);
  restartRefreshTimer();
  saveState();
});

export function restartRefreshTimer(){
  if(state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(loadMarkets, state.refreshSec*1000);
}
