import { MAX_PORTFOLIOS, NAME_MAP } from "./constants.js";
import { state } from "./state.js";
import { skeletonRows, skeletonResultRows } from "./skeleton.js";
import { collapseRow, prevValues, rollNumberByKey } from "./animate.js";
import { fmtDisplayPrice, displayPriceNum } from "./format.js";
import { findCoinAnywhere } from "./watchlist.js";
import { coinLogoHtml } from "./logo.js";
import { pfCoinPriceUsd } from "./pricing.js";
import { selectCoin } from "./chart.js";
import { resolveOrCreateSearchCoin, searchExternalCoins, matchesLocalQuery } from "./search.js";
import { saveState } from "./persist.js";
import { showAlert, showPrompt, showConfirm } from "./dialog.js";
import { newTid, todayStr, recomputeHoldings, holdingAmount, tradedCoins, avgBuyPrice,
  priceInDisplay, fmtMoney, fmtAmount } from "./trades.js";
import { openSheet, openOverlay, closeOverlay, syncViewport } from "./sheet.js";
import { cleanText, cleanDate, parseNum } from "./sanitize.js";
import { renderAlloc } from "./alloc.js";
import { t, IS_EN, LOCALE } from "./i18n.js";
const tr = t; // 거래 한 건을 t로 부르는 함수 안에서 쓰는 이름

export function currentPortfolio(){ return state.portfolios[state.activePortfolioIdx]; }

// 거래·보유 코인의 이름. 기록에는 담을 때의 이름이 들어 있어서(한국어 화면이면 "비트코인")
// 지금 시세 목록의 이름(화면 언어를 따른다)을 먼저 쓴다. 시세를 아직 못 받았으면 기록의 이름 —
// 영어 화면인데 그게 한글 이름이면 심볼로 대신한다.
function coinName(x){
  const c = findCoinAnywhere(x.id);
  if(c && c.name) return c.name;
  return IS_EN && NAME_MAP[x.symbol] === x.name ? x.symbol : x.name;
}

// 이름을 따로 짓지 않은 기본 이름("포트폴리오 1")은 화면 언어에 맞춰 보여준다 (저장된 값은 그대로)
function pfName(name){
  const m = /^(?:포트폴리오|Portfolio)(?: (\d+))?$/.exec(name);
  if(!m) return name;
  return t("포트폴리오", "Portfolio") + (m[1] ? " " + m[1] : "");
}

let pfSelectedCoin = null; // 포트폴리오에 담을 코인으로 현재 선택된 항목
let pfCurrentResults = [];
let pfSearchDebounce = null;
let pfSearchPending = null; // 순위 밖 검색 결과를 기다리는 검색어(없으면 null)
let pfEditMode = false; // 보유 코인 삭제 모드 (수량은 거래 기록으로만 바뀐다)
let pfSide = "buy";     // 거래 입력 창의 매수/매도
let pfAmtByTotal = false; // 수량 칸에 수량 대신 금액(표시 통화)을 넣는 중인지 (⇅)

document.getElementById("pfCoinSearch").addEventListener("input", (e)=>{
  pfSelectedCoin = null; // 다시 타이핑하면 이전 선택은 해제
  const q = e.target.value.trim();
  clearTimeout(pfSearchDebounce);
  pfSearchPending = q.length >= 2 ? q : null; // 2글자부터 순위 밖까지 찾아본다
  renderPfResults(q); // 로컬 풀(시총 500위) 결과(빈 값이면 시총 순위)는 즉시 표시
  setSearchMode(true);
  if(!pfSearchPending) return;
  pfSearchDebounce = setTimeout(async ()=>{
    let extResults = [];
    try{ extResults = await searchExternalCoins(q); }catch(err){ /* 실패하면 로컬 결과만 */ }
    if(document.getElementById("pfCoinSearch").value.trim() === q){
      pfSearchPending = null;
      renderPfResults(q, extResults); // 시총 500위 밖 코인 결과를 합쳐서 다시 렌더
    }
  }, 350);
});

// 목록은 focus가 아니라 click(손을 뗀 뒤)에 연다. focus 때 열면 목록만큼 입력 창이 위로 늘어나
// 검색칸이 손가락 밑에서 밀려 올라가고, 같은 탭의 click이 그 자리에 새로 온 칸(수량 등)에 떨어져
// "바깥을 눌렀다"로 읽혀서 목록이 뜨자마자 닫혔다.
document.getElementById("pfCoinSearch").addEventListener("click", ()=>{
  if(pfSelectedCoin) return;
  renderPfResults(document.getElementById("pfCoinSearch").value.trim());
  setSearchMode(true);
});

document.addEventListener("click", (e)=>{
  if(!e.target.closest("#pfCoinResults") && !e.target.closest("#pfCoinSearch")){
    document.getElementById("pfCoinResults").style.display = "none";
    setSearchMode(false);
  }
  if(!e.target.closest("#pfPortfolioPanel") && !e.target.closest("#pfPortfolioBtn")){
    document.getElementById("pfPortfolioPanel").style.display = "none";
  }
});

