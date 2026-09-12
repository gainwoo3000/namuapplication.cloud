import { MARKET_PAGE_SIZE } from "./constants.js";
import { state } from "./state.js";
import { prevValues, rollUpdate, rollNumberByKey, flashChg } from "./animate.js";
import { fmtChg, chgClass, fmtDisplayPrice, displayPriceNum, priceSubText } from "./format.js";
import { findCoinAnywhere } from "./watchlist.js";
import { selectCoin } from "./chart.js";
import { searchExternalCoins, matchesLocalQuery } from "./search.js";

// ---------- 시세 탭 (시총 순위 + 페이지 + 검색) ----------
let marketQuery = "";
let marketPage = 1;
let marketExtResults = [];     // 검색어에 대한 외부(시총 500위 밖) 코인 결과 — CoinGecko 검색
let marketSearchDebounce = null;
let lastMarketSig = null;

// 시총 순위대로 정렬된 코인 목록(순위가 없으면 원본 순서 그대로)
function rankedTickers(){
  const ranked = state.allTickers.filter(c => c.rank).sort((a,b)=> a.rank - b.rank);
  return ranked.length ? ranked : state.allTickers;
}
function marketTotalPages(){
  return Math.max(1, Math.ceil(rankedTickers().length / MARKET_PAGE_SIZE));
}

// 검색어가 있으면 일치하는 코인(최대 100개), 없으면 현재 페이지의 100개.
// 관심 코인으로 담아 이미 보강된(거래소 평균가) 코인은 그 최신값을 함께 반영한다.
function marketList(){
  let picked;
  if(marketQuery){
    const q = marketQuery.toUpperCase();
    const local = state.allTickers.filter(c => matchesLocalQuery(c, q));
    const localSyms = new Set(local.map(c => c.symbol.toUpperCase()));
    // 시총 500위 밖이라 우리 풀엔 없는 코인은 CoinGecko 검색 결과로 채운다
    const seen = new Set(local.map(c => c.id));
    const ext = [];
    for(const c of marketExtResults){
      if(localSyms.has(c.symbol.toUpperCase()) || seen.has(c.id)) continue;
      seen.add(c.id);
      state.marketExtraCoins.set(c.id, c); // 클릭 시 findCoinAnywhere로 찾을 수 있게
      ext.push(c);
    }
    picked = [...local, ...ext].slice(0, 100);
  }else{
    const start = (marketPage - 1) * MARKET_PAGE_SIZE;
    picked = rankedTickers().slice(start, start + MARKET_PAGE_SIZE);
  }
  return picked.map(c => findCoinAnywhere(c.id) || c);
}

function marketSignature(list){
  return marketQuery + "|" + marketPage + "|" + state.displayCurrency + "|" + state.selectedCoinId + "|" + list.map(c=>c.id).join(",");
}

// 현재 페이지 기준으로 보여줄 번호들. 1·마지막·현재±1 은 항상, 사이가 벌어지면 "gap"(…)
function marketPageItems(cur, total){
  const items = [];
  let last = 0;
  for(let p = 1; p <= total; p++){
    if(p === 1 || p === total || (p >= cur - 1 && p <= cur + 1)){
      if(last && p - last > 1) items.push("gap");
      items.push(p);
      last = p;
    }
  }
  return items;
}

// 그리드 아래 페이지 버튼: 이전 · 1 · 2 · … · 5 · 다음
function renderMarketPager(){
  const pager = document.getElementById("marketPager");
  if(!pager) return;
  const total = marketTotalPages();
  if(marketQuery || total <= 1){ pager.style.display = "none"; pager.innerHTML = ""; return; }
  marketPage = Math.min(Math.max(1, marketPage), total);
  const parts = [`<button class="pg-btn pg-nav" data-page="${marketPage - 1}"${marketPage <= 1 ? " disabled" : ""}>이전</button>`];
  for(const it of marketPageItems(marketPage, total)){
    parts.push(it === "gap"
      ? `<span class="pg-gap">…</span>`
      : `<button class="pg-btn${it === marketPage ? " active" : ""}" data-page="${it}">${it}</button>`);
  }
  parts.push(`<button class="pg-btn pg-nav" data-page="${marketPage + 1}"${marketPage >= total ? " disabled" : ""}>다음</button>`);
  pager.innerHTML = parts.join("");
  pager.style.display = "flex";
}

