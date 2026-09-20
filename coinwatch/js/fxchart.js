// 헤더의 "원/달러 환율"을 누르면 열리는 추이 그래프.
// 코인 차트(chart.js)는 트레이딩뷰 위젯을 쓰지만, 환율은 일별 종가 몇백 개가 전부라
// 외부 위젯을 하나 더 띄우는 대신 SVG로 직접 그린다 — 테마(다크/라이트)와 글자 크기 설정이
// 그대로 먹고, 추가로 로드할 스크립트도 없다.
import { state } from "./state.js";
import { FX_RANGES } from "./constants.js";
import { fetchFxHistory } from "./api.js";
import { rollNumberByKey } from "./animate.js";
import { ensureUsdKrw } from "./fx.js";
import { closeChart } from "./chart.js";

let fxDays = 90;                  // 현재 선택된 기간 (FX_RANGES의 days)
const fxCache = {};               // days -> {source, points} — 같은 기간을 다시 누르면 재요청 없이 즉시 그림
let fxGeom = null;                // 스크럽(손가락/커서로 값 훑기)에 쓰는 마지막 렌더의 좌표 정보

const fmtRate = v => v.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
const mmdd    = t => t.slice(5, 7) + "." + t.slice(8, 10);

// ---------- 열고 닫기 ----------
export async function openFxChart(){
  const panel = document.getElementById("fxPanel");
  if(state.selectedCoinId) closeChart(); // 코인 차트와 같은 자리(화면 하단)라 둘이 겹치지 않게 닫는다
  panel.style.display = "block";
  document.body.classList.add("chart-open");
  renderFxRangeOpts();
  await ensureUsdKrw();
  renderFxLive();
  loadAndDraw(fxDays);
}

export function closeFxChart(){
  document.getElementById("fxPanel").style.display = "none";
  document.body.classList.remove("chart-open");
  fxGeom = null;
}

// 2분마다 도는 환율 갱신(fx.js)이 패널이 열려 있을 때 큰 숫자도 같이 굴려주도록.
export function syncFxChartPrice(){
  if(document.getElementById("fxPanel").style.display === "block") renderFxLive();
}

// ---------- 패널 상단: 실시간 환율 + 선택 기간 등락 ----------
function renderFxLive(){
  if(!state.usdKrw) return;
  rollNumberByKey("fx:chart", document.getElementById("fxChartPrice"),
    "₩" + fmtRate(state.usdKrw), state.usdKrw);
}

function renderFxDelta(points){
  const sub = document.getElementById("fxChartSub");
  if(!points || points.length < 2){ sub.textContent = ""; sub.className = "fx-sub"; return; }
  const first = points[0].v, last = points[points.length - 1].v;
  const diff = last - first;
  const pct = (diff / first) * 100;
  const label = (FX_RANGES.find(r => r.days === fxDays) || {}).label || "";
  const sign = diff >= 0 ? "+" : "−";
  sub.className = "fx-sub " + (diff >= 0 ? "up" : "down");
  sub.textContent = `${label} ${sign}${fmtRate(Math.abs(diff))}원 (${sign}${Math.abs(pct).toFixed(2)}%)`;
}

// ---------- 기간 버튼 ----------
function renderFxRangeOpts(){
  const row = document.getElementById("fxRangeOpts");
  if(row.childElementCount) return; // 한 번만 만든다
  row.innerHTML = FX_RANGES.map(r =>
    `<div class="opt${r.days === fxDays ? " active" : ""}" data-days="${r.days}">${r.label}</div>`).join("");
  row.addEventListener("click", e => {
    const opt = e.target.closest(".opt");
    if(!opt) return;
    fxDays = Number(opt.dataset.days);
    [...row.children].forEach(el => el.classList.toggle("active", el === opt));
    loadAndDraw(fxDays);
  });
}

// ---------- 데이터 ----------
async function loadAndDraw(days){
  const box = document.getElementById("fxGraph");
  const cached = fxCache[days];
  if(cached){ drawFxChart(cached); return; }

  box.innerHTML = '<div class="loading">환율 추이를 불러오는 중…</div>';
  document.getElementById("fxSrcNote").textContent = "";
  const res = await fetchFxHistory(days);
  if(fxDays !== days) return;     // 불러오는 사이에 다른 기간을 눌렀으면 이 응답은 버린다
  if(!res){
    box.innerHTML = '<div class="loading">환율 추이를 불러오지 못했습니다.<br>네트워크를 확인하고 기간을 다시 눌러주세요.</div>';
    renderFxDelta(null);
    return;
  }
  fxCache[days] = res;
  drawFxChart(res);
}

