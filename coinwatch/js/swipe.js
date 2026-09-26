import { TAB_ORDER, currentTabName, activateTab } from "./settings.js";

// 화면을 좌우로 밀어 탭 전환. 왼쪽으로 밀면 다음 탭, 오른쪽으로 밀면 이전 탭.
const MIN_DIST = 55;      // 이만큼은 가로로 움직여야 넘긴다
const OFF_AXIS_MAX = 0.6; // 세로 이동이 가로의 60%를 넘으면 그냥 스크롤로 본다
const MAX_TIME = 700;     // 천천히 끄는 동작(선택·스크롤)은 제외

let sx = 0, sy = 0, startAt = 0, tracking = false;

// 차트(트레이딩뷰는 가로 드래그를 직접 쓴다)·다이얼로그·스크롤되는 검색 결과 위에서는 무시
function blocked(target){
  if(!target || !target.closest) return false;
  return !!(target.closest(".chart-panel") || target.closest(".coin-page") || target.closest(".ticker-strip") || target.closest(".dialog-overlay")
    || target.closest(".drop-panel") || target.closest(".pf-coin-results")
    || target.closest("#addCoinResults"));
}

document.addEventListener("touchstart", (e)=>{
  if(e.touches.length !== 1 || blocked(e.target)){ tracking = false; return; }
  sx = e.touches[0].clientX;
  sy = e.touches[0].clientY;
  startAt = Date.now();
  tracking = true;
}, { passive: true });

// 손가락이 늘어나면(핀치 줌) 넘기지 않는다
document.addEventListener("touchmove", (e)=>{
  if(e.touches.length > 1) tracking = false;
}, { passive: true });

document.addEventListener("touchend", (e)=>{
  if(!tracking) return;
  tracking = false;
  if(Date.now() - startAt > MAX_TIME) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - sx;
  const dy = t.clientY - sy;
  if(Math.abs(dx) < MIN_DIST || Math.abs(dy) > Math.abs(dx) * OFF_AXIS_MAX) return;
  const next = TAB_ORDER.indexOf(currentTabName()) + (dx < 0 ? 1 : -1);
  if(next < 0 || next >= TAB_ORDER.length){
    bounce(dx < 0 ? -1 : 1); // 양 끝에서는 더 넘길 곳이 없다는 표시만
    return;
  }
  activateTab(TAB_ORDER[next]);
}, { passive: true });

function bounce(dir){
  const main = document.querySelector("main");
  if(!main) return;
  main.classList.remove("edge-bounce-left", "edge-bounce-right");
  void main.offsetWidth; // 리플로우로 애니메이션 재시작
  main.classList.add(dir > 0 ? "edge-bounce-right" : "edge-bounce-left");
  clearTimeout(main._bounceTimer);
  main._bounceTimer = setTimeout(()=> main.classList.remove("edge-bounce-left", "edge-bounce-right"), 300);
}
