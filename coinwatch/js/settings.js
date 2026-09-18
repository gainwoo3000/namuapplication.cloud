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
// 탭 순서는 마크업 순서를 그대로 따른다 (좌우 스와이프도 이 순서로 넘어감)
export const TAB_ORDER = [...document.querySelectorAll(".tab")].map(t=>t.dataset.tab);

export function currentTabName(){
  const t = document.querySelector(".tab.active");
  return t ? t.dataset.tab : TAB_ORDER[0];
}

// 탭마다 마지막으로 보던 스크롤 위치. 탭을 떠날 때 적어두고 돌아오면 그 자리로 되돌린다.
// (탭마다 길이가 크게 달라서 스크롤을 그냥 이어받으면 짧은 탭에서 엉뚱한 곳이 보인다)
const scrollByTab = {};

// 새 탭은 눌린(또는 밀린) 방향에서 미끄러져 들어온다.
export function activateTab(name){
  const tab = document.querySelector(`.tab[data-tab="${name}"]`);
  const view = document.getElementById("view-" + name);
  if(!tab || !view || tab.classList.contains("active")) return;
  const dir = TAB_ORDER.indexOf(name) > TAB_ORDER.indexOf(currentTabName()) ? 1 : -1;
  scrollByTab[currentTabName()] = window.scrollY;
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active", "slide-left", "slide-right"));
  tab.classList.add("active");
  view.classList.add("active", dir > 0 ? "slide-left" : "slide-right");
  if(name === "market") renderMarketGrid(); // 높이가 확정된 뒤에 스크롤을 되돌려야 한다
  window.scrollTo(0, scrollByTab[name] || 0);
}

document.querySelectorAll(".tab").forEach(tab=>{
  tab.addEventListener("click", ()=> activateTab(tab.dataset.tab));
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

// ---------- 글자 크기 ----------
export function applyFontScale(){
  document.documentElement.style.setProperty("--fs", state.fontScale);
}

document.getElementById("fontOpts").addEventListener("click", (e)=>{
  const opt = e.target.closest(".opt");
  if(!opt) return;
  document.querySelectorAll("#fontOpts .opt").forEach(o=>o.classList.remove("active"));
  opt.classList.add("active");
  state.fontScale = Number(opt.dataset.fs);
  applyFontScale(); // 헤더 높이가 바뀌면 layout.js가 --topbar-h를 알아서 다시 잰다
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
