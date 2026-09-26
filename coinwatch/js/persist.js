import { STORAGE_KEY, MAX_PORTFOLIOS } from "./constants.js";
import { state } from "./state.js";
import { renderExchangeOpts, applyFontScale } from "./settings.js";
import { renderPortfolioHeaderBtn, syncPfExCheckboxes, renderSortLabel } from "./portfolio.js";

// 마지막 저장이 실패했는지. 설정 탭의 "저장 상태"가 이 값을 읽어 보여준다.
export let storageError = null;

// 브라우저에게 "이 데이터는 함부로 지우지 말아달라"고 요청한다.
// 이걸 안 하면 저장소가 evictable 상태로 남아, 안드로이드 크롬은 기기 저장공간이
// 부족할 때 이런 데이터를 실제로 비운다(아이폰 사파리는 이 방식으로 지우지 않는다).
// 허용 여부는 브라우저가 방문 빈도·홈 화면 추가 여부 등을 보고 스스로 정한다.
export async function requestPersistentStorage(){
  try{
    if(!navigator.storage || !navigator.storage.persist) return null;
    if(await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  }catch(e){ return null; }
}

// 저장이 실제로 되는지 실제로 써보고 확인한다 (프라이빗 모드·인앱 브라우저에서는 막힌다)
export function storageDiagnostics(){
  let writable = false, err = null;
  try{
    const k = "__cw_probe";
    localStorage.setItem(k, "1");
    writable = localStorage.getItem(k) === "1";
    localStorage.removeItem(k);
  }catch(e){ err = e && e.name ? e.name : String(e); }
  return {
    // 주소(origin)는 일부러 담지 않는다 — 홈 화면 웹앱으로 쓰는 화면이라 URL이 드러나면 안 된다
    writable,
    error: err || storageError,
    hasSaved: (()=>{ try{ return !!localStorage.getItem(STORAGE_KEY); }catch(e){ return false; } })()
  };
}

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
      fontScale: state.fontScale,
      chartStyle: state.chartStyle,
      showVolume: state.showVolume,
      theme: document.body.classList.contains("light-theme") ? "light" : "dark",
      refreshSec: state.refreshSec,
      pfSortMode: state.pfSortMode,
      virtualCoins: Object.fromEntries(
        Object.entries(state.virtualCoins).map(([id,c])=>[id, {id:c.id, symbol:c.symbol, name:c.name, tvSymbol:c.tvSymbol}])
      )
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    storageError = null;
  }catch(e){
    // 저장이 막혀도 앱은 계속 동작하되, 조용히 넘기지 않는다 —
    // 설정이 왜 안 남는지 사용자가 알 수 있어야 한다.
    storageError = e && e.name ? e.name : String(e);
  }
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
    if(saved.fontScale > 0) state.fontScale = saved.fontScale;
    if(["line","candle"].includes(saved.chartStyle)) state.chartStyle = saved.chartStyle;
    if(typeof saved.showVolume === "boolean") state.showVolume = saved.showVolume;
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
  applyFontScale();
  document.querySelectorAll("#fontOpts .opt").forEach(o=>{
    o.classList.toggle("active", Number(o.dataset.fs) === state.fontScale);
  });
  renderPortfolioHeaderBtn();
  syncPfExCheckboxes();
  renderSortLabel();
}
