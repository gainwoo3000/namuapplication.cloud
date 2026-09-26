// 코인을 누르면 뜨는 차트. 예전에는 트레이딩뷰 위젯(iframe)을 그대로 띄웠는데,
// iframe 안은 다른 문서라 이 앱의 설정이 하나도 넘어가지 않았다 —
// 라이트 테마로 바꿔도 차트 칸만 시커멓고, 글자 크기(--fs)를 키워도 축 글자는 그대로고,
// 표시 통화를 원화로 놔도 차트는 USDT였다.
// 그래서 환율 그래프(fxchart.js)와 같은 방식으로 SVG에 직접 그린다. 지표·드로잉툴이
// 필요한 사람을 위해 "상세" 버튼으로 여는 트레이딩뷰는 chart.js에 그대로 남겨뒀다.
import { state } from "./state.js";
import { COIN_RANGES, CANDLE_SOURCE_LABEL, STABLECOINS } from "./constants.js";
import { fetchCoinCandles } from "./api.js";
import { fmtPrice, fmtKrw } from "./format.js";
import { prevValues, rollNumberByKey, flashOnChange } from "./animate.js";
import { skeletonLine } from "./skeleton.js";
import { medianGap, fmtGap, niceTicks, crossMarkup, bindScrub, bindZoomPan } from "./graph.js";
import { saveState } from "./persist.js";

let coin = null;                 // 지금 그려져 있는 코인
const cache = {};                // "<코인id>:<기간>" -> fetchCoinCandles 결과
let geom = null;                 // 스크럽에 쓰는 마지막 렌더의 좌표 정보
let loadSeq = 0;                 // 응답이 뒤늦게 도착했을 때 버리기 위한 순번

// 확대해서 보고 있는 구간. 전체 캔들 배열에 대한 순번이고, 확대가 부드럽게 이어지도록
// 소수를 허용한다. null이면 전체 보기.
let view = null;
const MIN_SPAN = 7;              // 이보다 더 좁게는 못 줄인다 (봉 8개)

const p2 = n => String(n).padStart(2, "0");

// 축·툴팁 라벨. 하루 안을 보는 1일 구간은 시각이, 긴 구간은 날짜가 필요하다.
function fmtStamp(t, full){
  const d = new Date(t * 1000);
  const hm = p2(d.getHours()) + ":" + p2(d.getMinutes());
  const md = p2(d.getMonth() + 1) + "." + p2(d.getDate());
  if(state.currentDays === 1) return full ? md + " " + hm : hm;
  if(state.currentDays <= 30) return full ? md + " " + hm : md;
  return p2(d.getFullYear() % 100) + "." + md;
}

// ---------- 통화 환산 ----------
// 캔들은 거래소에 따라 USDT(≈USD) 또는 원화로 온다. 설정된 표시 통화로 맞춰 그리되,
// 환율을 아직 못 받았으면 억지로 환산하지 않고 받아온 통화 그대로 그린다
// (0으로 나누거나 엉뚱한 값을 그리느니 통화를 밝히는 편이 낫다).
function converter(quote){
  const want = state.displayCurrency === "krw" ? "KRW" : "USD";
  if(quote === want) return { cur: want, fn: v => v };
  const rate = state.usdKrw;
  if(!(rate > 0)) return { cur: quote, fn: v => v };
  return quote === "USD"
    ? { cur: "KRW", fn: v => v * rate }
    : { cur: "USD", fn: v => v / rate };
}
const fmtCur = (v, cur) => cur === "KRW" ? fmtKrw(v) : fmtPrice(v);

// ---------- 열고 닫기 ----------
export function openCoinChart(c){
  coin = c;
  geom = null;
  view = null; // 다른 코인을 열면 확대는 풀고 시작한다
  renderRangeOpts();
  renderStyleToggle();
  loadAndDraw();
}

export function closeCoinChart(){
  coin = null;
  geom = null;
  view = null;
  loadSeq++; // 닫는 사이에 도착할 응답은 버린다
  scrubPos = null;
  document.getElementById("coinGraph").innerHTML = "";
  syncResetBtn();
}

