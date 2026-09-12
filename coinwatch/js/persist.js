import { STORAGE_KEY, MAX_PORTFOLIOS } from "./constants.js";
import { state } from "./state.js";
import { renderExchangeOpts } from "./settings.js";
import { renderPortfolioHeaderBtn, syncPfExCheckboxes, renderSortLabel } from "./portfolio.js";

// ---------- 로컬 저장 ----------
export function saveState(){
  try{
    const saved = {
      watchlist: state.watchlist,
      portfolios: state.portfolios,
      activePortfolioIdx: state.activePortfolioIdx,
      myExchanges: [...state.myExchanges],
      intlExchangeFilter: [...state.intlExchangeFilter],
      displayCurrency: state.displayCurrency,
      theme: document.body.classList.contains("light-theme") ? "light" : "dark",
      refreshSec: state.refreshSec,
      pfSortMode: state.pfSortMode,
      virtualCoins: Object.fromEntries(
        Object.entries(state.virtualCoins).map(([id,c])=>[id, {id:c.id, symbol:c.symbol, name:c.name, tvSymbol:c.tvSymbol}])
      )
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }catch(e){ /* 저장 실패(프라이빗 브라우징 등)해도 앱은 계속 동작 */ }
}

export function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return;
    const saved = JSON.parse(raw);
    if(Array.isArray(saved.watchlist)) state.watchlist = saved.watchlist;
    if(Array.isArray(saved.portfolios) && saved.portfolios.length > 0){
      state.portfolios = saved.portfolios.map(p=>({
        name: p.name || "포트폴리오",
        holdings: Array.isArray(p.holdings) ? p.holdings : [],
        exchanges: Array.isArray(p.exchanges) && p.exchanges.length ? p.exchanges : ["upbit"]
      })).slice(0, MAX_PORTFOLIOS);
      state.activePortfolioIdx = Number.isInteger(saved.activePortfolioIdx) && saved.activePortfolioIdx < state.portfolios.length
        ? saved.activePortfolioIdx : 0;
    }else if(Array.isArray(saved.portfolio)){
      // 구버전(단일 포트폴리오) 데이터 마이그레이션
      state.portfolios = [{ name:"포트폴리오 1", holdings: saved.portfolio, exchanges:["upbit"] }];
      state.activePortfolioIdx = 0;
    }
    if(Array.isArray(saved.myExchanges)) state.myExchanges = new Set(saved.myExchanges);
    if(Array.isArray(saved.intlExchangeFilter)) state.intlExchangeFilter = new Set(saved.intlExchangeFilter);
    if(saved.displayCurrency) state.displayCurrency = saved.displayCurrency;
    if(saved.refreshSec) state.refreshSec = saved.refreshSec;
    if(["added","asc","desc"].includes(saved.pfSortMode)) state.pfSortMode = saved.pfSortMode;
    if(saved.virtualCoins){
      Object.entries(saved.virtualCoins).forEach(([id,c])=>{
        state.virtualCoins[id] = {...c, current_price:null, price_change_percentage_24h:null, rank:null};
      });
    }
    if(saved.theme === "light") document.body.classList.add("light-theme");
  }catch(e){ /* 저장된 값이 손상됐으면 무시하고 기본값 사용 */ }
}

// 불러온 설정값을 화면의 토글/체크박스에도 반영
export function applyLoadedUIState(){
  document.querySelectorAll(".myx-check").forEach(cb=>{ cb.checked = state.myExchanges.has(cb.value); });
  renderExchangeOpts();
  document.querySelectorAll("#currencyOpts .opt").forEach(o=>{
    o.classList.toggle("active", o.dataset.cur === state.displayCurrency);
  });
  const isLight = document.body.classList.contains("light-theme");
  document.querySelectorAll("#themeOpts .opt").forEach(o=>{
    o.classList.toggle("active", (o.dataset.theme === "light") === isLight);
  });
  document.querySelectorAll("#refreshOpts .opt").forEach(o=>{
    o.classList.toggle("active", Number(o.dataset.sec) === state.refreshSec);
  });
  renderPortfolioHeaderBtn();
  syncPfExCheckboxes();
  renderSortLabel();
}
