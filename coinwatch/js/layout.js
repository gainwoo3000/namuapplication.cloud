// 고정된 헤더+탭(.topbar) 높이를 측정해 --topbar-h로 저장.
// 시세 탭 코인 검색창이 이 값을 top으로 써서 헤더 바로 아래에 붙어 고정된다.
// 환율/공포탐욕 지수가 로드되며 헤더 높이가 바뀌거나 화면 폭이 바뀌어도 자동으로 갱신됨.
const topbar = document.querySelector(".topbar");
if(topbar){
  const sync = () => {
    // 소수점 높이를 올림하면 헤더와 검색창 사이로 뒤 목록이 1px 비쳐 틈처럼 보이므로 내림.
    // 살짝 파고들어도 헤더(z-index 50)가 검색창(40) 위라 가려진다.
    const h = Math.floor(topbar.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--topbar-h", h + "px");
  };
  new ResizeObserver(sync).observe(topbar);
  sync();
}

// ---------- 스크롤에 따라 헤더 숨김/복귀 ----------
// 아래로 내리면 헤더(+탭)가 같이 위로 올라가 사라지고, 조금이라도 위로 올리면 다시 내려온다.
// 시세 탭 검색창은 헤더가 사라진 만큼 같이 올라가 화면 맨 위에 붙는다(같은 --topbar-shift를 씀).
const HIDE_AFTER = 80; // 이만큼 내려가기 전에는 항상 보여준다 (맨 위에서는 안 숨김)
const MIN_DELTA = 4;   // 스크롤이 이보다 작게 움직이면 방향 판단을 하지 않는다

let lastY = Math.max(0, window.scrollY);
let hidden = false;

function setHidden(v){
  if(v === hidden) return;
  hidden = v;
  document.body.classList.toggle("topbar-hidden", v);
}

window.addEventListener("scroll", ()=>{
  const y = Math.max(0, window.scrollY);
  const dy = y - lastY;
  if(Math.abs(dy) < MIN_DELTA) return;
  setHidden(y > HIDE_AFTER && dy > 0);
  lastY = y;
}, { passive: true });

// 탭을 바꾸며 스크롤 위치를 되돌릴 때처럼 화면이 한 번에 건너뛰는 경우.
// 그냥 두면 "아래로 많이 내린 것"으로 읽혀 방금 누른 탭이 바로 숨어버린다.
export function revealTopbar(){
  lastY = Math.max(0, window.scrollY);
  setHidden(false);
}
