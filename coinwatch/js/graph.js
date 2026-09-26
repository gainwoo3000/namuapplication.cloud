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
//   opts.onPoint: (선택) 십자선이 가리키는 점의 순번이 바뀔 때마다 불린다. 숨길 때는 null.
//                코인 차트가 캔들 정보(최고·최저·시작·마지막) 줄을 바꿔 쓰는 데 쓴다
//   opts.mouseOnly: (선택) 참이면 손가락은 여기서 받지 않는다 — 코인 차트처럼 한 손가락이
//                이동에 쓰이고 훑기는 꾹 눌러야 켜지는 곳. 그때는 bindZoomPan이 돌려받은
//                조종기(at/hide)로 십자선을 움직인다.
// 반환값: { at(clientX, clientY), hide() } — 바깥에서 십자선을 직접 옮기거나 숨기는 조종기
export function bindScrub(svg, getGeom, label, opts){
  const noop = { at(){}, hide(){} };
  if(!svg) return noop;
  const { busy, yLabel, mouseOnly, onPoint } = opts || {};
  const cross = svg.querySelector(".g-cross");
  const vline = svg.querySelector(".g-cross-line");
  const hline = svg.querySelector(".g-cross-hline");
  const dot = svg.querySelector(".g-cross-dot");
  const tip = svg.querySelector(".g-cross-tip");
  const ytip = svg.querySelector(".g-cross-ytip");
  if(!cross) return noop;

  const move = (e, force) => {
    if(!force && busy && busy()){ cross.style.display = "none"; return; }
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
    // 기본은 그래프 칸 바로 위. 그 자리를 다른 걸로 쓰는 그래프는 geom.tipY로 옮긴다
    tip.setAttribute("y", geom.tipY != null ? geom.tipY : geom.padT - 5);
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
    if(onPoint) onPoint(i);
    return i;
  };
  const end = () => {
    cross.style.display = "none";
    if(onPoint) onPoint(null);
  };
  // at()은 가리킨 점의 순번을 돌려준다 — 순번이 바뀔 때마다 톡 진동을 주는 데 쓴다
  const control = { at: (x, y) => move({ clientX: x, clientY: y }, true), hide: end };
  const skip = e => mouseOnly && e.pointerType !== "mouse";

  svg.addEventListener("pointerdown", (e) => {
    if(skip(e)) return;
    // 누르자마자 손을 떼면 그 사이 포인터가 사라져 capture가 던진다 — 훑기는 계속돼야 한다
    try{ svg.setPointerCapture(e.pointerId); }catch(err){ /* 붙잡지 못해도 무방 */ }
    move(e);
  });
  svg.addEventListener("pointermove", (e) => {
    if(skip(e)) return;
    if(e.pointerType === "mouse" || e.pressure > 0 || e.buttons) move(e);
  });
  svg.addEventListener("pointerup", e => { if(!skip(e)) end(); });
  svg.addEventListener("pointercancel", e => { if(!skip(e)) end(); });
  svg.addEventListener("pointerleave", e => { if(!skip(e)) end(); });
  // 그래프를 훑는 동안 화면이 같이 스크롤되지 않게
  svg.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  return control;
}

// ---------- 확대 / 이동 ----------
const PINCH_MIN_DIST = 24;  // 두 손가락 간격이 이보다 좁으면(px) 배율 계산을 쉰다
const LONG_PRESS_MS = 400;  // 이만큼 가만히 누르고 있으면 값 훑기로 들어간다
const TAP_SLOP = 8;         // 누른 뒤 이보다 많이 움직이면(px) 탭·꾹 누르기가 아니라 끌기로 본다
const LIFT_OFFSET = 60;     // 꾹 누르면 십자선을 손가락보다 이만큼(px) 위에 띄운다 — 손가락에 가리지 않게
const PRESS_BUZZ_MS = 35;   // 훑기가 켜질 때 진동 길이 (안드로이드)
// 십자선 세로선이 다음 봉으로 넘어갈 때마다 톡 (안드로이드). 10ms로는 호출은 되는데
// 모터가 다 돌기 전에 끝나 대부분 기기에서 느껴지지 않았다 — 20ms 밑은 쓰지 말 것.
const TICK_BUZZ_MS = 25;
// 톡과 톡 사이 최소 간격. 진동 길이보다 넉넉히 길어야 톡톡이 이어 붙어 "징—"으로 뭉개지지 않는다.
const TICK_GAP_MS = 45;

