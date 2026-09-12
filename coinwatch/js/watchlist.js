import { state } from "./state.js";
import { prevValues, rollUpdate, rollNumberByKey, flashChg, collapseRow } from "./animate.js";
import { fmtChg, chgClass, fmtDisplayPrice, displayPriceNum, fmtDisplayMyx, displayMyxNum } from "./format.js";
import { myExchangeValue, myxPremiumText, premiumPct } from "./pricing.js";
import { resolveOrCreateSearchCoin, searchExternalCoins, matchesLocalQuery } from "./search.js";
import { rangeBarHtml, syncRangeBar } from "./rangebar.js";
import { selectCoin, closeChart } from "./chart.js";
import { saveState } from "./persist.js";
import { showAlert } from "./dialog.js";

// watchlist + allTickers(기본 시세)에 마지막으로 보강된 데이터(있다면)를 합쳐 coinsList를 구성
// id 하나를 allTickers(기본 정보) + enrichedCache(있다면 최신 보강값)를 합쳐 조회
export function findCoinAnywhere(id){
  const base = state.allTickers.find(c=>c.id===id) || state.marketExtraCoins.get(id);
  if(!base) return null;
  const cached = state.enrichedCache[id];
  return cached ? {...base, ...cached} : base;
}

export function buildCoinsList(){
  return state.watchlist.map(id=>findCoinAnywhere(id)).filter(Boolean);
}

let lastGridSignature = null;

function gridSignature(){
  const ids = state.coinsList.slice(0, state.visibleCount).map(c=>c.id).join(",");
  return state.editMode + "|" + state.visibleCount + "|" + state.selectedCoinId + "|" + state.displayCurrency + "|" + ids;
}

export function renderGrid(){
  if(state.rowAnimating) return; // 삭제 애니메이션 중에는 재렌더 보류
  const sig = gridSignature();
  if(sig === lastGridSignature){
    updateGridValues(); // 목록 구조는 그대로, 가격/등락률만 롤링 애니메이션으로 갱신
    return;
  }
  lastGridSignature = sig;
  const wrap = document.getElementById("gridWrap");
  let html = `<div class="grid-row grid-head"><div>코인</div><div class="myx-head"><span>나의 거래소</span><span class="myx-head-sub">프리미엄</span></div><div style="text-align:right">시세 기준 거래소 <span class="col-help" id="priceHelpBtn" role="button" aria-label="가격 기준 안내">?</span></div><div style="text-align:right">등락률</div></div>`;
  if(state.coinsList.length === 0){
    html += '<div class="loading">관심 코인이 없습니다. "+ 코인 추가"로 보고 싶은 코인을 담아보세요.</div>';
  }
  state.coinsList.slice(0, state.visibleCount).forEach(c=>{
    const chgCls = chgClass(c.price_change_percentage_24h);
    const selCls = c.id === state.selectedCoinId ? "selected":"";
    const editCls = state.editMode ? "editing":"";
    const myx = myExchangeValue(c);
    const myxText = myx.krw === null ? "-" : (myx.est ? "≈ " : "") + fmtDisplayMyx(myx.krw);
    const premText = myxPremiumText(c, myx);
    const rankText = c.rank ? `${c.rank}위 · ` : "";
    html += `<div class="grid-row ${selCls} ${editCls}" data-id="${c.id}">
      ${state.editMode ? `<div class="row-del" data-del="${c.id}">✕</div>` : ""}
      <div><div class="coin-name">${c.name}</div><div class="coin-sym">${rankText}${c.symbol.toUpperCase()}</div></div>
      <div class="myx-price ${myx.est ? "myx-est" : ""}"><span class="roll-wrap"><span class="roll-cur">${myxText}</span></span><span class="myx-prem${premText === "" ? " is-empty" : ""}"><span class="roll-wrap"><span class="roll-cur">${premText}</span></span></span></div>
      <div class="price"><span class="roll-wrap"><span class="roll-cur">${fmtDisplayPrice(c.current_price)}</span></span></div>
      <div class="chg ${chgCls}"><span class="roll-wrap"><span class="roll-cur">${fmtChg(c.price_change_percentage_24h)}</span></span>${rangeBarHtml(c)}</div>
    </div>`;
    const priceNum = displayPriceNum(c.current_price);
    const myxNum = displayMyxNum(myx.krw);
    if(priceNum !== null) prevValues[c.id+":price"] = priceNum;
    prevValues[c.id+":chg"] = c.price_change_percentage_24h;
    if(myxNum !== null) prevValues[c.id+":myx"] = myxNum;
  });
  wrap.innerHTML = html;
  wrap.querySelectorAll(".grid-row[data-id]").forEach(row=>{
    row.addEventListener("click", (e)=>{
      if(e.target.closest(".row-del")) return;
      selectCoin(row.dataset.id);
    });
  });
  wrap.querySelectorAll(".row-del").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      removeCoin(btn.dataset.del);
    });
  });
  const moreBtn = document.getElementById("moreBtn");
  moreBtn.style.display = state.visibleCount < state.coinsList.length ? "block":"none";
  moreBtn.textContent = `10개 더 보기 (${Math.min(state.visibleCount, state.coinsList.length)}/${state.coinsList.length})`;
}