// 30초 주기 시세 갱신에 맞춰 다시 그린다. 보통은 마지막 봉의 종가만 현재가로 갈아끼우면
// 되므로 네트워크 요청이 없다. 다만 봉 하나가 지날 만큼 시간이 흐르면 새 봉이 생겼다는
// 뜻이라 그때만 다시 받아온다 — 안 그러면 오래 켜둔 화면에서 선 끝만 움직이고
// 그래프는 과거에 멈춰 있게 된다. (30초마다 다시 받으면 거래소 쪽에 과하다)
export function refreshCoinChart(){
  if(!coin) return;
  const entry = cache[key()];
  if(!entry) return;
  coin = state.coinsList.find(x => x.id === coin.id) || coin;
  const stale = Date.now() - entry.at > Math.max(medianGap(entry.candles) * 1000 / 2, 60000);
  if(stale){ delete cache[key()]; loadAndDraw(true); return; }
  draw(entry);
}

const key = () => coin.id + ":" + state.currentDays;

// ---------- 기간 버튼 / 라인·캔들 토글 ----------
function renderRangeOpts(){
  const row = document.getElementById("coinRangeOpts");
  if(!row.childElementCount){
    row.innerHTML = COIN_RANGES.map(r =>
      `<div class="opt" data-days="${r.days}">${r.label}</div>`).join("");
    row.addEventListener("click", e => {
      const opt = e.target.closest(".opt");
      if(!opt) return;
      state.currentDays = Number(opt.dataset.days);
      view = null; // 기간을 바꾸면 확대도 푼다
      markActive(row, "days", state.currentDays);
      loadAndDraw();
    });
  }
  markActive(row, "days", state.currentDays);
}

function renderStyleToggle(){
  const box = document.getElementById("coinStyleToggle");
  if(!box.childElementCount){
    box.innerHTML =
      `<button class="st-btn" data-style="line" aria-label="라인 차트">
         <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 12l4-5 3 3 3-6 4 4"/></svg>
       </button>
       <button class="st-btn" data-style="candle" aria-label="캔들 차트">
         <svg viewBox="0 0 16 16" aria-hidden="true">
           <path d="M5 2v12M11 2v12"/><rect x="3" y="5" width="4" height="6"/><rect x="9" y="4" width="4" height="7"/>
         </svg>
       </button>`;
    box.addEventListener("click", e => {
      const btn = e.target.closest(".st-btn");
      if(!btn || btn.dataset.style === state.chartStyle) return;
      state.chartStyle = btn.dataset.style;
      markActive(box, "style", state.chartStyle);
      saveState(); // 다음에 열어도 고른 모양 그대로
      const cached = cache[key()];
      if(cached) draw(cached);
    });
  }
  markActive(box, "style", state.chartStyle);
}

function markActive(row, attr, value){
  [...row.children].forEach(el => el.classList.toggle("active", el.dataset[attr] === String(value)));
}

// ---------- 데이터 ----------
// 들어올 내용과 같은 크기의 자리표시를 깔아둔다 (환율 그래프와 같은 이유 — 데이터가
// 도착할 때 빈 칸이 갑자기 그래프 높이로 벌어지면 화면이 튄다).
function showSkeleton(){
  document.getElementById("chartCoinSub").innerHTML = skeletonLine("9em");
  document.getElementById("coinGraph").innerHTML = '<span class="sk sk-graph"></span>';
  document.getElementById("chartSrcNote").innerHTML = skeletonLine("22em");
}

function message(text, note){
  document.getElementById("coinGraph").innerHTML = `<div class="loading" style="padding:40px 12px;">${text}</div>`;
  document.getElementById("chartSrcNote").textContent = note || "";
  document.getElementById("chartCoinSub").textContent = "";
}