// 짧은 진동 한 번.
//   안드로이드: navigator.vibrate(ms). (앱 WebView 안에서는 앱에 VIBRATE 권한이 있어야 울린다)
//   iOS: vibrate가 아예 없다. 대신 iOS 18부터 사파리의 스위치형 체크박스(<input switch>)가
//        토글될 때 시스템 햅틱을 울리므로, 숨겨 둔 스위치의 label을 눌러 그 햅틱을 빌려 쓴다.
//        세기는 시스템이 정해서 ms는 무시된다. iOS 17 이하에서는 조용히 아무 일도 안 일어난다.
let hapticLabel = null;
function haptic(ms){
  try{
    if(typeof navigator.vibrate === "function"){ navigator.vibrate(ms); return; }
    if(!hapticLabel){
      hapticLabel = document.createElement("label");
      hapticLabel.setAttribute("aria-hidden", "true");
      hapticLabel.style.cssText = "position:fixed; left:-9999px; top:0; opacity:0; pointer-events:none;";
      const sw = document.createElement("input");
      sw.type = "checkbox";
      sw.setAttribute("switch", "");
      sw.tabIndex = -1;
      hapticLabel.appendChild(sw);
      // 이 클릭이 문서까지 올라가면 "바깥을 누르면 팝업 닫기" 처리기들이 반응한다
      hapticLabel.addEventListener("click", e => e.stopPropagation());
      document.body.appendChild(hapticLabel);
    }
    hapticLabel.click();
  }catch(e){ /* 진동은 덤이다 — 실패해도 훑기는 그대로 */ }
}

