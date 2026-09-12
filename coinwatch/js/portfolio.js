import { MAX_PORTFOLIOS } from "./constants.js";
import { state } from "./state.js";
import { collapseRow, prevValues, rollNumberByKey } from "./animate.js";
import { fmtDisplayPrice, displayPriceNum } from "./format.js";
import { findCoinAnywhere } from "./watchlist.js";
import { pfCoinPriceUsd } from "./pricing.js";
import { selectCoin } from "./chart.js";
import { resolveOrCreateSearchCoin, searchExternalCoins, matchesLocalQuery } from "./search.js";
import { saveState } from "./persist.js";
import { showAlert, showPrompt, showConfirm } from "./dialog.js";

export function currentPortfolio(){ return state.portfolios[state.activePortfolioIdx]; }

let pfSelectedCoin = null; // 포트폴리오에 담을 코인으로 현재 선택된 항목
let pfCurrentResults = [];
let pfSearchDebounce = null;
let pfEditMode = false; // 보유 코인 수량 수정 + 삭제 모드

document.getElementById("pfCoinSearch").addEventListener("input", (e)=>{
  pfSelectedCoin = null; // 다시 타이핑하면 이전 선택은 해제
  const q = e.target.value.trim();
  renderPfResults(q); // 로컬 풀(시총 500위) 결과(빈 값이면 시총 순위)는 즉시 표시
  clearTimeout(pfSearchDebounce);
  if(q.length < 2) return;
  pfSearchDebounce = setTimeout(async ()=>{
    const extResults = await searchExternalCoins(q);
    if(document.getElementById("pfCoinSearch").value.trim() === q){
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
    box.innerHTML = '<div class="add-empty">일치하는 코인이 없습니다.</div>';
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
  document.getElementById("pfAmount").focus();
}

document.getElementById("pfAddBtn").addEventListener("click", ()=>{
  const amount = parseFloat(document.getElementById("pfAmount").value);
  if(!pfSelectedCoin || !amount || amount<=0) return;
  const id = pfSelectedCoin.id;
  const holdings = currentPortfolio().holdings;
  const existing = holdings.find(p=>p.id===id);
  if(existing) existing.amount += amount;
  else holdings.push({id, symbol:pfSelectedCoin.symbol.toUpperCase(), name:pfSelectedCoin.name, amount});
  document.getElementById("pfAmount").value = "";
  document.getElementById("pfCoinSearch").value = "";
  pfSelectedCoin = null;
  renderPortfolio();
  saveState();
});

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
// idx는 holdings 배열의 원래 위치 — 삭제·수량수정이 이 값을 쓰므로 정렬해도 함께 들고 다녀야 한다.
function sortedRows(holdings, exSet){
  const rows = holdings.map((p, idx)=>{
    const c = findCoinAnywhere(p.id);
    const pr = c ? pfCoinPriceUsd(c, exSet) : null;
    return { p, idx, value: pr && pr.usd !== null ? pr.usd * p.amount : null, est: !!(pr && pr.est) };
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
  return state.activePortfolioIdx + "|" + pfEditMode + "|" + state.displayCurrency + "|" + state.pfSortMode + "|"
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

// force=true 면 수량 입력 중이어도 행을 다시 만든다 (입력을 막 끝낸 change 핸들러용).
export function renderPortfolio(force){
  if(state.rowAnimating) return; // 삭제 애니메이션 중에는 재렌더 보류
  const list = document.getElementById("pfList");
  const totalLabel = state.displayCurrency === "krw" ? "₩0" : "$0.00";
  const holdings = currentPortfolio().holdings;
  const exSet = new Set(currentPortfolio().exchanges);

  // 코인·수량·편집모드·표시통화·정렬순서가 그대로면 행을 새로 만들지 않는다.
  // innerHTML로 목록을 갈아끼우면 입력 중이던 수량 입력창이 사라져서,
  // 모바일에서는 갱신 주기마다 키보드가 닫히고 입력하던 값도 날아간다.
  const rows = sortedRows(holdings, exSet);
  const sig = pfSignature(rows);
  if(!force && sig === lastPfSignature && list.querySelector(".pf-row")){
    updatePortfolioValues(rows);
    return;
  }
  // 금액 순 정렬에서는 시세가 움직이면 순서가 바뀌어 행을 다시 만들어야 하는데,
  // 하필 수량을 입력하는 중이면 입력창이 사라진다. 그때는 값만 갱신하고 재정렬은 미룬다.
  const focused = document.activeElement;
  if(!force && focused && focused.classList.contains("pf-amt-edit") && list.contains(focused)){
    updatePortfolioValues(rows);
    return;
  }
  lastPfSignature = sig;
  if(holdings.length === 0){
    list.innerHTML = '<div class="empty">보유 코인을 추가하면 여기에 표시됩니다.</div>';
    document.getElementById("pfTotal").textContent = totalLabel;
    return;
  }
  let total = 0;
  let html = "";
  rows.forEach(({ p, idx, value, est })=>{
    if(value !== null) total += value;
    const amtCell = pfEditMode
      ? `<input class="pf-amt-edit" type="number" step="any" min="0" value="${p.amount}" data-idx="${idx}">`
      : `${p.amount}`;
    const delCell = pfEditMode ? `<div class="del" data-idx="${idx}">✕</div>` : `<div></div>`;
    const valText = value !== null ? (est ? "≈ " : "") + fmtDisplayPrice(value) : "-";
    html += `<div class="pf-row" data-id="${p.id}">
      <div>${p.name}<div class="coin-sym">${p.symbol}</div></div>
      <div>${amtCell}</div>
      <div class="price${est ? " myx-est" : ""}"><span class="roll-wrap"><span class="roll-cur">${valText}</span></span></div>
      ${delCell}
    </div>`;
    prevValues["pf:" + p.id] = displayPriceNum(value) ?? 0; // 다음 갱신 때 굴러갈 방향 기준
  });
  list.innerHTML = html;
  list.querySelectorAll(".pf-row").forEach(row=>{
    row.addEventListener("click", (e)=>{
      if(e.target.closest(".del") || e.target.closest(".pf-amt-edit")) return;
      selectCoin(row.dataset.id);
    });
  });
  list.querySelectorAll(".del").forEach(d=>{
    d.addEventListener("click", (e)=>{
      e.stopPropagation();
      const idx = Number(d.dataset.idx);
      const go = ()=>{ holdings.splice(idx,1); renderPortfolio(); saveState(); };
      const row = d.closest(".pf-row");
      if(row) collapseRow(row, go);
      else go();
    });
  });
  list.querySelectorAll(".pf-amt-edit").forEach(inp=>{
    inp.addEventListener("click", (e)=> e.stopPropagation());
    inp.addEventListener("change", ()=>{
      const v = parseFloat(inp.value);
      // 입력을 끝낸 시점이라 포커스가 아직 남아 있어도 강제로 다시 그린다(가치·총합 갱신)
      if(!isFinite(v) || v <= 0){ renderPortfolio(true); return; }
      holdings[Number(inp.dataset.idx)].amount = v;
      renderPortfolio(true);
      saveState();
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
  state.portfolios.push({ name: "포트폴리오 " + (state.portfolios.length+1), holdings:[], exchanges:["upbit"] });
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
  if(p.holdings.length > 0){
    const ok = await showConfirm(`"${p.name}"에 담긴 코인 ${p.holdings.length}개가 함께 삭제됩니다. 정말 삭제하시겠어요?`);
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