// quiet: 화면에 이미 차트가 떠 있는 상태의 배경 갱신. 자리표시로 갈아끼우지 않는다
// (주기 갱신에서 차트가 깜빡이면 안 된다).
async function loadAndDraw(quiet){
  if(!coin) return;

  // 스테이블코인은 어느 기간을 봐도 ≈$1에 납작하게 붙는다 — 그릴 값이 없다
  if(!coin.tvSymbol && STABLECOINS.has(coin.symbol.toUpperCase())){
    message("스테이블코인이라 가격이 항상 ≈ $1 — 시세 차트를 생략했어요.", "가격 기준: 스테이블코인 (달러 페그)");
    return;
  }

  const cached = cache[key()];
  if(cached){ draw(cached); return; }

  const seq = ++loadSeq;
  const asked = key();
  if(!quiet) showSkeleton();
  const res = await fetchCoinCandles(coin, state.currentDays);
  if(seq !== loadSeq || !coin || asked !== key()) return; // 그 사이 코인·기간이 바뀌었으면 버린다
  if(!res){
    // 배경 갱신이 실패했을 뿐이면 화면에 떠 있는 차트를 지우지 않는다
    if(!quiet) message("이 코인의 차트를 불러오지 못했습니다.<br>거래소에 상장되지 않았거나 기간 데이터가 없을 수 있어요.");
    return;
  }
  res.at = Date.now();
  cache[asked] = res;
  draw(res);
}

// ---------- 점 만들기 ----------
// 마지막 봉은 아직 진행 중이다. 시세 탭이 30초마다 받아오는 현재가를 그 봉의 종가로
// 덮어써서 "차트 끝 = 패널 위 큰 숫자"가 되게 한다 (환율 그래프의 withLivePoint와 같은 원칙).
// 현재가가 마지막 봉과 5% 넘게 벌어지면(=출처가 어긋났거나 값이 이상하면) 손대지 않는다.
function withLivePrice(candles, conv){
  const out = candles.map(k => ({ t: k.t, o: conv.fn(k.o), h: conv.fn(k.h), l: conv.fn(k.l), c: conv.fn(k.c) }));
  const last = out[out.length - 1];
  // 현재가는 늘 USD 기준(coinsList)이라 표시 통화로 맞춰준다
  const live = conv.cur === "KRW"
    ? (state.usdKrw > 0 ? coin.current_price * state.usdKrw : null)
    : coin.current_price;
  if(!(live > 0) || !last || Math.abs(live - last.c) / last.c > 0.05) return out;
  last.c = live;
  last.h = Math.max(last.h, live);
  last.l = Math.min(last.l, live);
  last.live = true;
  return out;
}

// ---------- 확대 / 이동 ----------
// 보이는 구간을 순번으로 들고 있다가 그릴 때마다 그만큼만 잘라 쓴다.
// 세로 범위도 보이는 점들만으로 다시 잡으므로, 확대하면 그 구간의 오르내림이 크게 펼쳐진다.
function totalPoints(){
  const e = coin && cache[key()];
  return e ? e.candles.length : 0;
}

function setView(i0, i1){
  const n = totalPoints();
  const span = i1 - i0;
  if(!n || span >= n - 1 - 1e-6){ view = null; }   // 전체를 덮으면 확대 해제로 친다
  else{
    if(i0 < 0){ i0 = 0; i1 = span; }
    if(i1 > n - 1){ i1 = n - 1; i0 = i1 - span; }
    view = { i0, i1 };
  }
  syncResetBtn();
  scheduleDraw();
}

function zoomView(factor, frac){
  const n = totalPoints();
  if(!n || !(factor > 0)) return;
  const { i0, i1 } = view || { i0: 0, i1: n - 1 };
  const span = i1 - i0;
  const next = Math.max(MIN_SPAN, Math.min(n - 1, span / factor));
  if(Math.abs(next - span) < 1e-9) return;
  const anchor = i0 + span * frac;               // 손가락(커서)이 짚은 지점은 제자리에 둔다
  const start = anchor - (anchor - i0) * (next / span);
  setView(start, start + next);
}

function panView(frac){
  if(!view) return;                              // 전체 보기에서는 밀 데가 없다
  const span = view.i1 - view.i0;
  setView(view.i0 + span * frac, view.i1 + span * frac);
}

export function resetZoom(){
  if(!view) return;
  view = null;
  syncResetBtn();
  scheduleDraw();
}

function syncResetBtn(){
  const btn = document.getElementById("coinZoomReset");
  if(btn) btn.hidden = !view;
}

// 제스처가 도는 동안은 프레임마다 다시 그리게 되므로 rAF로 한 프레임에 한 번만 그린다.
let rafId = null, gesturing = false;
function scheduleDraw(){
  if(rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    const e = coin && cache[key()];
    if(e){ gesturing = true; draw(e); gesturing = false; }
  });
}