// 손가락과 마우스에서 기대하는 동작이 서로 달라서 나눠 맡긴다.
//   손가락: 한 손가락으로 끌면 이동, 두 손가락으로 벌리면 확대(같이 밀면 이동).
//           꾹 누르면(LONG_PRESS_MS) 값 훑기 — 십자선이 손가락보다 조금 위에 뜨고, 그 뒤로는
//           손가락 바로 아래가 아니라 손가락이 움직인 만큼 따라간다(트랙패드처럼).
//           손을 떼도 십자선은 남는다. 그 상태에서 다시 끌면 이동이 아니라 십자선이 이어서
//           움직이고, 제자리에서 톡 치면 십자선이 사라진다(그 뒤로는 다시 끌어서 이동).
//   마우스: 그냥 올려두면 값 훑기(누를 필요 없음, bindScrub이 맡는다) -> 드래그는 이동,
//           휠은 커서 자리를 기준으로 확대
// 양쪽 다 두 번 누르면 전체 보기로 돌아온다.
//
// h.zoom(factor, frac) — factor>1이면 확대. frac은 기준점의 가로 위치(0=왼쪽 끝, 1=오른쪽 끝)
// h.pan(frac)          — 보이는 구간을 그 폭의 frac만큼 오른쪽으로 민다(음수면 왼쪽)
// h.reset()            — 전체 보기
// h.scrubAt(x, y)      — (선택) 십자선을 화면 좌표 (x, y)로. 가리킨 점의 순번을 돌려주면
//                        순번이 바뀔 때마다 톡 진동이 울린다
// h.scrubEnd()         — (선택) 십자선 숨기기
// 반환값 busy(): 지금 확대/이동 중인지 (bindScrub에 넘겨 훑기를 쉬게 한다)
//   busy.release(): 떠 있는 십자선 상태를 버린다 (차트를 닫거나 다른 코인을 열 때)
export function bindZoomPan(el, h){
  if(!el){ const none = () => false; none.release = () => {}; return none; }
  const active = new Map();          // pointerId -> {x, y} (지금 닿아 있는 손가락)
  let pinchDist = 0, pinchMid = 0;   // 직전 프레임의 두 손가락 간격/중점(가로)
  let dragX = null;                  // 마우스 드래그 직전 위치
  let busyUntil = 0;                 // 제스처가 끝난 직후 잠깐은 훑기를 참는다

  // 떠 있는 십자선의 화면 위치. null이면 없음. 손을 떼도 남는다.
  let cur = null;
  let lastIdx = null, lastTickAt = 0;
  // 한 손가락 상태:
  //   "wait"   누른 직후, 끌기인지 꾹 누르기인지 모름 (십자선 없을 때)
  //   "tap"    누른 직후, 끌기인지 탭인지 모름 (십자선 떠 있을 때)
  //   "pan" | "scrub" | "done"(핀치 뒤 남은 손가락 — 무시)
  let one = null;                    // { id, mode, sx, sy, lx, ly, timer }

  const frac = x => {
    const r = el.getBoundingClientRect();
    return r.width ? (x - r.left) / r.width : 0.5;
  };
  const width = () => el.getBoundingClientRect().width || 1;
  const mark = () => { busyUntil = Date.now() + 120; };

  const showAt = (x, y, silent) => {
    const r = el.getBoundingClientRect();
    cur = { x: Math.max(r.left, Math.min(r.right, x)), y: Math.max(r.top, Math.min(r.bottom, y)) };
    const idx = h.scrubAt ? h.scrubAt(cur.x, cur.y) : undefined;
    // 봉 하나를 넘어갈 때마다 톡 — 빠르게 훑으면 또로로록
    if(!silent && idx !== undefined && lastIdx !== null && idx !== lastIdx){
      const now = Date.now();
      if(now - lastTickAt >= TICK_GAP_MS){ lastTickAt = now; haptic(TICK_BUZZ_MS); }
    }
    lastIdx = idx === undefined ? null : idx;
  };
  const hide = () => {
    cur = null; lastIdx = null;
    if(h.scrubEnd) h.scrubEnd();
  };
  const dropOne = () => {
    if(one) clearTimeout(one.timer);
    one = null;
  };

  el.addEventListener("wheel", e => {
    e.preventDefault(); // 그래프 위에서는 휠이 화면을 스크롤하지 않고 확대로 쓰인다
    mark();
    // 휠 한 칸(deltaY≈100)에 약 1.17배. 트랙패드의 잘게 쪼개진 값도 같은 식으로 누적된다.
    h.zoom(Math.pow(1.0016, -e.deltaY), frac(e.clientX));
  }, { passive: false });

  // 꾹 누를 때 뜨는 길게 누르기 메뉴(이미지 저장 등)를 막는다
  el.addEventListener("contextmenu", e => { if(one || active.size) e.preventDefault(); });

  // 누르기는 그래프 칸에서만 받지만, 움직임·떼기는 window에서 받는다.
  // 그래프 칸은 세로로 짧아서 손가락이 금방 칸 밖으로 나가는데,
  // 칸에서만 들으면 밖에서 뗀 손가락을 놓쳐 active에 영영 남는다
  // -> "두 손가락이 닿아 있음"으로 굳어서 확대도 훑기도 안 되는 먹통이 된다.
  el.addEventListener("pointerdown", e => {
    if(e.pointerType === "mouse"){ dragX = e.clientX; return; }
    // 첫 손가락(isPrimary)이면 다른 손가락은 없다 — 혹시 놓친 게 남아 있으면 여기서 비운다
    if(e.isPrimary){ active.clear(); dropOne(); }
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if(active.size === 1){
      const o = one = { id: e.pointerId, mode: cur ? "tap" : "wait",
        sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY };
      if(o.mode === "wait"){
        o.timer = setTimeout(() => {
          if(one !== o || o.mode !== "wait") return;
          o.mode = "scrub";
          haptic(PRESS_BUZZ_MS); // 훑기가 켜진 걸 알린다
          // 손가락 바로 아래가 아니라 조금 위에 띄운다. 위쪽 여백이 모자라면 아래로.
          const r = el.getBoundingClientRect();
          const y = o.ly - LIFT_OFFSET >= r.top ? o.ly - LIFT_OFFSET : o.ly + LIFT_OFFSET;
          showAt(o.lx, y, true);
        }, LONG_PRESS_MS);
      }
    }else if(active.size === 2){
      // 두 번째 손가락이 닿으면 끌기·훑기는 접고 핀치로. 떠 있던 십자선도 걷는다
      // (확대하면 그 자리의 값이 바뀌어 남겨 둬 봐야 엉뚱한 곳을 가리킨다).
      dropOne();
      if(cur) hide();
      one = { id: null, mode: "done" };
      pinchDist = 0; pinchMid = 0; mark();
    }
  });

  window.addEventListener("pointermove", e => {
    if(e.pointerType === "mouse"){
      if(dragX === null || !e.buttons) return;
      mark();
      h.pan((dragX - e.clientX) / width()); // 끄는 방향으로 내용이 따라온다
      dragX = e.clientX;
      return;
    }
    if(!active.has(e.pointerId)) return;
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if(active.size === 1 && one && one.id === e.pointerId){
      const dx = e.clientX - one.lx, dy = e.clientY - one.ly;
      one.lx = e.clientX; one.ly = e.clientY;
      const moved = Math.hypot(e.clientX - one.sx, e.clientY - one.sy) > TAP_SLOP;
      if(one.mode === "wait"){
        if(!moved) return;
        clearTimeout(one.timer);
        one.mode = "pan";
        // 움직였다고 판단하기까지 흘려보낸 거리도 이동에 넣는다 — 안 그러면 처음에 살짝 멈칫한다
        mark();
        h.pan((one.sx - e.clientX) / width());
        return;
      }
      if(one.mode === "tap"){
        if(!moved) return;
        // 십자선이 떠 있을 때 끌면 이동이 아니라 십자선을 이어서 움직인다.
        // 흘려보낸 거리만큼 한 번에 옮겨 멈칫하지 않게.
        one.mode = "scrub";
        showAt(cur.x + (e.clientX - one.sx), cur.y + (e.clientY - one.sy));
        return;
      }
      if(one.mode === "pan"){
        mark();
        h.pan(-dx / width());
        return;
      }
      if(one.mode === "scrub" && cur){
        // 차트는 그대로 두고 십자선만 손가락이 움직인 만큼 옮긴다. 칸 밖으로는 안 나가게 가둔다.
        showAt(cur.x + dx, cur.y + dy);
      }
      return;
    }

    if(active.size !== 2) return;
    mark();
    const [a, b] = [...active.values()];
    // 간격은 가로만이 아니라 실제 거리로 잰다. 가로만 재면 위아래로 벌릴 때 간격이 0~몇 px라
    // 1px만 흔들려도 배율이 몇 배씩 튄다. 어느 방향으로 벌려도 같은 만큼 확대되게.
    const dist = Math.hypot(a.x - b.x, a.y - b.y), mid = (a.x + b.x) / 2;
    // 첫 프레임은 기준만 잡는다 (비교할 직전 값이 없다). 손가락이 거의 겹치면 비율이 불안정해 건너뛴다.
    if(pinchDist >= PINCH_MIN_DIST && dist >= PINCH_MIN_DIST){
      // 한 프레임에 튀는 폭을 묶어 둔다 — 손가락이 잠깐 미끄러져도 화면이 널뛰지 않게
      const factor = Math.max(0.8, Math.min(1.25, dist / pinchDist));
      h.zoom(factor, frac(mid));
      h.pan((pinchMid - mid) / width()); // 벌리면서 같이 밀면 이동도 함께
    }
    pinchDist = dist; pinchMid = mid;
  });

  const lift = e => {
    if(e.pointerType === "mouse"){ dragX = null; return; }
    if(!active.delete(e.pointerId)) return;
    if(active.size < 2){ pinchDist = 0; pinchMid = 0; mark(); }
    if(active.size > 0) return;
    // 십자선이 떠 있을 때 제자리에서 톡 치고 떼면 십자선을 걷는다.
    // 훑다가 뗀 경우(scrub)는 그대로 남긴다.
    if(one && one.mode === "tap" && e.type === "pointerup") hide();
    // 핀치 뒤 남은 한 손가락은 이동으로 이어가지 않는다("done") — 떼는 순간 화면이 튀지 않게
    dropOne();
  };
  window.addEventListener("pointerup", lift);
  window.addEventListener("pointercancel", lift);
  el.addEventListener("dblclick", e => { e.preventDefault(); mark(); h.reset(); });

  const busy = () => active.size >= 2 || dragX !== null || Date.now() < busyUntil
    || !!(one && one.mode === "pan");
  busy.release = () => { dropOne(); cur = null; lastIdx = null; };
  return busy;
}