// 검색 모드: 휴대폰은 키보드가 화면 아래 절반을 덮어서, 검색칸 아래에 목록을 펼치면 키보드 밑으로 들어가 버린다.
// 그래서 검색하는 동안은 입력 창을 "키보드 위에 보이는 영역" 전체로 키우고 검색칸과 목록만 남긴다.
// 코인을 고르거나 취소·바깥을 누르면 원래 입력 창으로 돌아온다.
function setSearchMode(on){
  const sheet = tradeSheet.querySelector(".sheet");
  if(sheet.classList.contains("searching") === on) return;
  sheet.classList.toggle("searching", on);
  syncViewport();
  if(on) document.getElementById("pfCoinResults").scrollTop = 0;
}
document.getElementById("pfSearchCancel").addEventListener("click", ()=>{
  document.getElementById("pfCoinSearch").blur(); // 목록 닫기·모드 해제는 위의 바깥 클릭 처리가 한다
});

// query가 비어 있으면 시세 탭 "+ 코인 추가"처럼 시총 순위대로 전체(500위) 목록을 보여준다.
function renderPfResults(query, extResults){
  extResults = extResults || [];
  const box = document.getElementById("pfCoinResults");
  const q = (query || "").toUpperCase();
  const localMatches = q
    ? state.allTickers.filter(c => matchesLocalQuery(c, q))
    : state.allTickers;
  const localIds = new Set(localMatches.map(c=>c.id));
  const extOnly = extResults.filter(c => !localIds.has(c.id));
  pfCurrentResults = [
    ...localMatches.map(c=>({kind:"local", coin:c})),
    ...extOnly.map(c=>({kind:"ext", coin:c}))
  ];
  box.style.display = "block";
  if(pfCurrentResults.length === 0){
    // 순위 밖 검색이 아직 안 끝났으면 "없음"이라고 단정하지 않고 자리표시를 깐다
    box.innerHTML = pfSearchPending === query
      ? skeletonResultRows(3, false)
      : '<div class="add-empty">' + t("일치하는 코인이 없습니다.", "No matching coins.") + '</div>';
    return;
  }
  box.innerHTML = pfCurrentResults.map((entry, idx)=>{
    const c = entry.coin;
    return `<div class="add-result-row" data-pfpick="${idx}" style="cursor:pointer;">
      <div><span class="rank">${c.rank ? t(c.rank + "위", "#" + c.rank) : "-"}</span>${c.name} <span style="color:var(--muted)">${c.symbol.toUpperCase()}</span></div>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-pfpick]").forEach(el=>{
    el.addEventListener("click", ()=> pickPfResult(Number(el.dataset.pfpick)));
  });
}

function pickPfResult(idx){
  const entry = pfCurrentResults[idx];
  if(!entry) return;
  const coin = entry.kind === "local" ? entry.coin : resolveOrCreateSearchCoin(entry.coin);
  pfSelectedCoin = coin;
  document.getElementById("pfCoinSearch").value = `${coin.name} (${coin.symbol.toUpperCase()})`;
  document.getElementById("pfCoinResults").style.display = "none";
  setSearchMode(false);
  // 단가는 이 포트폴리오 기준 거래소의 지금 시세로 채워 둔다(고쳐 쓰거나 비워도 된다)
  const c = findCoinAnywhere(coin.id);
  const pr = c ? pfCoinPriceUsd(c, new Set(currentPortfolio().exchanges)) : null;
  const px = pr && pr.usd !== null ? displayPriceNum(pr.usd) : null;
  document.getElementById("pfPrice").value = px !== null ? String(roundPrice(px)) : "";
  renderAmtField();
  document.getElementById("pfAmount").focus();
}

// 단가 입력칸에 넣을 값: 원화는 원 단위, 달러는 크기에 맞춰 유효숫자 6자리 정도
function roundPrice(v){
  if(state.displayCurrency === "krw" && v >= 1) return Math.round(v);
  if(v >= 1000) return Math.round(v);
  return parseFloat(v.toPrecision(6));
}

// ---------- 매수·매도 입력 창 ----------
const tradeSheet = document.getElementById("pfTradeSheet");

function curUnit(){ return state.displayCurrency === "krw" ? "₩" : "$"; }
// 빈 칸이면 null, 숫자로 못 읽으면 NaN(아래 검사에서 걸리게), 아니면 그 수. "1e400"(Infinity)도 NaN.
// 숫자 칸(type=number)은 못 읽는 값을 치면 value를 조용히 ""로 비운다 — 그대로 두면 "abc"나
// "1e400"을 친 것이 "비워 둠"(단가 없이 저장)으로 읽힌다. 브라우저가 badInput으로 알려 주니 그걸 본다.
function numVal(id){
  const el = document.getElementById(id);
  if(el.validity && el.validity.badInput) return NaN;
  const v = el.value.trim();
  return v === "" ? null : (parseNum(v) ?? NaN);
}
// 수량·단가·금액의 상한. 이보다 크면 합계가 부동소수 정밀도를 잃고, 대개 잘못 친 값이다.
const MAX_INPUT = 1e15;

// 수량 칸의 이름·단위와 그 아래 환산 한 줄(수량이면 ≈ 금액, 금액이면 ≈ 수량)
function renderAmtField(){
  const sym = pfSelectedCoin ? pfSelectedCoin.symbol.toUpperCase() : t("개", "");
  document.getElementById("pfAmountLabel").textContent = pfAmtByTotal ? t("금액", "Total") + ` (${curUnit()})` : t("수량", "Amount");
  document.getElementById("pfAmountUnit").textContent = pfAmtByTotal ? curUnit() : sym;
  document.getElementById("pfAmtToggle").setAttribute("aria-label", pfAmtByTotal
    ? t("수량으로 입력하기", "Enter by amount") : t("금액으로 입력하기", "Enter by total"));
  // 금액으로 넣을 때는 수량을 구하려면 단가가 있어야 한다
  document.getElementById("pfPriceLabel").innerHTML = t("단가", "Price") + ` (${curUnit()}) `
    + (pfAmtByTotal ? `<span class="ts-req">${t("(필수)", "(required)")}</span>` : `<span class="ts-opt">${t("(선택)", "(optional)")}</span>`);
  const v = numVal("pfAmount"), price = numVal("pfPrice");
  let hint = "";
  if(v > 0 && price > 0){
    hint = pfAmtByTotal ? `≈ ${fmtAmount(v / price)} ${sym}` : `≈ ${fmtMoney(v * price)}`;
  }else if(pfAmtByTotal && v > 0){
    hint = t("단가를 넣으면 수량으로 바꿔 드려요", "Enter a price to convert it to an amount");
  }
  document.getElementById("pfAmtHint").textContent = hint;
}

["pfAmount", "pfPrice"].forEach(id => document.getElementById(id).addEventListener("input", renderAmtField));

// ⇅: 수량 ↔ 금액. 이미 적어 둔 값은 단가로 환산해서 옮겨 준다(단가가 없으면 비운다)
document.getElementById("pfAmtToggle").addEventListener("click", ()=>{
  const v = numVal("pfAmount"), price = numVal("pfPrice");
  const input = document.getElementById("pfAmount");
  if(v > 0){
    if(price > 0) input.value = String(pfAmtByTotal ? parseFloat((v / price).toPrecision(8)) : roundPrice(v * price));
    else input.value = "";
  }
  pfAmtByTotal = !pfAmtByTotal;
  renderAmtField();
  input.focus();
});

function openTradeSheet(side){
  pfSide = side;
  pfSelectedCoin = null;
  pfAmtByTotal = false;
  ["pfCoinSearch", "pfAmount", "pfPrice"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("pfCoinResults").style.display = "none";
  setSearchMode(false);
  document.getElementById("pfDate").value = todayStr();
  document.getElementById("pfTradeTitle").textContent = side === "sell" ? t("매도", "Sell") : t("매수", "Buy");
  const btn = document.getElementById("pfAddBtn");
  btn.textContent = side === "sell" ? t("매도 추가", "Add sell") : t("매수 추가", "Add buy");
  btn.classList.toggle("buy", side !== "sell");
  btn.classList.toggle("sell", side === "sell");
  renderAmtField();
  openOverlay(tradeSheet);
}

function closeTradeSheet(){ closeOverlay(tradeSheet); }

document.querySelectorAll(".pf-trade-btn").forEach(btn=>{
  btn.addEventListener("click", ()=> openTradeSheet(btn.dataset.side));
});
document.getElementById("pfTradeClose").addEventListener("click", closeTradeSheet);
tradeSheet.addEventListener("click", e=>{ if(!e.target.closest(".sheet")) closeTradeSheet(); });
document.addEventListener("keydown", e=>{
  if(e.key !== "Escape") return;
  closeTradeSheet();
  closeOverlay(exSheet);
});

document.getElementById("pfAddBtn").addEventListener("click", ()=>{
  if(!pfSelectedCoin){ showAlert(t("코인을 검색해서 골라주세요.", "Search for a coin and pick it.")); return; }
  const v = numVal("pfAmount");
  const price = numVal("pfPrice");
  if(price !== null && !(price >= 0 && price <= MAX_INPUT)){ showAlert(t("단가를 확인해주세요.", "Please check the price.")); return; }
  if(!(v > 0)){ showAlert(pfAmtByTotal ? t("금액을 입력해주세요.", "Please enter a total.") : t("수량을 입력해주세요.", "Please enter an amount.")); return; }
  if(v > MAX_INPUT){ showAlert(pfAmtByTotal ? t("금액이 너무 커요. 다시 확인해주세요.", "That total is too large. Please check it.")
    : t("수량이 너무 커요. 다시 확인해주세요.", "That amount is too large. Please check it.")); return; }
  if(pfAmtByTotal && !(price > 0)){ showAlert(t("금액으로 입력하려면 단가가 필요해요.", "A price is needed to enter by total.")); return; }
  const amount = pfAmtByTotal ? parseFloat((v / price).toPrecision(12)) : v;
  if(!(amount > 0 && Number.isFinite(amount))){ showAlert(t("수량을 확인해주세요.", "Please check the amount.")); return; }
  const pf = currentPortfolio();
  // 매도는 보유량과 상관없이 기록한다(이 앱에 적기 전부터 갖고 있던 코인을 판 경우 등).
  // 보유량이 0 아래로 내려간 코인은 보유 목록에 나오지 않는다(recomputeHoldings).
  const date = cleanDate(document.getElementById("pfDate").value) || todayStr();
  pf.trades.push({ tid: newTid(), id: pfSelectedCoin.id, symbol: pfSelectedCoin.symbol.toUpperCase(),
    name: pfSelectedCoin.name, side: pfSide, amount,
    price, cur: price === null ? null : state.displayCurrency,
    date });
  recomputeHoldings(pf);
  pfSelectedCoin = null;
  closeTradeSheet();
  renderPortfolio();
  saveState();
});

document.getElementById("pfEditBtn").addEventListener("click", ()=> setPfEditMode(!pfEditMode));

function setPfEditMode(on){
  if(pfEditMode === on) return;
  pfEditMode = on;
  document.getElementById("pfEditBtn").classList.toggle("active", on);
  renderPortfolio();
}

// 다른 탭이나 거래 섹션으로 갔다 오면 편집 모드는 풀려 있어야 한다(✕가 남아 있으면 실수로 지우기 쉽다)
export function exitPfEditMode(){ setPfEditMode(false); }

// ---------- 보유 코인 정렬 ----------
// "보유 코인" 헤더를 누를 때마다 추가순 → 금액 오름차순 → 내림차순 순으로 돌아간다.
const SORT_CYCLE = ["added", "asc", "desc"];
const SORT_LABEL = { added: t("추가순", "Added"), asc: t("금액 ↑", "Value ↑"), desc: t("금액 ↓", "Value ↓") };

// 표시할 순서대로 { p, idx, name, coin, value, est } 목록을 만든다.
// idx는 holdings 배열의 원래 위치 — 삭제가 이 값을 쓰므로 정렬해도 함께 들고 다녀야 한다.
function sortedRows(holdings, exSet){
  const rows = holdings.map((p, idx)=>{
    const c = findCoinAnywhere(p.id);
    const pr = c ? pfCoinPriceUsd(c, exSet) : null;
    // coin: 로고용. 시세 풀에 없는 코인이면 보유 항목의 심볼만으로 아이콘을 찾는다.
    return { p, idx, name: coinName(p), coin: c || { symbol: p.symbol }, value: pr && pr.usd !== null ? pr.usd * p.amount : null, est: !!(pr && pr.est) };
  });
  if(state.pfSortMode === "added") return rows;
  const dir = state.pfSortMode === "asc" ? 1 : -1;
  return rows.sort((a, b)=>{
    // 가격을 못 구한 코인은 정렬 방향과 무관하게 맨 뒤로
    if(a.value === null || b.value === null){
      if(a.value === b.value) return a.idx - b.idx;
      return a.value === null ? 1 : -1;
    }
    return (a.value - b.value) * dir;
  });
}

export function renderSortLabel(){
  const el = document.getElementById("pfSortMode");
  if(el) el.textContent = SORT_LABEL[state.pfSortMode] || SORT_LABEL.added;
}

document.getElementById("pfSortBtn").addEventListener("click", ()=>{
  const next = (SORT_CYCLE.indexOf(state.pfSortMode) + 1) % SORT_CYCLE.length;
  state.pfSortMode = SORT_CYCLE[next];
  renderSortLabel();
  renderPortfolio(true);
  saveState();
});

// 목록 구성이 바뀌었는지 판단하는 서명. 이게 그대로면 행을 다시 만들지 않고 값만 갱신한다.
// 정렬 결과 순서까지 포함하므로, 금액 순 정렬에서 순위가 바뀌면 자동으로 다시 그려진다.
let lastPfSignature = null;
function pfSignature(rows){
  // 로딩 여부도 넣는다 — 이게 없으면 자리표시를 그린 뒤 시세가 도착해도 시그니처가 같아서
  // 값만 갱신하는 경로(updatePortfolioValues)로 빠지는데, 그쪽은 .pf-row를 찾지 못해
  // 아무것도 못 하고 자리표시가 영영 남는다
  const loading = state.allTickers.length === 0;
  return state.fakeRefreshSeq + "|" + state.activePortfolioIdx + "|" + pfEditMode + "|" + state.displayCurrency + "|" + state.pfSortMode + "|" + loading + "|"
    + rows.map(r => r.p.id + ":" + r.p.amount).join(",");
}

// 구성은 그대로 둔 채 가치·총합만 제자리에서 갱신 (관심 코인 탭의 updateGridValues와 같은 방식)
function updatePortfolioValues(rows){
  const list = document.getElementById("pfList");
  let total = 0;
  rows.forEach(({ p, value, est })=>{
    if(value !== null) total += value;
    const cell = list.querySelector(`.pf-row[data-id="${p.id}"] .price`);
    if(!cell) return;
    const txt = value !== null ? (est ? "≈ " : "") + fmtDisplayPrice(value) : "-";
    // 자릿수 단위로 굴려서 갱신 (관심 코인·시세 탭과 같은 방식)
    rollNumberByKey("pf:" + p.id, cell.querySelector(".roll-wrap"), txt, displayPriceNum(value) ?? 0);
    cell.classList.toggle("myx-est", est); // 고른 거래소 밖 시세로 대체한 값은 흐리게
  });
  rollNumberByKey("pf:total", document.querySelector("#pfTotal .roll-wrap"),
    fmtDisplayPrice(total), displayPriceNum(total) ?? 0);
}

// 시세·관심 코인 탭과 같은 표 머리글 (한 줄로 두고 본문만 갈아끼운다)
const PF_HEAD = `<div class="grid-row grid-head"><div>${t("코인", "Coin")}</div>`
  + `<div style="text-align:right">${t("보유 수량", "Amount")}</div><div style="text-align:right">${t("평가 금액", "Value")}</div></div>`;

// 보유량 표 + 거래 기록 + 추가 폼(단가 칸 통화 표시)을 함께 갱신. force=true면 표 행을 새로 만든다.
export function renderPortfolio(force){
  renderHoldings(force);
  renderPfAlloc();
  renderPfTrades();
  if(tradeSheet.classList.contains("show")) renderAmtField(); // 표시 통화가 바뀌면 단위도 같이
}

// 배분 도넛은 보고 있을 때만 그린다(시세 갱신마다 불리므로)
function renderPfAlloc(){
  if(state.pfSection !== "holdings" || state.pfOverview !== "alloc") return;
  if(state.rowAnimating || state.fakeRefreshing) return;
  const pf = currentPortfolio();
  renderAlloc(document.getElementById("pfAllocView"),
    sortedRows(pf.holdings, new Set(pf.exchanges)), state.allTickers.length === 0);
}

function renderHoldings(force){
  if(state.rowAnimating || state.fakeRefreshing) return; // 삭제 애니메이션·가짜 새로고침 중에는 재렌더 보류
  const list = document.getElementById("pfList");
  const totalLabel = state.displayCurrency === "krw" ? "₩0" : "$0.00";
  const holdings = currentPortfolio().holdings;
  const exSet = new Set(currentPortfolio().exchanges);

  // 코인·수량·편집모드·표시통화·정렬순서가 그대로면 행을 새로 만들지 않고 값만 굴린다.
  const rows = sortedRows(holdings, exSet);
  const sig = pfSignature(rows);
  if(!force && sig === lastPfSignature && list.querySelector(".pf-row")){
    updatePortfolioValues(rows);
    return;
  }
  lastPfSignature = sig;
  if(holdings.length === 0){
    list.innerHTML = PF_HEAD + '<div class="empty">' + t("거래를 추가하면 보유 코인이 여기에 표시됩니다.", "Add a transaction and your holdings will show up here.") + '</div>';
    document.getElementById("pfTotal").textContent = totalLabel;
    return;
  }
  // 보유 코인은 있는데 시세를 아직 못 받았으면 평가 금액이 전부 "-"로 뜬다. 그동안은 자리표시.
  if(state.allTickers.length === 0){
    list.innerHTML = PF_HEAD + skeletonRows("portfolio", Math.min(holdings.length, 8));
    document.getElementById("pfTotal").textContent = totalLabel;
    return;
  }
  let total = 0;
  let html = PF_HEAD;
  rows.forEach(({ p, idx, coin, value, est })=>{
    if(value !== null) total += value;
    const amtCell = fmtAmount(p.amount);
    const valText = value !== null ? (est ? "≈ " : "") + fmtDisplayPrice(value) : "-";
    // 관심 코인 탭과 같은 방식: 편집 모드에서는 행이 오른쪽으로 밀리고 왼쪽에 ✕가 나온다
    html += `<div class="grid-row pf-row ${pfEditMode ? "editing" : ""}" data-id="${p.id}">
      ${pfEditMode ? `<div class="row-del" data-idx="${idx}">✕</div>` : ""}
      <div class="coin-cell">${coinLogoHtml(coin)}<div class="coin-text"><div class="coin-name">${coinName(p)}</div><div class="coin-sym">${p.symbol}</div></div></div>
      <div class="pf-amt">${amtCell}</div>
      <div class="price${est ? " myx-est" : ""}"><span class="roll-wrap"><span class="roll-cur">${valText}</span></span></div>
    </div>`;
    prevValues["pf:" + p.id] = displayPriceNum(value) ?? 0; // 다음 갱신 때 굴러갈 방향 기준
  });
  list.innerHTML = html;
  list.querySelectorAll(".pf-row").forEach(row=>{
    row.addEventListener("click", (e)=>{
      if(e.target.closest(".row-del")) return;
      selectCoin(row.dataset.id);
    });
  });
  list.querySelectorAll(".row-del").forEach(d=>{
    d.addEventListener("click", (e)=>{
      e.stopPropagation();
      deleteHolding(holdings[Number(d.dataset.idx)], d.closest(".pf-row"));
    });
  });
  document.getElementById("pfTotal").innerHTML =
    `<span class="roll-wrap"><span class="roll-cur">${fmtDisplayPrice(total)}</span></span>`;
  prevValues["pf:total"] = displayPriceNum(total) ?? 0;
}

// ---------- 포트폴리오 전환 / 추가 / 삭제 ----------
export function renderPortfolioHeaderBtn(){
  document.getElementById("pfPortfolioBtn").textContent = pfName(currentPortfolio().name) + " ▾";
}

function renderPortfolioDropdown(){
  const box = document.getElementById("pfPortfolioPanel");
  let html = state.portfolios.map((p, idx)=>`
    <div class="add-result-row" data-pfsel="${idx}" style="cursor:pointer;">
      <div>${pfName(p.name)}${idx===state.activePortfolioIdx ? ' <span style="color:var(--gold);">✓</span>' : ''}</div>
      <div style="display:flex; gap:10px; align-items:center; flex-shrink:0;">
        <span style="color:var(--muted); cursor:pointer;" data-pfrename="${idx}">✎</span>
        ${state.portfolios.length > 1 ? `<span style="color:var(--down); font-weight:700; cursor:pointer;" data-pfdel="${idx}">✕</span>` : ''}
      </div>
    </div>`).join("");
  html += `<div class="add-result-row" data-pfnew="1" style="cursor:pointer; justify-content:center; color:var(--gold); font-weight:700;">${t("+ 포트폴리오 추가", "+ New portfolio")}</div>`;
  box.innerHTML = html;
  box.querySelectorAll("[data-pfsel]").forEach(el=>{
    el.addEventListener("click", (e)=>{
      if(e.target.closest("[data-pfdel]") || e.target.closest("[data-pfrename]")) return;
      switchPortfolio(Number(el.dataset.pfsel));
    });
  });
  box.querySelectorAll("[data-pfrename]").forEach(el=>{
    el.addEventListener("click", (e)=>{
      e.stopPropagation();
      renamePortfolio(Number(el.dataset.pfrename));
    });
  });
  box.querySelectorAll("[data-pfdel]").forEach(el=>{
    el.addEventListener("click", (e)=>{
      e.stopPropagation();
      deletePortfolio(Number(el.dataset.pfdel));
    });
  });
  box.querySelector("[data-pfnew]").addEventListener("click", addPortfolio);
}

function switchPortfolio(idx){
  state.activePortfolioIdx = idx;
  pfCoinFilter = "all"; // 다른 포트폴리오엔 그 코인이 없을 수 있다
  renderPortfolioHeaderBtn();
  syncPfExCheckboxes();
  renderPortfolio();
  document.getElementById("pfPortfolioPanel").style.display = "none";
  saveState();
}

function addPortfolio(){
  if(state.portfolios.length >= MAX_PORTFOLIOS){
    showAlert(t(`포트폴리오는 최대 ${MAX_PORTFOLIOS}개까지 만들 수 있어요.`, `You can create up to ${MAX_PORTFOLIOS} portfolios.`));
    return;
  }
  state.portfolios.push({ name: t("포트폴리오 ", "Portfolio ") + (state.portfolios.length+1), holdings:[], trades:[], exchanges:["upbit"] });
  state.activePortfolioIdx = state.portfolios.length - 1;
  renderPortfolioHeaderBtn();
  renderPortfolioDropdown();
  syncPfExCheckboxes();
  renderPortfolio();
  document.getElementById("pfPortfolioPanel").style.display = "none";
  saveState();
}

async function renamePortfolio(idx){
  const p = state.portfolios[idx];
  const newName = await showPrompt(t("포트폴리오 이름을 입력해주세요", "Enter a portfolio name"), pfName(p.name));
  if(newName === null) return; // 취소
  // 화면에 HTML로 들어가는 이름이라 태그를 열 수 있는 글자는 걷는다(sanitize.js)
  const trimmed = cleanText(newName, 20);
  if(!trimmed) return;
  p.name = trimmed;
  renderPortfolioHeaderBtn();
  renderPortfolioDropdown();
  saveState();
}

async function deletePortfolio(idx){
  if(state.portfolios.length <= 1) return; // 최소 1개는 유지
  const p = state.portfolios[idx];
  if(p.trades.length > 0){
    const ok = await showConfirm(t(`"${pfName(p.name)}"의 거래 기록 ${p.trades.length}개가 함께 삭제됩니다. 정말 삭제하시겠어요?`,
      `This will also delete ${p.trades.length} transaction${p.trades.length === 1 ? "" : "s"} in "${pfName(p.name)}". Delete it?`));
    if(!ok) return;
  }
  state.portfolios.splice(idx, 1);
  if(state.activePortfolioIdx >= state.portfolios.length) state.activePortfolioIdx = state.portfolios.length - 1;
  else if(state.activePortfolioIdx > idx) state.activePortfolioIdx--;
  renderPortfolioHeaderBtn();
  renderPortfolioDropdown();
  syncPfExCheckboxes();
  renderPortfolio();
  saveState();
}

export function syncPfExCheckboxes(){
  const set = new Set(currentPortfolio().exchanges);
  document.querySelectorAll(".pfex-check").forEach(cb=>{ cb.checked = set.has(cb.value); });
  renderPfExBtn();
}

// 툴바 버튼에 지금 고른 거래소를 요약: "업비트", "업비트 외 2곳" (영어: "Upbit", "Upbit +2")
function renderPfExBtn(){
  const names = [...document.querySelectorAll(".pfex-check:checked")]
    .map(cb => cb.closest(".ex-tile").querySelector(".ex-tile-name").textContent);
  document.getElementById("pfExBtn").textContent =
    (names.length === 0 ? t("거래소 설정", "Exchanges") : names.length === 1 ? names[0]
      : t(`${names[0]} 외 ${names.length - 1}곳`, `${names[0]} +${names.length - 1}`)) + " ▾";
}

document.getElementById("pfPortfolioBtn").addEventListener("click", ()=>{
  renderPortfolioDropdown();
  const panel = document.getElementById("pfPortfolioPanel");
  panel.style.display = panel.style.display === "none" ? "block" : "none";
});

// ---------- 가격 기준 거래소 (아래에서 올라오는 창) ----------
const exSheet = document.getElementById("pfExSheet");
document.getElementById("pfExBtn").addEventListener("click", ()=>{
  document.getElementById("pfPortfolioPanel").style.display = "none";
  openOverlay(exSheet);
});
exSheet.addEventListener("click", e=>{
  if(e.target.closest("[data-close]") || !e.target.closest(".sheet")) closeOverlay(exSheet);
});

document.querySelectorAll(".pfex-check").forEach(cb=>{
  cb.addEventListener("change", ()=>{
    currentPortfolio().exchanges = [...document.querySelectorAll(".pfex-check:checked")].map(el=>el.value);
    renderPfExBtn();
    renderPortfolio();
    saveState();
  });
});

// ---------- 보유 코인 삭제 (편집 모드 ✕) ----------
// 보유량은 거래 합계라, 코인을 지우면 그 코인의 거래 기록도 전부 지운다.
async function deleteHolding(h, row){
  if(!h) return;
  const pf = currentPortfolio();
  const n = pf.trades.filter(t => t.id === h.id).length;
  const ok = await showConfirm(t(`${coinName(h)}(${h.symbol})의 거래 기록 ${n}개가 함께 삭제됩니다. 삭제할까요?`,
    `This will also delete ${n} transaction${n === 1 ? "" : "s"} for ${coinName(h)} (${h.symbol}). Delete?`));
  if(!ok) return;
  const go = ()=>{
    pf.trades = pf.trades.filter(t => t.id !== h.id);
    recomputeHoldings(pf);
    renderPortfolio();
    saveState();
  };
  if(row) collapseRow(row, go);
  else go();
}

// ---------- 개요 / 거래 섹션, 개요 안의 자산 / 배분 ----------
document.querySelectorAll(".pf-sec").forEach(btn=>{
  btn.addEventListener("click", ()=> showPfSection(btn.dataset.sec));
});
document.querySelectorAll(".pf-view").forEach(btn=>{
  btn.addEventListener("click", ()=> showPfOverview(btn.dataset.view));
});

function showPfOverview(view, save = true){
  const prev = state.pfOverview;
  state.pfOverview = view === "alloc" ? "alloc" : "assets";
  if(state.pfOverview !== "assets") exitPfEditMode();
  document.querySelectorAll(".pf-view").forEach(b=>{
    const on = b.dataset.view === state.pfOverview;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on);
  });
  document.getElementById("pfAssetsView").hidden = state.pfOverview !== "assets";
  document.getElementById("pfAllocView").hidden = state.pfOverview !== "alloc";
  renderPfAlloc();
  if(save && prev !== state.pfOverview){
    slideIn(document.getElementById(state.pfOverview === "alloc" ? "pfAllocView" : "pfAssetsView"), state.pfOverview === "alloc");
  }
  if(save) saveState();
}

// 새로 보이는 칸을 옆에서 살짝 밀려 들어오게. 오른쪽 칸으로 가면 오른쪽에서, 왼쪽이면 왼쪽에서
function slideIn(el, fromRight){
  el.classList.remove("pf-in-r", "pf-in-l");
  void el.offsetWidth; // 같은 애니메이션을 다시 걸려면 한 번 끊어 줘야 한다
  el.classList.add(fromRight ? "pf-in-r" : "pf-in-l");
}

export function showPfSection(sec, save = true){
  const prev = state.pfSection;
  state.pfSection = sec === "trades" ? "trades" : "holdings";
  if(state.pfSection !== "holdings") exitPfEditMode();
  document.querySelectorAll(".pf-sec").forEach(b=>{
    const on = b.dataset.sec === state.pfSection;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on);
  });
  document.getElementById("pfHoldingsSec").hidden = state.pfSection !== "holdings";
  document.getElementById("pfTradesSec").hidden = state.pfSection !== "trades";
  document.querySelector(".pf-sections").style.setProperty("--sec-idx", state.pfSection === "trades" ? 1 : 0);
  if(save && prev !== state.pfSection){
    slideIn(document.getElementById(state.pfSection === "trades" ? "pfTradesSec" : "pfHoldingsSec"), state.pfSection === "trades");
  }
  showPfOverview(state.pfOverview, false);
  if(save) saveState();
}

// ---------- 거래 섹션 ----------
// 은행 입출금 내역처럼 날짜별로 묶어 최근 것부터. 코인을 고르면 위에 평균 매수가·보유량 카드.
let pfTypeFilter = "all"; // "all" | "buy" | "sell"
let pfCoinFilter = "all"; // "all" | 코인 id
let lastTradesHtml = null;

const TYPE_LABEL = { all: t("모든 유형", "All types"), buy: t("매수", "Buy"), sell: t("매도", "Sell") };
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
const LEGACY_LABEL = t("기존 보유", "Existing holding");

function dateLabel(date){
  if(!date) return LEGACY_LABEL;
  const [y, m, d] = date.split("-").map(Number);
  if(IS_EN){
    // "Mon, Sep 29" / 올해가 아니면 "Mon, Sep 29, 2025"
    return new Date(y, m - 1, d).toLocaleDateString(LOCALE, { weekday: "short", month: "short", day: "numeric",
      year: y === new Date().getFullYear() ? undefined : "numeric" });
  }
  const wd = WEEKDAY[new Date(y, m - 1, d).getDay()];
  const yearPart = y === new Date().getFullYear() ? "" : y + "년 ";
  return `${yearPart}${m}월 ${d}일 (${wd})`;
}

document.getElementById("pfTypeBtn").addEventListener("click", ()=>{
  openSheet({
    title: t("거래 유형", "Transaction type"),
    options: ["all", "buy", "sell"].map(v => ({ value: v, label: TYPE_LABEL[v] })),
    selected: pfTypeFilter,
    onPick: v => { pfTypeFilter = v; renderPfTrades(); }
  });
});

document.getElementById("pfCoinBtn").addEventListener("click", ()=>{
  const coins = tradedCoins(currentPortfolio().trades);
  openSheet({
    title: t("코인", "Coin"),
    options: [{ value: "all", label: t("모든 코인", "All coins") },
      ...coins.map(c => ({ value: c.id, label: `${coinName(c)} (${c.symbol})` }))],
    selected: pfCoinFilter,
    onPick: v => { pfCoinFilter = v; renderPfTrades(); }
  });
});

function renderPfTrades(){
  const pf = currentPortfolio();
  const coins = tradedCoins(pf.trades);
  if(pfCoinFilter !== "all" && !coins.some(c => c.id === pfCoinFilter)) pfCoinFilter = "all";
  const coin = coins.find(c => c.id === pfCoinFilter);

  const typeBtn = document.getElementById("pfTypeBtn");
  typeBtn.textContent = TYPE_LABEL[pfTypeFilter] + " ▾";
  typeBtn.classList.toggle("on", pfTypeFilter !== "all");
  const coinBtn = document.getElementById("pfCoinBtn");
  coinBtn.textContent = (coin ? coin.symbol : t("모든 코인", "All coins")) + " ▾";
  coinBtn.classList.toggle("on", !!coin);

  let cards = "";
  if(coin){
    const { avg, partial } = avgBuyPrice(pf.trades, coin.id);
    cards = `<div class="pf-cards">
      <div class="pf-card"><div class="label">${t("평균 매수가", "Avg. buy price")}</div><div class="val">${fmtMoney(avg)}</div>
        ${partial ? `<div class="note">${t("단가 없는 기록 제외", "Excludes entries without a price")}</div>` : ""}</div>
      <div class="pf-card"><div class="label">${t("보유량", "Holding")}</div>
        <div class="val">${fmtAmount(holdingAmount(pf.trades, coin.id))} <span class="unit">${coin.symbol}</span></div></div>
    </div>`;
  }

  // 최근 날짜가 위, 같은 날은 나중에 넣은 것이 위. 날짜 모르는 기존 보유분은 맨 아래
  const list = pf.trades.map((t, i) => ({ t, i }))
    .filter(({ t }) => (pfTypeFilter === "all" || t.side === pfTypeFilter) && (!coin || t.id === coin.id))
    .sort((a, b) => (b.t.date || "").localeCompare(a.t.date || "") || b.i - a.i)
    .map(x => x.t);

  let body;
  if(pf.trades.length === 0){
    body = '<div class="empty">' + t("거래를 추가하면 여기에 기록됩니다.", "Transactions you add will be listed here.") + '</div>';
  }else if(list.length === 0){
    body = '<div class="empty">' + t("조건에 맞는 거래가 없습니다.", "No transactions match these filters.") + '</div>';
  }else{
    body = "";
    let curDate;
    list.forEach(t=>{
      if(t.date !== curDate){
        if(curDate !== undefined) body += "</div>";
        curDate = t.date;
        body += `<div class="tx-date">${dateLabel(t.date)}</div><div class="tx-group">`;
      }
      const c = findCoinAnywhere(t.id) || { symbol: t.symbol };
      const px = priceInDisplay(t.price, t.cur);
      const buy = t.side === "buy";
      const kind = t.legacy ? LEGACY_LABEL : TYPE_LABEL[buy ? "buy" : "sell"];
      const sub = px !== null ? `${kind} · ${tr("단가", "Price")} ${fmtMoney(px)}` : `${kind} · ${tr("단가 미입력", "No price")}`;
      body += `<div class="tx-row" data-tid="${t.tid}" role="button">
        ${coinLogoHtml(c)}
        <div class="tx-main"><div class="tx-title">${coinName(t)}</div><div class="tx-sub">${sub}</div></div>
        <div class="tx-right"><div class="tx-amt ${buy ? "up" : "down"}">${buy ? "+" : "−"}${fmtAmount(t.amount)} ${t.symbol}</div>
          <div class="tx-sub">${px !== null ? fmtMoney(px * t.amount) : "-"}</div></div>
      </div>`;
    });
    body += "</div>";
  }

  // 시세 갱신 주기마다 불리므로 내용이 같으면 건드리지 않는다
  const html = cards + body;
  if(html === lastTradesHtml) return;
  lastTradesHtml = html;
  document.getElementById("pfCoinCards").innerHTML = cards;
  document.getElementById("pfTradeList").innerHTML = body;
}

// 기록을 누르면 아래에서 메뉴: 단가 입력/수정, 삭제
document.getElementById("pfTradeList").addEventListener("click", (e)=>{
  const row = e.target.closest(".tx-row");
  if(!row) return;
  const pf = currentPortfolio();
  const t = pf.trades.find(x => x.tid === row.dataset.tid);
  if(!t) return;
  const kind = t.legacy ? LEGACY_LABEL : TYPE_LABEL[t.side];
  openSheet({
    title: `${t.symbol} ${kind} · ${fmtAmount(t.amount)} ${t.symbol}`,
    options: [
      { value: "price", label: t.price === null ? tr("단가 입력", "Add price") : tr("단가 수정", "Edit price") },
      { value: "delete", label: tr("기록 삭제", "Delete transaction"), danger: true }
    ],
    onPick: v => v === "price" ? editTradePrice(t) : deleteTrade(t)
  });
});

async function editTradePrice(t){
  const cur = priceInDisplay(t.price, t.cur);
  const unit = state.displayCurrency === "krw" ? "₩" : "$";
  const v = await showPrompt(tr(`${t.symbol} 1개당 단가 (${unit})\n비워 두면 단가 없이 저장돼요.`,
    `Price per ${t.symbol} (${unit})\nLeave it empty to save without a price.`), cur !== null ? String(roundPrice(cur)) : "");
  if(v === null) return;
  const s = v.replace(/,/g, "").trim();
  if(s === ""){ t.price = null; t.cur = null; }
  else{
    const n = parseNum(s); // "12abc"·"1e400"은 null
    if(!(n >= 0 && n <= MAX_INPUT)){ showAlert(tr("단가를 확인해주세요.", "Please check the price.")); return; }
    t.price = n; t.cur = state.displayCurrency;
  }
  renderPfTrades();
  saveState();
}

async function deleteTrade(t){
  const pf = currentPortfolio();
  const rest = pf.trades.filter(x => x !== t);
  if(!await showConfirm(tr("이 거래 기록을 삭제할까요?", "Delete this transaction?"))) return;
  pf.trades = rest;
  recomputeHoldings(pf);
  renderPortfolio();
  saveState();
}