// 확대·이동은 SVG가 아니라 그 바깥 칸에 붙인다. SVG는 다시 그릴 때마다 통째로 갈아끼워지는데,
// 거기에 붙이면 제스처 도중에 리스너와 그 상태(닿아 있는 손가락 목록)가 매 프레임 날아간다.
const graphBox = document.getElementById("coinGraph");
// 꾹 누르기 훑기: 십자선 조종기는 SVG마다 새로 생기므로(draw 끝에서 bindScrub) 최신 것을 들고 있고,
// 훑는 중에 시세 갱신으로 다시 그려지면 새 SVG에서 같은 자리에 십자선을 다시 띄운다.
let scrubCtl = null;
let scrubPos = null;             // 꾹 누르기 훑기 중인 십자선 위치(화면 좌표). 아니면 null
const gestureBusy = bindZoomPan(graphBox, {
  zoom: zoomView,
  pan: panView,
  reset: resetZoom,
  scrubAt(x, y){ scrubPos = { x, y }; if(scrubCtl) scrubCtl.at(x, y); },
  scrubEnd(){ scrubPos = null; if(scrubCtl) scrubCtl.hide(); }
});
document.getElementById("coinZoomReset").addEventListener("click", resetZoom);

// ---------- 그리기 ----------
// 칸 높이는 CSS(--coin-graph-h)가 정한다. 커스텀 속성을 getComputedStyle로 읽으면 min()/calc()가
// 풀리지 않은 원문으로 돌아오므로 실제 렌더된 높이를 재야 하는데, 그러려면 칸을 한 번 비워야 한다.
// 확대 제스처 중에 매 프레임 그러면 레이아웃이 계속 다시 잡히므로 한 번 재서 들고 있다가
// 칸 크기가 바뀔 때(ResizeObserver)만 다시 잰다.
let measuredH = 0;
function graphHeight(box){
  if(!measuredH){
    box.innerHTML = "";
    measuredH = Math.max(160, Math.round(box.clientHeight) || 240);
  }
  return measuredH;
}

// 그 가격대에서 화면에 실제로 드러나는 최소 단위. fmtKrw는 1원 이상이면 정수로,
// fmtPrice는 1000달러 이상이면 정수·1달러 이상이면 센트까지만 보여준다.
function displayUnit(v, cur){
  if(cur === "KRW") return v >= 1 ? 1 : 1e-6;
  if(v >= 1000) return 1;
  if(v >= 1) return 0.01;
  return 1e-6;
}

// 눈금 값과 라벨. 단위를 예쁘게 끊는 것만으로는 부족하고 두 가지를 더 본다:
//   겹침 — 표시 자릿수가 눈금 간격보다 굵으면 이웃한 두 선에 같은 숫자가 적힌다
//   어긋남 — 표시 단위의 배수가 아니면 라벨 간격이 들쭉날쭉해진다.
//            예: 2.5원 단위인데 원화는 정수로 반올림되니 133·135·138·140·143이 된다
// 개수를 목표 근처에서 위아래로 흔들어보고, 둘 다 통과하는 것 중 목표에 가장 가까운 걸 쓴다.
function ticksFor(bot, top, target, cur){
  const unit = displayUnit(Math.max(Math.abs(top), Math.abs(bot)), cur);
  const seen = new Set();
  let best = null, fallback = null;
  for(let t = 2; t <= target + 3; t++){
    const values = niceTicks(bot, top, t);
    if(values.length < 2) continue;
    const step = values[1] - values[0];
    if(seen.has(step)) continue;          // 다른 목표치가 같은 단위로 수렴하면 한 번만 본다
    seen.add(step);
    const labels = values.map(v => fmtCur(v, cur));
    if(new Set(labels).size !== labels.length) continue;
    if(!fallback) fallback = { values, labels };
    if(Math.abs(step / unit - Math.round(step / unit)) > 1e-6) continue;
    // 목표 개수에 가까운 쪽. 같은 거리면 촘촘한 쪽 — 선이 둘뿐인 그래프는 없느니만 못하다
    const miss = Math.abs(values.length - target);
    if(!best || miss < best.miss || (miss === best.miss && values.length > best.values.length)){
      best = { values, labels, miss };
    }
  }
  return best || fallback || { values: [], labels: [] };
}

