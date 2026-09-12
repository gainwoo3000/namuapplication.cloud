import { MAX_PORTFOLIOS } from "./constants.js";
import { state } from "./state.js";
import { collapseRow } from "./animate.js";
import { fmtDisplayPrice } from "./format.js";
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

export function renderPortfolio(){
  if(state.rowAnimating) return; // 삭제 애니메이션 중에는 재렌더 보류
  const list = document.getElementById("pfList");
  const totalLabel = state.displayCurrency === "krw" ? "₩0" : "$0.00";
  const holdings = currentPortfolio().holdings;
  const exSet = new Set(currentPortfolio().exchanges);
  if(holdings.length === 0){
    list.innerHTML = '<div class="empty">보유 코인을 추가하면 여기에 표시됩니다.</div>';
    document.getElementById("pfTotal").textContent = totalLabel;
    return;
  }
  let total = 0;
  let html = "";
  holdings.forEach((p, idx)=>{
    const c = findCoinAnywhere(p.id);
    const priceUsd = c ? pfCoinPriceUsd(c, exSet) : null;
    const value = priceUsd !== null ? priceUsd * p.amount : null;
    if(value !== null) total += value;
    const amtCell = pfEditMode
      ? `<input class="pf-amt-edit" type="number" step="any" min="0" value="${p.amount}" data-idx="${idx}">`
      : `${p.amount}`;
    const delCell = pfEditMode ? `<div class="del" data-idx="${idx}">✕</div>` : `<div></div>`;
    html += `<div class="pf-row" data-id="${p.id}">
      <div>${p.name}<div class="coin-sym">${p.symbol}</div></div>
      <div>${amtCell}</div>
      <div class="price">${value !== null ? fmtDisplayPrice(value) : "-"}</div>
      ${delCell}
    </div>`;
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
      if(!isFinite(v) || v <= 0){ renderPortfolio(); return; }
      holdings[Number(inp.dataset.idx)].amount = v;
      renderPortfolio();
      saveState();
    });
  });
  document.getElementById("pfTotal").textContent = fmtDisplayPrice(total);
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
