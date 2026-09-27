import { MAX_PORTFOLIOS } from "./constants.js";
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
import { openSheet } from "./sheet.js";

export function currentPortfolio(){ return state.portfolios[state.activePortfolioIdx]; }

let pfSelectedCoin = null; // 포트폴리오에 담을 코인으로 현재 선택된 항목
let pfCurrentResults = [];
let pfSearchDebounce = null;
let pfSearchPending = null; // 순위 밖 검색 결과를 기다리는 검색어(없으면 null)
let pfEditMode = false; // 보유 코인 삭제 모드 (수량은 거래 기록으로만 바뀐다)
let pfSide = "buy";     // 거래 추가 폼의 매수/매도

document.getElementById("pfCoinSearch").addEventListener("input", (e)=>{
  pfSelectedCoin = null; // 다시 타이핑하면 이전 선택은 해제
  const q = e.target.value.trim();
  clearTimeout(pfSearchDebounce);
  pfSearchPending = q.length >= 2 ? q : null; // 2글자부터 순위 밖까지 찾아본다
  renderPfResults(q); // 로컬 풀(시총 500위) 결과(빈 값이면 시총 순위)는 즉시 표시
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

document.getElementById("pfCoinSearch").addEventListener("focus", ()=>{
  if(!pfSelectedCoin) renderPfResults(document.getElementById("pfCoinSearch").value.trim());
});

document.addEventListener("click", (e)=>{
  if(!e.target.closest("#pfCoinResults") && !e.target.closest("#pfCoinSearch")){
    document.getElementById("pfCoinResults").style.display = "none";
  }
  if(!e.target.closest("#pfPortfolioPanel") && !e.target.closest("#pfPortfolioBtn")){
    document.getElementById("pfPortfolioPanel").style.display = "none";
  }
  if(!e.target.closest("#pfExPanel") && !e.target.closest("#pfExBtn")){
    document.getElementById("pfExPanel").style.display = "none";
  }
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
      : '<div class="add-empty">일치하는 코인이 없습니다.</div>';
    return;
  }
  box.innerHTML = pfCurrentResults.map((entry, idx)=>{
    const c = entry.coin;
    return `<div class="add-result-row" data-pfpick="${idx}" style="cursor:pointer;">
      <div><span class="rank">${c.rank ? c.rank+"위" : "-"}</span>${c.name} <span style="color:var(--muted)">${c.symbol.toUpperCase()}</span></div>
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
  // 단가는 이 포트폴리오 기준 거래소의 지금 시세로 채워 둔다(고쳐 쓰거나 비워도 된다)
  const c = findCoinAnywhere(coin.id);
  const pr = c ? pfCoinPriceUsd(c, new Set(currentPortfolio().exchanges)) : null;
  const px = pr && pr.usd !== null ? displayPriceNum(pr.usd) : null;
  document.getElementById("pfPrice").value = px !== null ? String(roundPrice(px)) : "";
  document.getElementById("pfAmount").focus();
}

// 단가 입력칸에 넣을 값: 원화는 원 단위, 달러는 크기에 맞춰 유효숫자 6자리 정도
function roundPrice(v){
  if(state.displayCurrency === "krw" && v >= 1) return Math.round(v);
  if(v >= 1000) return Math.round(v);
  return parseFloat(v.toPrecision(6));
}

document.getElementById("pfAddBtn").addEventListener("click", ()=>{
  const amount = parseFloat(document.getElementById("pfAmount").value);
  if(!pfSelectedCoin){ showAlert("코인을 검색해서 골라주세요."); return; }
  if(!(amount > 0)){ showAlert("수량을 입력해주세요."); return; }
  const priceStr = document.getElementById("pfPrice").value.trim();
  const price = priceStr === "" ? null : parseFloat(priceStr);
  if(price !== null && !(price >= 0)){ showAlert("단가를 확인해주세요."); return; }
  const pf = currentPortfolio();
  const id = pfSelectedCoin.id;
  const symbol = pfSelectedCoin.symbol.toUpperCase();
  if(pfSide === "sell"){
    const have = holdingAmount(pf.trades, id);
    if(amount > have + 1e-12){
      showAlert(have > 0
        ? `보유량(${fmtAmount(have)} ${symbol})보다 많이 팔 수 없어요.`
        : `이 포트폴리오에 ${symbol} 보유량이 없어요.`);
      return;
    }
  }
  pf.trades.push({ tid: newTid(), id, symbol, name: pfSelectedCoin.name, side: pfSide, amount,
    price, cur: price === null ? null : state.displayCurrency,
    date: document.getElementById("pfDate").value || todayStr() });
  recomputeHoldings(pf);
  document.getElementById("pfAmount").value = "";
  document.getElementById("pfPrice").value = "";
  document.getElementById("pfCoinSearch").value = "";
  pfSelectedCoin = null;
  renderPortfolio();
  saveState();
});

document.querySelectorAll(".pf-side-btn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    pfSide = btn.dataset.side;
    document.querySelectorAll(".pf-side-btn").forEach(b => b.classList.toggle("active", b === btn));
    document.getElementById("pfAddBtn").textContent = pfSide === "sell" ? "매도" : "추가";
  });
});

document.getElementById("pfDate").value = todayStr();

document.getElementById("pfEditBtn").addEventListener("click", (e)=>{
  pfEditMode = !pfEditMode;
  e.target.classList.toggle("active", pfEditMode);
  renderPortfolio();
});

// ---------- 보유 코인 정렬 ----------
// "보유 코인" 헤더를 누를 때마다 추가순 → 금액 오름차순 → 내림차순 순으로 돌아간다.
const SORT_CYCLE = ["added", "asc", "desc"];
const SORT_LABEL = { added: "추가순", asc: "금액 ↑", desc: "금액 ↓" };

// 표시할 순서대로 { p, idx, value, est } 목록을 만든다.
// idx는 holdings 배열의 원래 위치 — 삭제가 이 값을 쓰므로 정렬해도 함께 들고 다녀야 한다.
function sortedRows(holdings, exSet){
  const rows = holdings.map((p, idx)=>{
    const c = findCoinAnywhere(p.id);
    const pr = c ? pfCoinPriceUsd(c, exSet) : null;
    // coin: 로고용. 시세 풀에 없는 코인이면 보유 항목의 심볼만으로 아이콘을 찾는다.
    return { p, idx, coin: c || { symbol: p.symbol }, value: pr && pr.usd !== null ? pr.usd * p.amount : null, est: !!(pr && pr.est) };
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
const PF_HEAD = `<div class="grid-row grid-head"><div>코인</div>`
  + `<div style="text-align:right">보유 수량</div><div style="text-align:right">평가 금액</div></div>`;

// 보유량 표 + 거래 기록 + 추가 폼(단가 칸 통화 표시)을 함께 갱신. force=true면 표 행을 새로 만든다.
export function renderPortfolio(force){
  renderHoldings(force);
  renderPfTrades();
  document.getElementById("pfPrice").placeholder = state.displayCurrency === "krw" ? "단가 (₩)" : "단가 ($)";
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
    list.innerHTML = PF_HEAD + '<div class="empty">거래를 추가하면 보유 코인이 여기에 표시됩니다.</div>';
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
      <div class="coin-cell">${coinLogoHtml(coin)}<div class="coin-text"><div class="coin-name">${p.name}</div><div class="coin-sym">${p.symbol}</div></div></div>
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
  document.getElementById("pfPortfolioBtn").textContent = currentPortfolio().name + " ▾";
}

function renderPortfolioDropdown(){
  const box = document.getElementById("pfPortfolioPanel");
  let html = state.portfolios.map((p, idx)=>`
    <div class="add-result-row" data-pfsel="${idx}" style="cursor:pointer;">
      <div>${p.name}${idx===state.activePortfolioIdx ? ' <span style="color:var(--gold);">✓</span>' : ''}</div>
      <div style="display:flex; gap:10px; align-items:center; flex-shrink:0;">
        <span style="color:var(--muted); cursor:pointer;" data-pfrename="${idx}">✎</span>
        ${state.portfolios.length > 1 ? `<span style="color:var(--down); font-weight:700; cursor:pointer;" data-pfdel="${idx}">✕</span>` : ''}
      </div>
    </div>`).join("");
  html += `<div class="add-result-row" data-pfnew="1" style="cursor:pointer; justify-content:center; color:var(--gold); font-weight:700;">+ 포트폴리오 추가</div>`;
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
    showAlert("포트폴리오는 최대 " + MAX_PORTFOLIOS + "개까지 만들 수 있어요.");
    return;
  }
  state.portfolios.push({ name: "포트폴리오 " + (state.portfolios.length+1), holdings:[], trades:[], exchanges:["upbit"] });
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
  const newName = await showPrompt("포트폴리오 이름을 입력해주세요", p.name);
  if(newName === null) return; // 취소
  const trimmed = newName.trim();
  if(!trimmed) return;
  p.name = trimmed.slice(0, 20);
  renderPortfolioHeaderBtn();
  renderPortfolioDropdown();
  saveState();
}

async function deletePortfolio(idx){
  if(state.portfolios.length <= 1) return; // 최소 1개는 유지
  const p = state.portfolios[idx];
  if(p.trades.length > 0){
    const ok = await showConfirm(`"${p.name}"의 거래 기록 ${p.trades.length}개가 함께 삭제됩니다. 정말 삭제하시겠어요?`);
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
}

document.getElementById("pfPortfolioBtn").addEventListener("click", ()=>{
  renderPortfolioDropdown();
  const panel = document.getElementById("pfPortfolioPanel");
  panel.style.display = panel.style.display === "none" ? "block" : "none";
  document.getElementById("pfExPanel").style.display = "none";
});

document.getElementById("pfExBtn").addEventListener("click", ()=>{
  const panel = document.getElementById("pfExPanel");
  panel.style.display = panel.style.display === "none" ? "block" : "none";
  document.getElementById("pfPortfolioPanel").style.display = "none";
});

document.querySelectorAll(".pfex-check").forEach(cb=>{
  cb.addEventListener("change", ()=>{
    currentPortfolio().exchanges = [...document.querySelectorAll(".pfex-check:checked")].map(el=>el.value);
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
  const ok = await showConfirm(`${h.name}(${h.symbol})의 거래 기록 ${n}개가 함께 삭제됩니다. 삭제할까요?`);
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

// ---------- 보유량 / 거래 섹션 ----------
document.querySelectorAll(".pf-sec").forEach(btn=>{
  btn.addEventListener("click", ()=> showPfSection(btn.dataset.sec));
});

export function showPfSection(sec, save = true){
  state.pfSection = sec === "trades" ? "trades" : "holdings";
  document.querySelectorAll(".pf-sec").forEach(b=>{
    const on = b.dataset.sec === state.pfSection;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on);
  });
  document.getElementById("pfHoldingsSec").hidden = state.pfSection !== "holdings";
  document.getElementById("pfTradesSec").hidden = state.pfSection !== "trades";
  if(save) saveState();
}

// ---------- 거래 섹션 ----------
// 은행 입출금 내역처럼 날짜별로 묶어 최근 것부터. 코인을 고르면 위에 평균 매수가·보유량 카드.
let pfTypeFilter = "all"; // "all" | "buy" | "sell"
let pfCoinFilter = "all"; // "all" | 코인 id
let lastTradesHtml = null;

const TYPE_LABEL = { all: "모든 유형", buy: "매수", sell: "매도" };
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

function dateLabel(date){
  if(!date) return "기존 보유";
  const [y, m, d] = date.split("-").map(Number);
  const wd = WEEKDAY[new Date(y, m - 1, d).getDay()];
  const yearPart = y === new Date().getFullYear() ? "" : y + "년 ";
  return `${yearPart}${m}월 ${d}일 (${wd})`;
}

document.getElementById("pfTypeBtn").addEventListener("click", ()=>{
  openSheet({
    title: "거래 유형",
    options: ["all", "buy", "sell"].map(v => ({ value: v, label: TYPE_LABEL[v] })),
    selected: pfTypeFilter,
    onPick: v => { pfTypeFilter = v; renderPfTrades(); }
  });
});

document.getElementById("pfCoinBtn").addEventListener("click", ()=>{
  const coins = tradedCoins(currentPortfolio().trades);
  openSheet({
    title: "코인",
    options: [{ value: "all", label: "모든 코인" },
      ...coins.map(c => ({ value: c.id, label: `${c.name} (${c.symbol})` }))],
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
  coinBtn.textContent = (coin ? coin.symbol : "모든 코인") + " ▾";
  coinBtn.classList.toggle("on", !!coin);

  let cards = "";
  if(coin){
    const { avg, partial } = avgBuyPrice(pf.trades, coin.id);
    cards = `<div class="pf-cards">
      <div class="pf-card"><div class="label">평균 매수가</div><div class="val">${fmtMoney(avg)}</div>
        ${partial ? '<div class="note">단가 없는 기록 제외</div>' : ""}</div>
      <div class="pf-card"><div class="label">보유량</div>
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
    body = '<div class="empty">거래를 추가하면 여기에 기록됩니다.</div>';
  }else if(list.length === 0){
    body = '<div class="empty">조건에 맞는 거래가 없습니다.</div>';
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
      const kind = t.legacy ? "기존 보유" : (buy ? "매수" : "매도");
      const sub = px !== null ? `${kind} · 단가 ${fmtMoney(px)}` : `${kind} · 단가 미입력`;
      body += `<div class="tx-row" data-tid="${t.tid}" role="button">
        ${coinLogoHtml(c)}
        <div class="tx-main"><div class="tx-title">${t.name}</div><div class="tx-sub">${sub}</div></div>
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
  const kind = t.legacy ? "기존 보유" : (t.side === "buy" ? "매수" : "매도");
  openSheet({
    title: `${t.symbol} ${kind} · ${fmtAmount(t.amount)} ${t.symbol}`,
    options: [
      { value: "price", label: t.price === null ? "단가 입력" : "단가 수정" },
      { value: "delete", label: "기록 삭제", danger: true }
    ],
    onPick: v => v === "price" ? editTradePrice(t) : deleteTrade(t)
  });
});

async function editTradePrice(t){
  const cur = priceInDisplay(t.price, t.cur);
  const unit = state.displayCurrency === "krw" ? "₩" : "$";
  const v = await showPrompt(`${t.symbol} 1개당 단가 (${unit})\n비워 두면 단가 없이 저장돼요.`, cur !== null ? String(roundPrice(cur)) : "");
  if(v === null) return;
  const s = v.replace(/,/g, "").trim();
  if(s === ""){ t.price = null; t.cur = null; }
  else{
    const n = parseFloat(s);
    if(!(n >= 0)){ showAlert("단가를 확인해주세요."); return; }
    t.price = n; t.cur = state.displayCurrency;
  }
  renderPfTrades();
  saveState();
}

async function deleteTrade(t){
  const pf = currentPortfolio();
  const rest = pf.trades.filter(x => x !== t);
  // 매수를 지워서 보유량이 음수가 되면(그만큼 이미 팔았으면) 막는다
  if(t.side === "buy" && holdingAmount(rest, t.id) < -1e-12){
    showAlert("이 매수를 지우면 보유량이 0보다 작아져요. 매도 기록을 먼저 지워주세요.");
    return;
  }
  if(!await showConfirm("이 거래 기록을 삭제할까요?")) return;
  pf.trades = rest;
  recomputeHoldings(pf);
  renderPortfolio();
  saveState();
}
