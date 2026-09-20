import { EX_LABEL } from "./constants.js";
import { state } from "./state.js";
import { reapplyIntlFilter } from "./pricing.js";
import { renderGrid } from "./watchlist.js";
import { renderMarketGrid } from "./market.js";
import { renderPortfolio } from "./portfolio.js";
import { updateChartPrice } from "./chart.js";
import { ensureUsdKrw } from "./fx.js";
import { saveState, storageDiagnostics } from "./persist.js";
import { loadMarkets } from "./main.js";
import { revealTopbar } from "./layout.js";

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
  revealTopbar(); // 위치를 건너뛴 것이지 아래로 내린 게 아니므로 헤더는 보인 채로 둔다
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

// ---------- 설정 › 저장 상태 ----------
// "아이폰은 설정이 남는데 안드로이드는 풀린다" 같은 증상은 기기에서 직접 보지 않으면
// 원인을 못 가린다(브라우저마다 저장소가 따로고, 인앱 브라우저는 닫으면 지우기도 한다).
// 그래서 지금 이 브라우저의 상태를 그대로 보여준다.
export async function renderStorageDiag(){
  const el = document.getElementById("storageDiag");
  if(!el) return;
  const d = storageDiagnostics();
  let persisted = null;
  try{ persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; }catch(e){}

  const lines = [];
  // 주소는 적지 않는다 — 홈 화면 웹앱으로 쓰는 화면이라 URL이 드러나면 안 된다.
  // 진단에 필요한 건 "저장이 되는가 / 보호되는가 / 보안 연결인가" 셋뿐이고 URL 없이 다 알 수 있다.
  if(location.protocol !== "https:" && location.hostname.indexOf(".") > 0){
    lines.push(`<b>보안 연결이 아닙니다</b> — 이 상태로 저장한 설정은 보안 연결로 들어오면 보이지 않아요.`);
  }
  if(!d.writable){
    lines.push(`<b>저장 안 됨</b> — 이 브라우저에서는 저장이 막혀 있어요${d.error ? ` (${d.error})` : ""}.` +
               ` 시크릿 모드이거나, 카카오톡·인스타그램 같은 앱 안의 브라우저로 열었을 때 그렇습니다.` +
               ` 크롬·사파리 같은 브라우저로 직접 열어주세요.`);
  }else if(persisted === true){
    lines.push(`저장 <b>정상</b> · 이 기기에서 지워지지 않도록 보호됨`);
  }else{
    lines.push(`저장 <b>정상</b> · 다만 <b>보호되지 않은 상태</b>라, 기기 저장공간이 부족하면` +
               ` 브라우저가 이 데이터를 지울 수 있어요. 홈 화면에 추가해두면 보호될 확률이 높아집니다.`);
  }
  el.innerHTML = lines.join("<br>");
}