// 소수 순번 위치의 시각 (확대 경계가 봉 사이에 걸칠 때 쓴다)
function tAtIndex(all, f){
  const a = Math.max(0, Math.min(all.length - 1, Math.floor(f)));
  const b = Math.min(all.length - 1, a + 1);
  return all[a].t + (all[b].t - all[a].t) * (f - a);
}

function draw(res){
  const box = document.getElementById("coinGraph");
  const conv = converter(res.quote);
  const all = withLivePrice(res.candles, conv);
  const n = all.length;
  const { i0, i1 } = view || { i0: 0, i1: n - 1 };
  const span = i1 - i0;

  // 세로 범위와 등락은 "보이는 점"만으로 잡는다
  const vis = all.slice(Math.max(0, Math.round(i0)), Math.min(n, Math.round(i1) + 1));
  if(vis.length < 2) return;
  // 실제로 그릴 점은 양옆으로 한 점씩 더 — 선이 가장자리까지 닿아야 잘린 티가 안 난다
  const ds = Math.max(0, Math.floor(i0) - 1), de = Math.min(n - 1, Math.ceil(i1) + 1);
  const pts = all.slice(ds, de + 1);

  renderDelta(vis, conv.cur);
  renderPrice(vis[vis.length - 1].c, conv.cur);

  const W = Math.max(240, box.clientWidth || 300);
  const H = graphHeight(box);

  const candle = state.chartStyle === "candle";
  const lows  = candle ? vis.map(p => p.l) : vis.map(p => p.c);
  const highs = candle ? vis.map(p => p.h) : vis.map(p => p.c);
  let lo = Math.min(...lows), hi = Math.max(...highs);
  if(!(hi > lo)){ hi = hi * 1.001 || 1; lo = lo * 0.999 || 0; } // 값이 전부 같은 극단적 경우 방어
  const head = (hi - lo) * 0.12;                                // 선이 위아래 테두리에 달라붙지 않게 여유
  const top = hi + head, bot = lo - head;

  const padL = 8, padT = 18, padB = 22;
  const ih = H - padT - padB;
  // 눈금은 일정한 단위(200만원, 2천달러, 0.002달러…)로 끊는다. 개수는 칸 높이에 맞춰
  // 52px마다 하나 꼴 — 칸이 작아도 최소 네 줄은 긋는다(한두 줄이면 없느니만 못하다).
  const { values: ticks, labels } = ticksFor(bot, top, Math.max(4, Math.round(ih / 52)), conv.cur);
  // 오른쪽 눈금 라벨 자리는 실제 글자 길이에서 뽑는다 — 원화로 보면 "₩118,950,177"처럼
  // 길어져서 고정 폭으로는 잘린다.
  const widest = labels.reduce((m, s) => Math.max(m, s.length), 6);
  const padR = Math.min(104, Math.max(46, 12 + widest * 5.9));
  const iw = W - padL - padR;
  const yAt = v => padT + (1 - (v - bot) / (top - bot)) * ih;

  // 캔들은 봉마다 같은 폭을 차지해야 하므로 순번으로 자리를 나누고,
  // 선은 환율 그래프처럼 시각에 비례해 놓는다(중간에 빠진 구간이 한 칸으로 뭉개지지 않게).
  const tStart = tAtIndex(all, i0), tEnd = tAtIndex(all, i1);
  const tSpan = (tEnd - tStart) || 1;
  const xs = candle
    ? pts.map((p, k) => padL + ((ds + k - i0) / span) * iw)
    : pts.map(p => padL + ((p.t - tStart) / tSpan) * iw);
  const ys = pts.map(p => yAt(p.c));

  const upward = vis[vis.length - 1].c >= vis[0].c;
  const color = upward ? "var(--up)" : "var(--down)";

  const grid = ticks.map((v, k) =>
    `<line class="g-grid" x1="${padL}" x2="${padL + iw}" y1="${yAt(v).toFixed(1)}" y2="${yAt(v).toFixed(1)}"/>` +
    `<text class="g-axis" x="${padL + iw + 6}" y="${(yAt(v) + 3.5).toFixed(1)}">${labels[k]}</text>`
  ).join("");

  box.innerHTML = `
    <svg class="g-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img"
         aria-label="${coin.name} 시세 차트">
      <defs>
        <linearGradient id="ccGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.26"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
        <!-- 확대하면 가장자리 바깥의 봉·선이 눈금 자리까지 삐져나오므로 잘라낸다 -->
        <clipPath id="ccClip"><rect x="${padL}" y="${padT}" width="${iw}" height="${ih}"/></clipPath>
      </defs>
      ${grid}
      <g clip-path="url(#ccClip)">
        ${candle ? candleMarkup(pts, xs, yAt, iw / (span + 1)) : lineMarkup(xs, ys, color, padT, ih)}
      </g>
      <text class="g-axis" x="${padL}" y="${H - 6}">${fmtStamp(vis[0].t)}</text>
      <text class="g-axis" x="${padL + iw}" y="${H - 6}" text-anchor="end">${fmtStamp(vis[vis.length - 1].t)}</text>
      ${crossMarkup(color, padT, ih, padL, iw)}
    </svg>`;

  renderSrcNote(res, all, vis, conv.cur);

  geom = { points: pts, xs, ys, W, H, padL, padT, iw, ih };
  scrubCtl = bindScrub(box.querySelector(".g-svg"), () => geom,
    p => `${fmtStamp(p.t, true)}  ${fmtCur(p.c, conv.cur)}`,
    {
      busy: gestureBusy,
      mouseOnly: true, // 손가락은 bindZoomPan이 맡는다 (한 손가락=이동, 꾹 누르기=훑기)
      // 가로선 높이 -> 그 높이의 가격. yAt의 역산이다.
      yLabel: y => fmtCur(bot + (1 - (y - padT) / ih) * (top - bot), conv.cur)
    });
  if(scrubPos) scrubCtl.at(scrubPos.x, scrubPos.y);
}