// ---------- 그리기 ----------
function drawFxChart(res){
  const box = document.getElementById("fxGraph");
  const points = res.points;
  renderFxDelta(points);

  const W = Math.max(240, box.clientWidth || 300);
  const H = 190;
  const padL = 8, padR = 56, padT = 18, padB = 22;   // padR은 오른쪽 최고/최저가 라벨 자리
  const iw = W - padL - padR, ih = H - padT - padB;

  const vals = points.map(p => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if(hi === lo){ hi += 0.5; lo -= 0.5; }             // 값이 전부 같은 극단적 경우 방어
  const head = (hi - lo) * 0.14;                     // 선이 위아래 테두리에 달라붙지 않게 여유
  const top = hi + head, bot = lo - head;

  const xAt = i => padL + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const yAt = v => padT + (1 - (v - bot) / (top - bot)) * ih;

  const xs = points.map((_, i) => xAt(i));
  const ys = points.map(p => yAt(p.v));
  const up = points[points.length - 1].v >= points[0].v;
  const color = up ? "var(--up)" : "var(--down)";

  const line = xs.map((x, i) => (i ? "L" : "M") + x.toFixed(1) + " " + ys[i].toFixed(1)).join(" ");
  const area = `${line} L${xs[xs.length - 1].toFixed(1)} ${(padT + ih).toFixed(1)} L${xs[0].toFixed(1)} ${(padT + ih).toFixed(1)} Z`;

  const gridLine = (v) =>
    `<line class="fx-grid" x1="${padL}" x2="${padL + iw}" y1="${yAt(v).toFixed(1)}" y2="${yAt(v).toFixed(1)}"/>` +
    `<text class="fx-axis" x="${padL + iw + 6}" y="${(yAt(v) + 3.5).toFixed(1)}">${fmtRate(v)}</text>`;

  box.innerHTML = `
    <svg class="fx-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img"
         aria-label="원/달러 환율 추이 그래프">
      <defs>
        <linearGradient id="fxGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.26"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${gridLine(hi)}${gridLine(lo)}
      <path d="${area}" fill="url(#fxGrad)"/>
      <path class="fx-line" d="${line}" stroke="${color}"/>
      <text class="fx-axis" x="${padL}" y="${H - 6}">${points[0].t.slice(2).replace(/-/g, ".")}</text>
      <text class="fx-axis" x="${padL + iw}" y="${H - 6}" text-anchor="end">${points[points.length - 1].t.slice(2).replace(/-/g, ".")}</text>
      <g class="fx-cross" style="display:none">
        <line class="fx-cross-line" y1="${padT}" y2="${padT + ih}"/>
        <circle class="fx-cross-dot" r="3.5" fill="${color}"/>
        <text class="fx-cross-tip"></text>
      </g>
    </svg>`;

  const last = points[points.length - 1];
  document.getElementById("fxSrcNote").textContent =
    `${res.source} · 최근 ${last.t.replace(/-/g, ".")} 종가 ₩${fmtRate(last.v)} (위 숫자는 실시간가)`;

  fxGeom = { points, xs, ys, W, padT, ih, padL, iw };
  bindScrub(box.querySelector(".fx-svg"));
}

// 그래프를 손가락/커서로 훑으면 그 날짜의 종가를 따라다니며 보여준다
function bindScrub(svg){
  if(!svg) return;
  const cross = svg.querySelector(".fx-cross");
  const vline = svg.querySelector(".fx-cross-line");
  const dot = svg.querySelector(".fx-cross-dot");
  const tip = svg.querySelector(".fx-cross-tip");

  const move = (e) => {
    if(!fxGeom) return;
    const r = svg.getBoundingClientRect();
    if(!r.width) return;
    const x = (e.clientX - r.left) * (fxGeom.W / r.width);
    // 등간격이므로 인덱스는 나눗셈 한 번으로 구한다
    const n = fxGeom.points.length;
    let i = Math.round(((x - fxGeom.padL) / (fxGeom.iw || 1)) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));

    const px = fxGeom.xs[i], py = fxGeom.ys[i], p = fxGeom.points[i];
    vline.setAttribute("x1", px); vline.setAttribute("x2", px);
    dot.setAttribute("cx", px); dot.setAttribute("cy", py);
    // 라벨이 오른쪽 끝에서 잘리지 않도록 절반을 넘어가면 왼쪽으로 붙인다
    const rightHalf = px > fxGeom.padL + fxGeom.iw / 2;
    tip.setAttribute("x", rightHalf ? px - 8 : px + 8);
    tip.setAttribute("y", fxGeom.padT - 5);
    tip.setAttribute("text-anchor", rightHalf ? "end" : "start");
    tip.textContent = `${mmdd(p.t)}  ₩${fmtRate(p.v)}`;
    cross.style.display = "";
  };
  const end = () => { cross.style.display = "none"; };

  svg.addEventListener("pointerdown", (e) => { svg.setPointerCapture(e.pointerId); move(e); });
  svg.addEventListener("pointermove", (e) => { if(e.pointerType === "mouse" || e.pressure > 0 || e.buttons) move(e); });
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("pointerleave", end);
  // 그래프를 훑는 동안 화면이 같이 스크롤되지 않게
  svg.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
}

// ---------- 배선 ----------
document.getElementById("fxMini").addEventListener("click", openFxChart);
document.getElementById("fxCloseBtn").addEventListener("click", closeFxChart);

// 화면 회전·창 크기 변경 시 SVG 폭이 바뀌므로 다시 그린다 (캐시된 데이터라 재요청 없음)
let resizeTimer = null;
window.addEventListener("resize", () => {
  if(document.getElementById("fxPanel").style.display !== "block") return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const cached = fxCache[fxDays];
    if(cached) drawFxChart(cached);
  }, 150);
});