// 구조는 그대로 둔 채 각 행의 가격/등락률/나의거래소만 자릿수 단위로 굴려서 갱신
function updateGridValues(){
  const wrap = document.getElementById("gridWrap");
  state.coinsList.slice(0, state.visibleCount).forEach(c=>{
    const row = wrap.querySelector(`.grid-row[data-id="${c.id}"]`);
    if(!row) return;
    const priceEl = row.querySelector(".price .roll-wrap");
    const chgEl = row.querySelector(".chg .roll-wrap");
    const myxEl = row.querySelector(".myx-price .roll-wrap");
    const priceNum = displayPriceNum(c.current_price);
    if(priceNum !== null){
      rollNumberByKey(c.id+":price", priceEl, fmtDisplayPrice(c.current_price), priceNum);
    }else{
      rollUpdate(priceEl, "-", true);
    }
    const prevChg = prevValues[c.id+":chg"];
    rollNumberByKey(c.id+":chg", chgEl, fmtChg(c.price_change_percentage_24h), c.price_change_percentage_24h);
    if(prevChg !== undefined && c.price_change_percentage_24h != null && c.price_change_percentage_24h !== prevChg){
      flashChg(row.querySelector(".chg"), c.price_change_percentage_24h - prevChg);
    }
    const myx = myExchangeValue(c);
    const myxNum = displayMyxNum(myx.krw);
    if(myxNum !== null){
      rollNumberByKey(c.id+":myx", myxEl, (myx.est ? "≈ " : "") + fmtDisplayMyx(myx.krw), myxNum);
    }else{
      rollUpdate(myxEl, "-", true);
    }
    row.querySelector(".myx-price").classList.toggle("myx-est", myx.est);
    const premEl = row.querySelector(".myx-prem");
    if(premEl){
      const premTxt = myxPremiumText(c, myx);
      premEl.classList.toggle("is-empty", premTxt === "");
      const premWrap = premEl.querySelector(".roll-wrap");
      if(premTxt === "") rollUpdate(premWrap, "", true);
      else{
        const pn = premiumPct(c, myx.krw);
        rollNumberByKey(c.id+":prem", premWrap, premTxt, pn == null ? 0 : pn);
      }
    }
    const chgDiv = row.querySelector(".chg");
    const cls = chgClass(c.price_change_percentage_24h);
    chgDiv.classList.toggle("up", cls === "up");
    chgDiv.classList.toggle("down", cls === "down");
    chgDiv.classList.toggle("flat", cls === "flat");
    syncRangeBar(row, c);
  });
  const moreBtn = document.getElementById("moreBtn");
  moreBtn.style.display = state.visibleCount < state.coinsList.length ? "block":"none";
  moreBtn.textContent = `10개 더 보기 (${Math.min(state.visibleCount, state.coinsList.length)}/${state.coinsList.length})`;
}

document.getElementById("gridWrap").addEventListener("click", (e)=>{
  if(e.target.closest("#priceHelpBtn")){
    e.stopPropagation();
    const pop = document.getElementById("priceHelpPop");
    pop.style.display = pop.style.display === "none" ? "block" : "none";
  }
});

document.getElementById("priceHelpGoBtn").addEventListener("click", ()=>{
  document.getElementById("priceHelpPop").style.display = "none";
  document.querySelector('.tab[data-tab="settings"]').click();
  document.getElementById("exchangeOpts").scrollIntoView({behavior:"smooth", block:"center"});
});

// 위에 뜬 말풍선/패널 바깥을 아무 데나 탭하면 자동으로 닫힘
document.addEventListener("click", (e)=>{
  const addPanel = document.getElementById("addCoinPanel");
  if(addPanel.style.display !== "none" && !e.target.closest("#addCoinPanel") && !e.target.closest("#addCoinBtn")){
    addPanel.style.display = "none";
    document.getElementById("addCoinBtn").classList.remove("active");
  }
  const priceHelp = document.getElementById("priceHelpPop");
  if(priceHelp.style.display !== "none" && !e.target.closest("#priceHelpPop") && !e.target.closest("#priceHelpBtn")){
    priceHelp.style.display = "none";
  }
});

