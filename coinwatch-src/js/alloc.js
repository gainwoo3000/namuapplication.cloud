import { fmtDisplayPrice } from "./format.js";
import { coinLogoHtml } from "./logo.js";

// ---------- 포트폴리오 › 개요 › 배분: 코인별 비중 도넛 차트 ----------
// rows: portfolio.js sortedRows()의 결과 { p, idx, coin, value(USD), est }
// 평가 금액이 큰 순으로 7개까지 색을 주고, 나머지는 회색 "기타"로 묶는다.
// 색은 순위가 아니라 코인을 따라간다 — 뽑힌 7개를 보유 목록 순서(idx)대로 1~7번 색에 앉힌다.
// 그래야 금액이 엎치락뒤치락해도 코인 색이 서로 바뀌지 않는다. 색 값은 styles.css의 --alloc-1~7.
const MAX_SLICES = 7;
const R = 80, STROKE = 26, GAP = 2; // 조각 사이 2px 틈(배경이 비쳐 경계가 된다)
const C = 2 * Math.PI * R;

let selectedId = null; // 누른 조각/범례. 가운데에 그 코인의 비중·금액이 뜬다

function fmtPct(r){
  const p = r * 100;
  if(p > 0 && p < 0.1) return "<0.1%";
  return p.toFixed(1) + "%";
}

function buildSlices(rows){
  const priced = rows.filter(r => r.value !== null && r.value > 0).sort((a, b) => b.value - a.value);
  const total = priced.reduce((s, r) => s + r.value, 0);
  const top = priced.slice(0, MAX_SLICES);
  const rest = priced.slice(top.length);
  const colorOf = new Map([...top].sort((a, b) => a.idx - b.idx).map((r, i) => [r.p.id, `var(--alloc-${i + 1})`]));
  const slices = top.map(r => ({
    id: r.p.id, name: r.p.name, symbol: r.p.symbol, coin: r.coin, value: r.value, est: r.est,
    color: colorOf.get(r.p.id)
  }));
  if(rest.length){
    slices.push({ id: "__other", name: "기타", symbol: `코인 ${rest.length}개`, coin: null,
      value: rest.reduce((s, r) => s + r.value, 0), est: rest.some(r => r.est), color: "var(--alloc-other)" });
  }
  return { slices, total, count: priced.length, missing: rows.length - priced.length };
}

function donutSvg(slices, total){
  if(slices.length === 1){
    const s = slices[0];
    return `<circle class="alloc-seg" data-id="${s.id}" cx="100" cy="100" r="${R}" fill="none" stroke="${s.color}" stroke-width="${STROKE}"/>`;
  }
  let at = 0, out = "";
  for(const s of slices){
    const len = s.value / total * C;
    // 너무 얇은 조각도 보이게 최소 1px은 남긴다
    const draw = Math.max(len - GAP, 1);
    out += `<circle class="alloc-seg" data-id="${s.id}" cx="100" cy="100" r="${R}" fill="none" stroke="${s.color}"`
      + ` stroke-width="${STROKE}" stroke-dasharray="${draw} ${C}" stroke-dashoffset="${-at}"/>`;
    at += len;
  }
  return out;
}

function centerHtml(slices, total, count){
  const s = slices.find(x => x.id === selectedId);
  if(!s) return `<div class="alloc-c-label">보유 코인</div><div class="alloc-c-val">${count}개</div>`;
  return `<div class="alloc-c-label">${s.id === "__other" ? "기타" : s.symbol}</div>`
    + `<div class="alloc-c-val">${fmtPct(s.value / total)}</div>`
    + `<div class="alloc-c-sub">${s.est ? "≈ " : ""}${fmtDisplayPrice(s.value)}</div>`;
}

export function renderAlloc(box, rows, loading){
  if(rows.length === 0){
    box.innerHTML = '<div class="empty">거래를 추가하면 코인별 비중이 여기에 표시됩니다.</div>';
    return;
  }
  if(loading){
    box.innerHTML = '<div class="alloc-card"><div class="alloc-chart"><span class="sk alloc-sk"></span></div></div>';
    return;
  }
  const { slices, total, count, missing } = buildSlices(rows);
  if(slices.length === 0){
    box.innerHTML = '<div class="empty">시세를 아직 몰라서 비중을 계산할 수 없어요.</div>';
    return;
  }
  if(selectedId && !slices.some(s => s.id === selectedId)) selectedId = null;

  const legend = slices.map(s => `
    <button type="button" class="alloc-row${s.id === selectedId ? " on" : ""}" data-id="${s.id}">
      <span class="alloc-sw" style="background:${s.color}"></span>
      ${s.coin ? coinLogoHtml(s.coin) : '<span class="alloc-other-ic" aria-hidden="true">…</span>'}
      <span class="alloc-name"><span class="coin-name">${s.name}</span><span class="coin-sym">${s.symbol}</span></span>
      <span class="alloc-nums"><span class="alloc-pct">${fmtPct(s.value / total)}</span>`
    + `<span class="alloc-amt${s.est ? " myx-est" : ""}">${s.est ? "≈ " : ""}${fmtDisplayPrice(s.value)}</span></span>
    </button>`).join("");

  box.innerHTML = `<div class="alloc-card${selectedId ? " has-sel" : ""}">
      <div class="alloc-chart">
        <svg viewBox="0 0 200 200" role="img" aria-label="코인별 보유 비중 도넛 차트">
          <g transform="rotate(-90 100 100)">${donutSvg(slices, total)}</g>
        </svg>
        <div class="alloc-center">${centerHtml(slices, total, count)}</div>
      </div>
      <div class="alloc-legend">${legend}</div>
      ${missing > 0 ? `<div class="alloc-note">시세를 모르는 코인 ${missing}개는 빠져 있어요.</div>` : ""}
    </div>`;
  box.querySelectorAll(`.alloc-seg[data-id="${CSS.escape(selectedId || "")}"]`).forEach(el => el.classList.add("on"));

  // 조각이나 범례를 누르면 그 코인을 강조하고 가운데에 비중·금액. 한 번 더 누르면 풀린다
  const pick = id => {
    selectedId = selectedId === id ? null : id;
    renderAlloc(box, rows, loading);
  };
  box.querySelectorAll(".alloc-row, .alloc-seg").forEach(el => {
    el.addEventListener("click", () => pick(el.dataset.id));
  });
}
