// 환율 그래프(fxchart.js)와 코인 차트(coinchart.js)가 함께 쓰는 SVG 그래프 조각들.
// 둘은 같은 자리(화면 하단 패널)에 번갈아 뜨므로 모양도 조작감도 같아야 한다.
// 좌표 계산과 스크럽(손가락·커서로 훑어 값 읽기)을 여기 한 곳에 두고 양쪽이 가져다 쓴다.

// 점 사이의 실제 간격. 주말 공백(환율)이나 거래소 점검 공백(코인)에 휘둘리지 않게
// 평균이 아니라 중앙값을 쓴다.
export function medianGap(points){
  const gaps = [];
  for(let i = 1; i < points.length; i++) gaps.push(points[i].t - points[i - 1].t);
  if(gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

// 초 단위 간격 -> "15분" / "4시간" / "1일" 같은 사람이 읽는 표기.
// 어느 거래소에서 받았는지에 따라 실제 봉 간격이 달라지므로, 미리 적어두지 않고
// 받아온 점에서 계산해 출처 줄에 적는다.
export function fmtGap(sec){
  if(!(sec > 0)) return "";
  if(sec < 3600) return Math.round(sec / 60) + "분";
  if(sec < 86400) return Math.round(sec / 3600) + "시간";
  if(sec < 86400 * 7) return Math.round(sec / 86400) + "일";
  return Math.round(sec / (86400 * 7)) + "주";
}

// x좌표 배열에서 주어진 x에 가장 가까운 점의 순번. 점 간격이 고르지 않을 수 있어
// (환율의 주말 공백) 순번 나눗셈이 아니라 이분 탐색으로 찾는다.
export function nearestIndex(xs, x){
  let lo = 0, hi = xs.length - 1;
  while(lo < hi){
    const mid = (lo + hi) >> 1;
    if(xs[mid] < x) lo = mid + 1; else hi = mid;
  }
  if(lo > 0 && Math.abs(xs[lo - 1] - x) < Math.abs(xs[lo] - x)) lo--;
  return lo;
}

// ---------- 눈금 ----------
// 값 범위를 "사람이 읽는 단위"로 끊는다. 200만원·2000달러·0.002달러처럼 1·2·2.5·5의
// 10의 거듭제곱 배수만 쓴다 — 1,873,402원 같은 단위로 선을 그으면 읽을 수가 없다.
// 코인마다 가격대가 천차만별(비트코인 1억, 도지 0.2달러)이라 단위를 미리 정해둘 수 없어서
// 그때그때 보이는 범위에서 계산한다. 확대하면 범위가 좁아지니 단위도 알아서 잘아진다.
export function niceStep(range, target){
  if(!(range > 0) || !(target > 0)) return 0;
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;                                   // 1 ~ 10
  // 1·2·2.5·5·10 중 "가장 가까운" 값으로 간다. 무조건 위로 올리면(2.9 -> 5) 단위가
  // 너무 굵어져서 선이 한두 개밖에 안 남는다 — 경계는 이웃한 두 값의 중간쯤에 둔다.
  const step = norm < 1.5 ? 1 : norm < 2.25 ? 2 : norm < 3.5 ? 2.5 : norm < 7.5 ? 5 : 10;
  return step * mag;
}

// lo~hi 사이에 놓일 눈금 값들. target은 "대충 이 정도 개수"라는 뜻이고,
// 단위를 예쁘게 끊다 보면 실제 개수는 그보다 적거나 많을 수 있다.
export function niceTicks(lo, hi, target){
  const step = niceStep(hi - lo, target);
  if(!(step > 0)) return [];
  const out = [];
  // 부동소수 오차로 마지막 눈금이 빠지는 걸 막으려고 아주 작은 여유를 둔다
  for(let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step){
    out.push(v);
    if(out.length > 40) break; // 방어 (비정상적인 범위에서 무한히 도는 것 방지)
  }
  return out;
}

// 스크럽에 쓰는 십자선 마크업. 그래프 SVG 안에 마지막 요소로 넣는다.
// 세로선은 가장 가까운 점에 달라붙고(그 시점의 값을 읽는 것이므로), 가로선은 손가락·커서가
// 있는 높이를 그대로 따라간다 — 아무 높이에나 대고 "여기가 얼마인지"를 재보려는 선이라
// 점에 붙이면 쓸모가 없다.
export function crossMarkup(color, padT, ih, padL, iw){
  return `<g class="g-cross" style="display:none">
    <line class="g-cross-line" y1="${padT}" y2="${padT + ih}"/>
    <line class="g-cross-hline" x1="${padL}" x2="${padL + iw}"/>
    <circle class="g-cross-dot" r="3.5" fill="${color}"/>
    <text class="g-cross-tip"></text>
    <text class="g-cross-ytip"></text>
  </g>`;
}

// 그래프를 손가락/커서로 훑으면 그 시점의 값을 따라다니며 보여준다.
//   getGeom: 마지막 렌더의 {points, xs, ys, W, padL, padT, iw}를 돌려주는 함수
//            (다시 그릴 때마다 값이 바뀌므로 캡처하지 않고 매번 물어본다)
//   label:   점 하나를 받아 툴팁에 쓸 문자열을 돌려주는 함수
//   opts.busy:   (선택) 참이면 훑기를 쉰다 — 확대/이동 제스처 중에 십자선이 같이
//                따라다니면 손가락이 뭘 하는 중인지 알 수 없어진다
//   opts.yLabel: (선택) 가로선 높이(SVG 좌표)를 받아 오른쪽 축에 적을 값을 돌려주는 함수.
//                없으면 가로선만 긋고 값은 안 적는다
export function bindScrub(svg, getGeom, label, opts){
  if(!svg) return;
  const { busy, yLabel } = opts || {};
  const cross = svg.querySelector(".g-cross");
  const vline = svg.querySelector(".g-cross-line");
  const hline = svg.querySelector(".g-cross-hline");
  const dot = svg.querySelector(".g-cross-dot");
  const tip = svg.querySelector(".g-cross-tip");
  const ytip = svg.querySelector(".g-cross-ytip");
  if(!cross) return;

  const move = (e) => {
    if(busy && busy()){ cross.style.display = "none"; return; }
    const geom = getGeom();
    if(!geom) return;
    const r = svg.getBoundingClientRect();
    if(!r.width) return;
    const x = (e.clientX - r.left) * (geom.W / r.width);
    const i = nearestIndex(geom.xs, x);

    const px = geom.xs[i], py = geom.ys[i];
    vline.setAttribute("x1", px); vline.setAttribute("x2", px);
    dot.setAttribute("cx", px); dot.setAttribute("cy", py);
    // 라벨이 오른쪽 끝에서 잘리지 않도록 절반을 넘어가면 왼쪽으로 붙인다
    const rightHalf = px > geom.padL + geom.iw / 2;
    tip.setAttribute("x", rightHalf ? px - 8 : px + 8);
    tip.setAttribute("y", geom.padT - 5);
    tip.setAttribute("text-anchor", rightHalf ? "end" : "start");
    tip.textContent = label(geom.points[i], i);

    // 가로선 — 커서 높이 그대로. 그래프 칸 밖으로는 안 나가게 가둔다.
    if(hline && geom.H && r.height){
      const raw = (e.clientY - r.top) * (geom.H / r.height);
      const y = Math.max(geom.padT, Math.min(geom.padT + geom.ih, raw));
      hline.setAttribute("y1", y); hline.setAttribute("y2", y);
      if(ytip){
        // 칸 안에 있을 때만 값을 적는다 (위아래로 벗어나면 가둔 자리의 값이라 거짓말이 된다)
        ytip.textContent = (yLabel && raw >= geom.padT && raw <= geom.padT + geom.ih) ? yLabel(y) : "";
        ytip.setAttribute("x", geom.padL + geom.iw + 6);
        ytip.setAttribute("y", y + 3.5);
      }
    }
    cross.style.display = "";
  };
  const end = () => { cross.style.display = "none"; };

  svg.addEventListener("pointerdown", (e) => {
    // 누르자마자 손을 떼면 그 사이 포인터가 사라져 capture가 던진다 — 훑기는 계속돼야 한다
    try{ svg.setPointerCapture(e.pointerId); }catch(err){ /* 붙잡지 못해도 무방 */ }
    move(e);
  });
  svg.addEventListener("pointermove", (e) => { if(e.pointerType === "mouse" || e.pressure > 0 || e.buttons) move(e); });
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("pointerleave", end);
  // 그래프를 훑는 동안 화면이 같이 스크롤되지 않게
  svg.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
}

// ---------- 확대 / 이동 ----------
// 손가락과 마우스에서 기대하는 동작이 서로 달라서 나눠 맡긴다.
//   손가락: 한 손가락은 지금까지처럼 값 훑기, 두 손가락으로 벌리면 확대·같이 밀면 이동
//   마우스: 그냥 올려두면 값 훑기(누를 필요 없음)라 드래그 자리가 비어 있다 -> 드래그는 이동,
//           휠은 커서 자리를 기준으로 확대
// 양쪽 다 두 번 누르면 전체 보기로 돌아온다.
//
// h.zoom(factor, frac) — factor>1이면 확대. frac은 기준점의 가로 위치(0=왼쪽 끝, 1=오른쪽 끝)
// h.pan(frac)          — 보이는 구간을 그 폭의 frac만큼 오른쪽으로 민다(음수면 왼쪽)
// h.reset()            — 전체 보기
// 반환값 busy(): 지금 확대/이동 중인지 (bindScrub에 넘겨 훑기를 쉬게 한다)
export function bindZoomPan(el, h){
  if(!el) return () => false;
  const active = new Map();          // pointerId -> clientX (지금 닿아 있는 손가락)
  let pinchDist = 0, pinchMid = 0;   // 직전 프레임의 두 손가락 간격/중점
  let dragX = null;                  // 마우스 드래그 직전 위치
  let busyUntil = 0;                 // 제스처가 끝난 직후 잠깐은 훑기를 참는다

  const frac = x => {
    const r = el.getBoundingClientRect();
    return r.width ? (x - r.left) / r.width : 0.5;
  };
  const width = () => el.getBoundingClientRect().width || 1;
  const mark = () => { busyUntil = Date.now() + 120; };

  el.addEventListener("wheel", e => {
    e.preventDefault(); // 그래프 위에서는 휠이 화면을 스크롤하지 않고 확대로 쓰인다
    mark();
    // 휠 한 칸(deltaY≈100)에 약 1.17배. 트랙패드의 잘게 쪼개진 값도 같은 식으로 누적된다.
    h.zoom(Math.pow(1.0016, -e.deltaY), frac(e.clientX));
  }, { passive: false });

  el.addEventListener("pointerdown", e => {
    if(e.pointerType === "mouse"){ dragX = e.clientX; return; }
    active.set(e.pointerId, e.clientX);
    if(active.size === 2){ pinchDist = 0; pinchMid = 0; mark(); }
  });

  el.addEventListener("pointermove", e => {
    if(e.pointerType === "mouse"){
      if(dragX === null || !e.buttons) return;
      mark();
      h.pan((dragX - e.clientX) / width()); // 끄는 방향으로 내용이 따라온다
      dragX = e.clientX;
      return;
    }
    if(!active.has(e.pointerId)) return;
    active.set(e.pointerId, e.clientX);
    if(active.size !== 2) return;
    mark();
    const [a, b] = [...active.values()];
    const dist = Math.abs(a - b), mid = (a + b) / 2;
    // 첫 프레임은 기준만 잡는다 (비교할 직전 값이 없다)
    if(pinchDist > 0 && dist > 0){
      h.zoom(dist / pinchDist, frac(mid));
      h.pan((pinchMid - mid) / width()); // 벌리면서 같이 밀면 이동도 함께
    }
    pinchDist = dist; pinchMid = mid;
  });

  const lift = e => {
    if(e.pointerType === "mouse"){ dragX = null; return; }
    active.delete(e.pointerId);
    if(active.size < 2){ pinchDist = 0; pinchMid = 0; }
  };
  el.addEventListener("pointerup", lift);
  el.addEventListener("pointercancel", lift);
  el.addEventListener("pointerleave", e => { if(e.pointerType === "mouse") dragX = null; });
  el.addEventListener("dblclick", e => { e.preventDefault(); mark(); h.reset(); });

  return () => active.size >= 2 || dragX !== null || Date.now() < busyUntil;
}