function lineMarkup(xs, ys, color, padT, ih){
  const line = xs.map((x, i) => (i ? "L" : "M") + x.toFixed(1) + " " + ys[i].toFixed(1)).join(" ");
  const floor = (padT + ih).toFixed(1);
  const area = `${line} L${xs[xs.length - 1].toFixed(1)} ${floor} L${xs[0].toFixed(1)} ${floor} Z`;
  return `<path d="${area}" fill="url(#ccGrad)"/><path class="g-line" d="${line}" stroke="${color}"/>`;
}

// 봉 하나 = 심지(고가~저가) + 몸통(시가~종가). 종가가 시가보다 높으면 --up, 아니면 --down.
// 폭이 1px 밑으로 내려가면 몸통이 사라지므로 최소 1px은 준다(1년 365봉을 좁은 폰에서 보면 여기 걸린다).
function candleMarkup(pts, xs, yAt, slot){
  const bw = Math.max(1, Math.min(slot * 0.66, 14));
  return pts.map((p, i) => {
    const x = xs[i];
    const rising = p.c >= p.o;
    const cls = rising ? "g-cd up" : "g-cd down";
    const yo = yAt(p.o), yc = yAt(p.c);
    const bodyY = Math.min(yo, yc);
    const bodyH = Math.max(1, Math.abs(yo - yc)); // 시가=종가(보합)면 납작한 선 한 줄
    return `<line class="g-wick ${rising ? "up" : "down"}" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" ` +
           `y1="${yAt(p.h).toFixed(1)}" y2="${yAt(p.l).toFixed(1)}"/>` +
           `<rect class="${cls}" x="${(x - bw / 2).toFixed(1)}" y="${bodyY.toFixed(1)}" ` +
           `width="${bw.toFixed(1)}" height="${bodyH.toFixed(1)}"/>`;
  }).join("");
}

