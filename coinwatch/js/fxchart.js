// 헤더의 "원/달러 환율"을 누르면 열리는 추이 그래프.
// 코인 차트(chart.js)는 트레이딩뷰 위젯을 쓰지만, 환율은 일별 종가 몇백 개가 전부라
// 외부 위젯을 하나 더 띄우는 대신 SVG로 직접 그린다 — 테마(다크/라이트)와 글자 크기 설정이
// 그대로 먹고, 추가로 로드할 스크립트도 없다.
import { state } from "./state.js";
import { FX_RANGES } from "./constants.js";
import { fetchFxHistory } from "./api.js";
import { rollNumberByKey } from "./animate.js";
import { skeletonLine } from "./skeleton.js";
import { ensureUsdKrw } from "./fx.js";
import { closeChart } from "./chart.js";

let fxDays = 90;                  // 현재 선택된 기간 (FX_RANGES의 days)
const fxCache = {};               // days -> {source, points} — 같은 기간을 다시 누르면 재요청 없이 즉시 그림
let fxGeom = null;                // 스크럽(손가락/커서로 값 훑기)에 쓰는 마지막 렌더의 좌표 정보

const fmtRate = v => v.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
const p2 = n => String(n).padStart(2, "0");
const intraday = () => fxDays === 1; // 1일 구간만 시:분으로 읽는다

// 축·툴팁 라벨. 하루 안을 보는 1일 구간은 시각이, 긴 구간은 날짜가 필요하다.
function fmtStamp(t, withYear){
  const d = new Date(t * 1000);
  if(intraday()) return p2(d.getHours()) + ":" + p2(d.getMinutes());
  const md = p2(d.getMonth() + 1) + "." + p2(d.getDate());
  return withYear ? p2(d.getFullYear() % 100) + "." + md : md;
}

// ---------- 열고 닫기 ----------
export async function openFxChart(){
  const panel = document.getElementById("fxPanel");
  if(state.selectedCoinId) closeChart(); // 코인 차트와 같은 자리(화면 하단)라 둘이 겹치지 않게 닫는다
  panel.style.display = "block";
  document.body.classList.add("chart-open");
  renderFxRangeOpts();
  await ensureUsdKrw();
  if(state.usdKrw) renderFxPrice(state.usdKrw); // 그래프가 오기 전 잠깐 채워두는 값
  else document.getElementById("fxChartPrice").innerHTML = skeletonLine("5em");
  loadAndDraw(fxDays);
}

export function closeFxChart(){
  document.getElementById("fxPanel").style.display = "none";
  document.body.classList.remove("chart-open");
  fxGeom = null;
}

// 2분마다 도는 환율 갱신(fx.js)에 맞춰, 패널이 열려 있으면 그래프도 다시 받아 그린다.
// 큰 숫자가 그래프의 마지막 점이므로 숫자만 갈아끼울 수는 없다.
export function refreshFxChart(){
  if(document.getElementById("fxPanel").style.display !== "block") return;
  delete fxCache[fxDays];
  loadAndDraw(fxDays, true);
}