function goMarketPage(p){
  const total = marketTotalPages();
  const next = Math.min(Math.max(1, p), total);
  if(next === marketPage) return;
  marketPage = next;
  renderMarketGrid();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function renderMarketGrid(){
  const wrap = document.getElementById("marketWrap");
  if(!wrap) return;
  marketPage = Math.min(Math.max(1, marketPage), marketTotalPages());
  const list = marketList();
  const sig = marketSignature(list);
  if(sig === lastMarketSig){
    updateMarketValues(list); // 구성은 그대로, 가격/등락률만 롤링으로 갱신
    renderMarketPager();
    return;
  }
  lastMarketSig = sig;
  let html = `<div class="grid-row grid-head"><div>코인</div><div style="text-align:right">가격</div><div style="text-align:right">등락률</div></div>`;
  if(list.length === 0){
    wrap.innerHTML = html + '<div class="loading">' + (marketQuery ? '일치하는 코인이 없습니다.' : '시세를 불러오는 중입니다…') + '</div>';
    renderMarketPager();
    return;
  }
  list.forEach(c=>{
    const chgCls = chgClass(c.price_change_percentage_24h);
    const selCls = c.id === state.selectedCoinId ? "selected" : "";
    const rankText = c.rank ? `${c.rank}위 · ` : "";
    const symLine = `${rankText}${c.symbol.toUpperCase()}`
      + (c.searchOnly && c.current_price == null ? ` · <span class="mkt-tv">차트만</span>` : "");
    const sub = priceSubText(c.current_price);
    html += `<div class="grid-row market-row ${selCls}" data-id="${c.id}">
      <div><div class="coin-name">${c.name}</div><div class="coin-sym">${symLine}</div></div>
      <div class="price"><span class="roll-wrap"><span class="roll-cur">${fmtDisplayPrice(c.current_price)}</span></span><span class="price-sub${sub === "" ? " is-empty" : ""}"><span class="roll-wrap"><span class="roll-cur">${sub}</span></span></span></div>
      <div class="chg ${chgCls}"><span class="roll-wrap"><span class="roll-cur">${fmtChg(c.price_change_percentage_24h)}</span></span></div>
    </div>`;
    const priceNum = displayPriceNum(c.current_price);
    if(priceNum !== null) prevValues["mkt:"+c.id+":price"] = priceNum;
    prevValues["mkt:"+c.id+":chg"] = c.price_change_percentage_24h;
  });
  wrap.innerHTML = html;
  wrap.querySelectorAll(".grid-row[data-id]").forEach(row=>{
    row.addEventListener("click", ()=> selectCoin(row.dataset.id));
  });
  renderMarketPager();
}

function updateMarketValues(list){
  const wrap = document.getElementById("marketWrap");
  if(!wrap) return;
  list.forEach(c=>{
    const row = wrap.querySelector(`.grid-row[data-id="${c.id}"]`);
    if(!row) return;
    const priceEl = row.querySelector(".price .roll-wrap");
    const chgEl = row.querySelector(".chg .roll-wrap");
    const priceNum = displayPriceNum(c.current_price);
    if(priceNum !== null) rollNumberByKey("mkt:"+c.id+":price", priceEl, fmtDisplayPrice(c.current_price), priceNum);
    else rollUpdate(priceEl, "-", true);
    const subEl = row.querySelector(".price-sub");
    if(subEl){
      const subTxt = priceSubText(c.current_price);
      subEl.classList.toggle("is-empty", subTxt === "");
      const subWrap = subEl.querySelector(".roll-wrap");
      if(subTxt === "") rollUpdate(subWrap, "", true);
      else{
        const subNum = state.displayCurrency === "krw" ? c.current_price : (state.usdKrw ? c.current_price * state.usdKrw : 0);
        rollNumberByKey("mkt:"+c.id+":sub", subWrap, subTxt, subNum);
      }
    }
    const prevChg = prevValues["mkt:"+c.id+":chg"];
    rollNumberByKey("mkt:"+c.id+":chg", chgEl, fmtChg(c.price_change_percentage_24h), c.price_change_percentage_24h);
    if(prevChg !== undefined && c.price_change_percentage_24h != null && c.price_change_percentage_24h !== prevChg){
      flashChg(row.querySelector(".chg"), c.price_change_percentage_24h - prevChg);
    }
    const chgDiv = row.querySelector(".chg");
    const cls = chgClass(c.price_change_percentage_24h);
    chgDiv.classList.toggle("up", cls === "up");
    chgDiv.classList.toggle("down", cls === "down");
    chgDiv.classList.toggle("flat", cls === "flat");
  });
}

document.getElementById("marketSearch").addEventListener("input", (e)=>{
  marketQuery = e.target.value.trim();
  marketPage = 1;
  marketExtResults = [];
  renderMarketGrid(); // 우선 로컬(시총 500위) 결과를 즉시 표시
  clearTimeout(marketSearchDebounce);
  if(marketQuery.length < 2) return;
  const q = marketQuery;
  marketSearchDebounce = setTimeout(async ()=>{
    const results = await searchExternalCoins(q);
    if(document.getElementById("marketSearch").value.trim() !== q) return; // 그새 검색어가 바뀌면 버림
    marketExtResults = results;
    lastMarketSig = null; // 외부 검색 결과를 반영해 강제로 다시 그림
    renderMarketGrid();
  }, 350);
});

document.getElementById("marketPager").addEventListener("click", (e)=>{
  const btn = e.target.closest(".pg-btn");
  if(!btn || btn.disabled) return;
  goMarketPage(Number(btn.dataset.page));
});