// ---------- 패널 위쪽 숫자 / 아래쪽 출처 줄 ----------
// 큰 숫자는 차트에서 읽히는 마지막 값과 같아야 한다 — 다른 출처의 값을 얹으면
// 선 끝과 숫자가 어긋나 보인다 (환율 그래프와 같은 규칙). 확대해서 과거를 보고 있으면
// 그 구간의 마지막 값이 되고, 전체 보기로 돌아오면 다시 현재가가 된다.
function renderPrice(v, cur){
  const el = document.getElementById("chartCoinPrice");
  // 제스처 중에는 자릿수 굴리기를 쉰다 — 미는 동안 매 프레임 숫자가 크게 바뀌는데
  // 그걸 한 자리씩 굴리면 읽히지도 않고 프레임만 잡아먹는다.
  if(gesturing){
    el.innerHTML = '<span class="roll-cur">' + fmtCur(v, cur) + '</span>';
    prevValues["chart:price"] = v;
    return;
  }
  rollNumberByKey("chart:price", el, fmtCur(v, cur), v);
  // 현재가가 바뀌면 올랐으면 초록, 내렸으면 빨강으로 배경이 번쩍 (등락률 칸과 같은 방식).
  // 확대해서 과거 구간을 보는 중에는 숫자가 현재가가 아니라 그 구간의 끝값이라 건너뛴다.
  // 기간도 키에 넣는다 — 기간마다 캔들 출처(거래소)가 달라 바꾸는 순간 값이 조금 달라질 수 있다.
  if(!view) flashOnChange(el.parentElement, key() + ":" + cur, fmtCur(v, cur), v);
}

function renderDelta(vis, cur){
  const sub = document.getElementById("chartCoinSub");
  if(!vis || vis.length < 2){ sub.textContent = ""; sub.className = "panel-sub"; return; }
  const first = vis[0].c, last = vis[vis.length - 1].c;
  const diff = last - first;
  const pct = (diff / first) * 100;
  // 확대 중이면 기간 버튼 이름("1개월")이 실제 보이는 구간과 다르다 — 보이는 날짜를 적는다
  const label = view
    ? `${fmtStamp(vis[0].t)}~${fmtStamp(vis[vis.length - 1].t)}`
    : ((COIN_RANGES.find(r => r.days === state.currentDays) || {}).label || "");
  const sign = diff >= 0 ? "+" : "−";
  sub.className = "panel-sub " + (diff >= 0 ? "up" : "down");
  // 부호는 통화 기호 앞에 — "+$248.70", "−₩511,080"
  sub.textContent = `${label} ${sign}${fmtCur(Math.abs(diff), cur)} (${sign}${Math.abs(pct).toFixed(2)}%)`;
}

function renderSrcNote(res, all, vis, cur){
  const last = all[all.length - 1];
  const d = new Date(last.t * 1000);
  const stamp = `${p2(d.getMonth() + 1)}.${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const gap = fmtGap(medianGap(all));
  const src = CANDLE_SOURCE_LABEL[res.source] || res.source;
  // 받아온 통화와 보여주는 통화가 다르면(환율 환산) 그 사실을 밝힌다
  const converted = (res.quote === "USD") !== (cur === "USD") ? " · 환율 환산" : "";
  const count = view ? `${vis.length}/${all.length}개` : `${all.length}개`;
  document.getElementById("chartSrcNote").textContent =
    `${src} ${coin.symbol.toUpperCase()}${res.quote === "KRW" ? "/KRW" : "/USDT"}${converted}` +
    ` · ${gap} 간격 · ${count} · ${last.live ? "현재가" : "최종"} ${stamp} 기준`;
}

// ---------- 다시 그리기 ----------
// 그래프 칸의 폭/높이가 바뀌면 다시 그린다 (캐시된 데이터라 재요청은 없음).
// window resize가 아니라 칸 자체를 보는 이유: 넓은 화면에서 차트가 오른쪽으로 붙을 때처럼
// 창 크기는 그대로인데 칸 폭만 바뀌는 경우가 있다.
let resizeTimer = null, lastBox = "";
new ResizeObserver(entries => {
  const { width, height } = entries[0].contentRect;
  const k = Math.round(width) + "x" + Math.round(height);
  if(width === 0 || k === lastBox) return; // 패널을 닫으면 0이 되는데 그때는 다시 그릴 필요가 없다
  lastBox = k;
  measuredH = 0;                           // 높이를 다시 재야 한다
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if(coin && cache[key()]) draw(cache[key()]);
  }, 120);
}).observe(graphBox);

// 설정(표시 통화·테마·글자 크기)이 바뀌면 다시 그린다. 트레이딩뷰 iframe과 달리
// 이 차트는 같은 문서라 CSS 변수가 그대로 먹지만, 축 라벨 폭처럼 JS가 계산한 값은
// 다시 재야 한다.
export function redrawCoinChart(){
  if(coin && cache[key()]) draw(cache[key()]);
}