// ---------- 패널 상단: 그래프 마지막 값 + 선택 기간 등락 ----------
// 큰 숫자는 그래프에서 읽히는 마지막 점과 같은 값이어야 한다 — 다른 출처의 실시간가를
// 얹으면 선 끝과 숫자가 어긋나 보인다. 데이터가 오기 전에만 헤더의 실시간가를 임시로 띄운다.
function renderFxPrice(v){
  if(!(v > 0)) return;
  rollNumberByKey("fx:chart", document.getElementById("fxChartPrice"), "₩" + fmtRate(v), v);
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
// 들어올 내용과 같은 크기의 자리표시를 깔아둔다. "불러오는 중" 한 줄만 띄우면
// 데이터가 도착할 때 빈 칸이 갑자기 그래프 높이로 벌어져 화면이 튄다.
// 글자 자리 폭은 실제로 들어올 문구 길이에 맞춘 em 값 (--fs를 따라 같이 늘어난다).
function showFxSkeleton(){
  document.getElementById("fxChartSub").innerHTML = skeletonLine("15em");
  document.getElementById("fxGraph").innerHTML    = '<span class="sk sk-graph"></span>';
  document.getElementById("fxSrcNote").innerHTML  = skeletonLine("24em");
}

// quiet: 화면에 이미 그래프가 떠 있는 상태의 배경 갱신. 자리표시로 갈아끼우지 않는다
// (2분마다 도는 자동 갱신에서 그래프가 깜빡이면 안 된다).
async function loadAndDraw(days, quiet){
  const box = document.getElementById("fxGraph");
  const cached = fxCache[days];
  if(cached){ drawFxChart(cached); return; }

  if(!quiet) showFxSkeleton();
  const res = await fetchFxHistory(days);
  if(fxDays !== days) return;     // 불러오는 사이에 다른 기간을 눌렀으면 이 응답은 버린다
  if(!res){
    box.innerHTML = '<div class="loading">환율 추이를 불러오지 못했습니다.<br>네트워크를 확인하고 기간을 다시 눌러주세요.</div>';
    document.getElementById("fxSrcNote").textContent = ""; // 남아 있던 자리표시 정리
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
  // 높이는 CSS(.fx-graph의 min-height)가 정한다 — 넓은 화면에서 차트가 오른쪽에 설 때 더 키우려고.
  // 커스텀 속성을 getComputedStyle로 읽지 않는 이유: 커스텀 속성은 원문 토큰 그대로 돌아와서
  // min()/calc()가 px로 계산되지 않는다. 칸을 비우고 실제 렌더된 높이를 재면 확실하다.
  box.innerHTML = "";
  const H = Math.max(140, Math.round(box.clientHeight) || 190);
  const padL = 8, padR = 56, padT = 18, padB = 22;   // padR은 오른쪽 최고/최저가 라벨 자리
  const iw = W - padL - padR, ih = H - padT - padB;

  const vals = points.map(p => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if(hi === lo){ hi += 0.5; lo -= 0.5; }             // 값이 전부 같은 극단적 경우 방어
  const head = (hi - lo) * 0.14;                     // 선이 위아래 테두리에 달라붙지 않게 여유
  const top = hi + head, bot = lo - head;

  // x는 점 순번이 아니라 시각에 비례해야 한다. 외환시장은 주말마다 50시간 넘게 쉬는데
  // 순번으로 그리면 그 공백이 한 칸으로 뭉개져서 축 날짜와 실제 위치가 어긋난다.
  const t0 = points[0].t, tSpan = (points[points.length - 1].t - t0) || 1;
  const xAt = pt => padL + ((pt.t - t0) / tSpan) * iw;
  const yAt = v => padT + (1 - (v - bot) / (top - bot)) * ih;

  const xs = points.map(xAt);
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
      <text class="fx-axis" x="${padL}" y="${H - 6}">${fmtStamp(points[0].t, true)}</text>
      <text class="fx-axis" x="${padL + iw}" y="${H - 6}" text-anchor="end">${fmtStamp(points[points.length - 1].t, true)}</text>
      <g class="fx-cross" style="display:none">
        <line class="fx-cross-line" y1="${padT}" y2="${padT + ih}"/>
        <circle class="fx-cross-dot" r="3.5" fill="${color}"/>
        <text class="fx-cross-tip"></text>
      </g>
    </svg>`;

  const last = points[points.length - 1];
  renderFxPrice(last.v); // 위의 큰 숫자 = 그래프의 마지막 점
  const d = new Date(last.t * 1000);
  const stamp = `${p2(d.getFullYear() % 100)}.${p2(d.getMonth() + 1)}.${p2(d.getDate())} ` +
                `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  document.getElementById("fxSrcNote").textContent =
    `${res.source} · ${res.interval} 간격 · ${points.length}개 · 최종 ${stamp}`;

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
    // 점 간격이 고르지 않으므로(주말 공백) 가장 가까운 점을 이분 탐색으로 찾는다
    const xs = fxGeom.xs;
    let lo = 0, hi = xs.length - 1;
    while(lo < hi){
      const mid = (lo + hi) >> 1;
      if(xs[mid] < x) lo = mid + 1; else hi = mid;
    }
    let i = lo;
    if(i > 0 && Math.abs(xs[i - 1] - x) < Math.abs(xs[i] - x)) i--;

    const px = fxGeom.xs[i], py = fxGeom.ys[i], p = fxGeom.points[i];
    vline.setAttribute("x1", px); vline.setAttribute("x2", px);
    dot.setAttribute("cx", px); dot.setAttribute("cy", py);
    // 라벨이 오른쪽 끝에서 잘리지 않도록 절반을 넘어가면 왼쪽으로 붙인다
    const rightHalf = px > fxGeom.padL + fxGeom.iw / 2;
    tip.setAttribute("x", rightHalf ? px - 8 : px + 8);
    tip.setAttribute("y", fxGeom.padT - 5);
    tip.setAttribute("text-anchor", rightHalf ? "end" : "start");
    tip.textContent = `${fmtStamp(p.t)}  ₩${fmtRate(p.v)}`;
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

// 그래프 칸의 폭이 바뀌면 SVG를 다시 그린다 (캐시된 데이터라 재요청은 없음).
// window resize가 아니라 칸 자체를 보는 이유: 넓은 화면에서 차트가 오른쪽으로 붙을 때처럼
// 창 크기는 그대로인데 칸 폭만 바뀌는 경우가 있다.
let resizeTimer = null;
let lastBox = "";
new ResizeObserver(entries => {
  const { width, height } = entries[0].contentRect;
  const key = Math.round(width) + "x" + Math.round(height);
  if(width === 0 || key === lastBox) return; // 패널을 닫으면 0이 되는데 그때는 다시 그릴 필요가 없다
  lastBox = key;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const cached = fxCache[fxDays];
    if(cached && document.getElementById("fxPanel").style.display === "block") drawFxChart(cached);
  }, 120);
}).observe(document.getElementById("fxGraph"));