document.querySelectorAll(".myx-check").forEach(cb=>{
  cb.addEventListener("change", ()=>{
    state.myExchanges = new Set([...document.querySelectorAll(".myx-check:checked")].map(el=>el.value));
    renderGrid();
    saveState();
  });
});

document.getElementById("moreBtn").addEventListener("click", ()=>{
  state.visibleCount = Math.min(30, state.visibleCount+10);
  renderGrid();
});

// ---------- 관심 코인 편집/추가/삭제 ----------
document.getElementById("editModeBtn").addEventListener("click", (e)=>{
  state.editMode = !state.editMode;
  e.target.classList.toggle("active", state.editMode);
  renderGrid();
});

document.getElementById("addCoinBtn").addEventListener("click", (e)=>{
  const panel = document.getElementById("addCoinPanel");
  const showing = panel.style.display !== "none";
  panel.style.display = showing ? "none" : "block";
  e.target.classList.toggle("active", !showing);
  if(!showing){
    renderAddResults("");
  }
});

document.getElementById("addCoinSearch").addEventListener("input", (e)=>{
  const q = e.target.value.trim();
  renderAddResults(q); // 로컬 풀(시총 500위) 결과는 즉시 표시
  clearTimeout(addSearchDebounce);
  if(q.length < 2) return;
  addSearchDebounce = setTimeout(async ()=>{
    const extResults = await searchExternalCoins(q);
    if(document.getElementById("addCoinSearch").value.trim() === q){
      renderAddResults(q, extResults); // 시총 500위 밖 코인 결과를 합쳐서 다시 렌더
    }
  }, 350);
});

let addSearchDebounce = null;
let currentAddResults = []; // renderAddResults가 만든 목록(로컬+외부 혼합), 클릭 시 이 배열로 조회

function renderAddResults(query, extResults){
  extResults = extResults || [];
  const box = document.getElementById("addCoinResults");
  const q = query.toUpperCase();
  const localMatches = query
    ? state.allTickers.filter(c => matchesLocalQuery(c, q))
    : state.allTickers;
  const localIds = new Set(localMatches.map(c=>c.id));
  const extOnly = extResults.filter(c => !localIds.has(c.id));
  currentAddResults = [
    ...localMatches.map(c=>({kind:"local", coin:c})),
    ...extOnly.map(c=>({kind:"ext", coin:c}))
  ];
  if(currentAddResults.length === 0){
    box.innerHTML = '<div class="add-empty">일치하는 코인이 없습니다.</div>';
    return;
  }
  box.innerHTML = currentAddResults.map((entry, idx)=>{
    const c = entry.coin;
    const already = state.watchlist.includes(c.id);
    return `
    <div class="add-result-row" data-pick="${idx}" style="${already ? 'opacity:0.45;' : 'cursor:pointer;'}">
      <div><span class="rank">${c.rank ? c.rank+"위" : "-"}</span>${c.name} <span style="color:var(--muted)">${c.symbol.toUpperCase()}</span></div>
      ${already
        ? '<span style="font-size:11px; color:var(--muted);">담김</span>'
        : `<button class="add-plus" data-pick="${idx}">+ 담기</button>`}
    </div>`;
  }).join("");
  box.querySelectorAll("[data-pick]").forEach(el=>{
    el.addEventListener("click", (e)=>{
      e.stopPropagation();
      pickAddResult(Number(el.dataset.pick));
    });
  });
}

function pickAddResult(idx){
  const entry = currentAddResults[idx];
  if(!entry) return;
  const coin = entry.kind === "local" ? entry.coin : resolveOrCreateSearchCoin(entry.coin);
  if(!state.watchlist.includes(coin.id)) addCoin(coin.id);
}

export function addCoin(id){
  if(state.watchlist.includes(id)) return;
  if(state.watchlist.length >= 30){
    showAlert("관심 코인은 최대 30개까지 담을 수 있어요.");
    return;
  }
  state.watchlist.push(id);
  state.visibleCount = Math.max(state.visibleCount, Math.min(30, state.watchlist.length));
  state.coinsList = buildCoinsList();
  renderGrid();
  renderAddResults(document.getElementById("addCoinSearch").value.trim());
  saveState();
}

export function removeCoin(id){
  const commit = ()=>{
    state.watchlist = state.watchlist.filter(x=>x!==id);
    state.coinsList = buildCoinsList();
    if(state.selectedCoinId === id) closeChart();
    lastGridSignature = null; // 구조가 바뀌었으니 강제로 다시 그림
    renderGrid();
    saveState();
  };
  const row = document.querySelector(`#gridWrap .grid-row[data-id="${id}"]`);
  if(row) collapseRow(row, commit);
  else commit();
}
