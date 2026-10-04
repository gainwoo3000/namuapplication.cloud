import { fmtDisplayPrice } from "./format.js";
import { coinLogoHtml } from "./logo.js";
import { t } from "./i18n.js";

// ---------- 포트폴리오 › 개요 › 배분: 코인별 비중 도넛 차트 ----------
// rows: portfolio.js sortedRows()의 결과 { p, idx, name, coin, value(USD), est }
// 평가 금액이 큰 순으로 7개까지 색을 주고, 나머지는 회색 "기타"로 묶는다.
// 색은 순위가 아니라 코인을 따라간다 — 뽑힌 7개를 보유 목록 순서(idx)대로 1~7번 색에 앉힌다.
// 그래야 금액이 엎치락뒤치락해도 코인 색이 서로 바뀌지 않는다. 색 값은 styles.css의 --alloc-1~7.
const MAX_SLICES = 7;
const R = 80, STROKE = 26, GAP = 2; // 조각 사이 2px 틈(배경이 비쳐 경계가 된다)
const C = 2 * Math.PI * R;
const POP = 7; // 누른 조각이 바깥쪽으로 빠지는 거리. viewBox에 그만큼 여백을 둔다
const OTHER = t("기타", "Other");

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
    id: r.p.id, name: r.name, symbol: r.p.symbol, coin: r.coin, value: r.value, est: r.est,
    color: colorOf.get(r.p.id)
  }));
  if(rest.length){
    slices.push({ id: "__other", name: OTHER, symbol: t(`코인 ${rest.length}개`, `${rest.length} coins`), coin: null,
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
    // 조각 한가운데 방향(이 그룹은 -90° 돌아 있지만 이동도 같은 틀 안이라 그대로 맞는다)
    const mid = (at + draw / 2) / R;
    const dx = (Math.cos(mid) * POP).toFixed(2), dy = (Math.sin(mid) * POP).toFixed(2);
    out += `<circle class="alloc-seg" data-id="${s.id}" cx="100" cy="100" r="${R}" fill="none" stroke="${s.color}"`
      + ` stroke-width="${STROKE}" stroke-dasharray="${draw} ${C}" stroke-dashoffset="${-at}"`
      + ` style="--pop:translate(${dx}px, ${dy}px)"/>`;
    at += len;
  }
  return out;
}

function centerHtml(slices, total, count){
  const s = slices.find(x => x.id === selectedId);
  if(!s) return `<div class="alloc-c-label">${t("보유 코인", "Holdings")}</div><div class="alloc-c-val">${t(count + "개", count)}</div>`;
  return `<div class="alloc-c-label">${s.id === "__other" ? OTHER : s.symbol}</div>`
    + `<div class="alloc-c-val">${fmtPct(s.value / total)}</div>`
    + `<div class="alloc-c-sub">${s.est ? "≈ " : ""}${fmtDisplayPrice(s.value)}</div>`;
}

export function renderAlloc(box, rows, loading){
  if(rows.length === 0){
    box.innerHTML = '<div class="empty">' + t("거래를 추가하면 코인별 비중이 여기에 표시됩니다.", "Add a transaction to see how your holdings are split.") + '</div>';
    return;
  }
  if(loading){
    box.innerHTML = '<div class="alloc-card"><div class="alloc-chart"><span class="sk alloc-sk"></span></div></div>';
    return;
  }
  const { slices, total, count, missing } = buildSlices(rows);
  if(slices.length === 0){
    box.innerHTML = '<div class="empty">' + t("시세를 아직 몰라서 비중을 계산할 수 없어요.", "Prices aren't available yet, so the split can't be calculated.") + '</div>';
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
        <svg viewBox="${-POP} ${-POP} ${200 + POP * 2} ${200 + POP * 2}" role="img" aria-label="${t("코인별 보유 비중 도넛 차트", "Donut chart of holdings by coin")}">
          <g transform="rotate(-90 100 100)">${donutSvg(slices, total)}</g>
        </svg>
        <div class="alloc-center">${centerHtml(slices, total, count)}</div>
      </div>
      <div class="alloc-legend">${legend}</div>
      ${missing > 0 ? `<div class="alloc-note">${t(`시세를 모르는 코인 ${missing}개는 빠져 있어요.`, `${missing} coin${missing === 1 ? "" : "s"} without a price ${missing === 1 ? "is" : "are"} left out.`)}</div>` : ""}
    </div>`;
  const card = box.querySelector(".alloc-card");
  const center = box.querySelector(".alloc-center");
  // 선택은 다시 그리지 않고 제자리에서 클래스만 바꾼다 — 그래야 조각이 빠지고 들어가는 전환이 보인다
  const applySel = () => {
    card.classList.toggle("has-sel", !!selectedId);
    box.querySelectorAll(".alloc-seg, .alloc-row").forEach(el => el.classList.toggle("on", el.dataset.id === selectedId));
    center.innerHTML = centerHtml(slices, total, count);
  };
  applySel();

  // 조각이나 범례를 누르면 그 조각이 바깥으로 살짝 빠지고, 가운데에 비중·금액. 한 번 더 누르면 풀린다
  const pick = id => {
    selectedId = selectedId === id ? null : id;
    applySel();
    // 가운데 글자는 누를 때만 살짝 바뀌는 효과(15초 갱신으로 다시 그릴 때는 안 움직이게)
    center.classList.remove("swap");
    void center.offsetWidth;
    center.classList.add("swap");
  };
  box.querySelectorAll(".alloc-row, .alloc-seg").forEach(el => {
    el.addEventListener("click", () => pick(el.dataset.id));
  });
}
