import { STORAGE_KEY, MAX_PORTFOLIOS } from "./constants.js";
import { state } from "./state.js";
import { renderExchangeOpts, applyFontScale } from "./settings.js";
import { renderPortfolioHeaderBtn, syncPfExCheckboxes, renderSortLabel, showPfSection } from "./portfolio.js";
import { loadTrades, recomputeHoldings } from "./trades.js";
import { cleanText, cleanSym, cleanId } from "./sanitize.js";

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

// 저장된 값으로 받아 줄 수 있는 것들. 여기 없는 값은 버린다.
const MY_EXCHANGES = ["upbit","bithumb","coinone","binance","okx","bybit","coinbase","kraken","bitflyer"];
const INTL_EXCHANGES = ["binance","okx","bybit","coinbase","kraken"];
const FONT_SCALES = [1, 1.12, 1.24]; // 설정 › 글자 크기 버튼의 data-fs
const knownOnly = (arr, known) => Array.isArray(arr) ? [...new Set(arr.filter(x => known.includes(x)))] : [];

// ---------- 로컬 저장 ----------
// 저장하는 값 전체. 백업(backup.js)도 이것을 그대로 담는다 — 여기에 항목을 더하면 백업에도 들어간다.
export function buildSavedState(){
  return {
    watchlist: state.watchlist,
    portfolios: state.portfolios,
    activePortfolioIdx: state.activePortfolioIdx,
    myExchanges: [...state.myExchanges],
    intlExchangeFilter: [...state.intlExchangeFilter],
    displayCurrency: state.displayCurrency,
    fontScale: state.fontScale,
    chartStyle: state.chartStyle,
    showVolume: state.showVolume,
    showMA: state.showMA,
    theme: document.body.classList.contains("light-theme") ? "light" : "dark",
    pfSortMode: state.pfSortMode,
    pfSection: state.pfSection,
    pfOverview: state.pfOverview,
    virtualCoins: Object.fromEntries(
      Object.entries(state.virtualCoins).map(([id,c])=>[id, {id:c.id, symbol:c.symbol, name:c.name, tvSymbol:c.tvSymbol}])
    )
  };
}

// 백업을 불러와 새로 여는 사이에 화면 쪽 저장이 끼어들어 방금 넣은 내용을 덮지 않게 막는다
let savesFrozen = false;
export function freezeSaves(){ savesFrozen = true; }

export function saveState(){
  if(savesFrozen) return;
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildSavedState()));
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
    if(!saved || typeof saved !== "object") return;
    // 저장소는 백업 코드로도 채워지고(남이 준 코드일 수 있다) 개발자 도구로 고칠 수도 있다.
    // 값마다 모양을 확인하고, 이름·심볼은 sanitize.js로 다듬어서 받는다.
    if(Array.isArray(saved.watchlist)){
      state.watchlist = [...new Set(saved.watchlist.map(cleanId).filter(Boolean))];
    }
    if(Array.isArray(saved.portfolios) && saved.portfolios.length > 0){
      // 거래 기록이 없던 예전 데이터는 보유 수량을 "기존 보유"(단가 없는 매수)로 옮긴다
      state.portfolios = saved.portfolios.filter(p => p && typeof p === "object").map(p=>{
        const ex = knownOnly(p.exchanges, MY_EXCHANGES);
        return {
          name: cleanText(p.name, 20) || "포트폴리오",
          trades: loadTrades(p),
          exchanges: ex.length ? ex : ["upbit"]
        };
      }).slice(0, MAX_PORTFOLIOS);
      if(!state.portfolios.length) state.portfolios = [{ name:"포트폴리오 1", trades:[], exchanges:["upbit"] }];
      state.portfolios.forEach(recomputeHoldings);
      state.activePortfolioIdx = Number.isInteger(saved.activePortfolioIdx) && saved.activePortfolioIdx < state.portfolios.length
        ? saved.activePortfolioIdx : 0;
    }else if(Array.isArray(saved.portfolio)){
      // 구버전(단일 포트폴리오) 데이터 마이그레이션
      state.portfolios = [{ name:"포트폴리오 1", trades: loadTrades({ holdings: saved.portfolio }), exchanges:["upbit"] }];
      recomputeHoldings(state.portfolios[0]);
      state.activePortfolioIdx = 0;
    }
    if(Array.isArray(saved.myExchanges)) state.myExchanges = new Set(knownOnly(saved.myExchanges, MY_EXCHANGES));
    if(Array.isArray(saved.intlExchangeFilter)) state.intlExchangeFilter = new Set(knownOnly(saved.intlExchangeFilter, INTL_EXCHANGES));
    if(["usd","krw"].includes(saved.displayCurrency)) state.displayCurrency = saved.displayCurrency;
    if(FONT_SCALES.includes(saved.fontScale)) state.fontScale = saved.fontScale;
    if(["line","candle"].includes(saved.chartStyle)) state.chartStyle = saved.chartStyle;
    if(typeof saved.showVolume === "boolean") state.showVolume = saved.showVolume;
    if(typeof saved.showMA === "boolean") state.showMA = saved.showMA;
    if(["added","asc","desc"].includes(saved.pfSortMode)) state.pfSortMode = saved.pfSortMode;
    if(["holdings","trades"].includes(saved.pfSection)) state.pfSection = saved.pfSection;
    if(["assets","alloc"].includes(saved.pfOverview)) state.pfOverview = saved.pfOverview;
    if(saved.virtualCoins && typeof saved.virtualCoins === "object"){
      Object.values(saved.virtualCoins).forEach(c=>{
        if(!c || typeof c !== "object") return;
        const id = cleanId(c.id), symbol = cleanSym(c.symbol).toLowerCase();
        if(!id || !symbol) return;
        state.virtualCoins[id] = { id, symbol, name: cleanText(c.name) || symbol.toUpperCase(),
          tvSymbol: typeof c.tvSymbol === "string" ? cleanText(c.tvSymbol, 40) : undefined,
          current_price:null, price_change_percentage_24h:null, rank:null };
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
  applyFontScale();
  document.querySelectorAll("#fontOpts .opt").forEach(o=>{
    o.classList.toggle("active", Number(o.dataset.fs) === state.fontScale);
  });
  renderPortfolioHeaderBtn();
  syncPfExCheckboxes();
  renderSortLabel();
  showPfSection(state.pfSection, false);
}
