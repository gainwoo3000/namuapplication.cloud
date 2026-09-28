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
  // border-box로 봐야 한다 — 노치 여백(padding-top)만 바뀌는 경우(기기 회전 등)
  // content-box 기준으로는 크기가 안 바뀐 것으로 보여 갱신이 안 된다.
  new ResizeObserver(sync).observe(topbar, { box: "border-box" });
  window.addEventListener("resize", sync);
  window.addEventListener("orientationchange", ()=> setTimeout(sync, 200));
  sync();
}

// 시세 탭 검색창 높이를 --search-h로. 시세 표 머리줄이 그 아래에 붙는다(.grid-wrap.market .grid-head).
// 붙어 있을 때 검색창은 --topbar-h부터 자기 높이(위 여백 10px 포함)만큼 차지하므로 그 아래가 머리줄 자리다.
const search = document.querySelector(".market-search");
if(search){
  const syncSearch = () => {
    if(!search.offsetParent) return; // 다른 탭이라 숨어 있으면 0으로 재지 않게
    const h = Math.floor(search.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--search-h", h + "px");
  };
  new ResizeObserver(syncSearch).observe(search, { box: "border-box" });
  syncSearch();
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

// ---------- 헤더 지수 띠: 넘치면 전광판처럼 흘려보내기 ----------
// 세 칸(환율·공포탐욕·시총)이 띠 폭에 다 들어가면 가만히 두고, 넘치면(좁은 화면·큰 글자)
// 묶음을 하나 복제해 이어 붙이고 트랙을 천천히 왼쪽으로 흘린다(CSS .marquee).
// 값이 바뀌면(fx.js/fng.js/mcap.js가 원본을 고친다) 복제본도 다시 떠서 똑같이 보이게 한다.
const MARQUEE_SPEED = 25; // px/초 — 천천히
const strip = document.getElementById("tickerStrip");
const group = document.getElementById("tkGroup");
if(strip && group){
  const track = group.parentElement;
  let clone = null, queued = false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // 칸들을 붙여 놓았을 때의 폭 (다 들어갈 땐 space-between으로 벌어져 있어 그대로 재면 안 된다)
  const naturalWidth = () => {
    let w = 32; // 가만히 있을 때의 좌우 여백 16px × 2
    for(const el of group.children){
      if(el.offsetWidth === 0) continue; // 못 받아서 숨긴 칸
      const cs = getComputedStyle(el);
      w += el.offsetWidth + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight);
    }
    return w;
  };

  const makeClone = () => {
    const c = group.cloneNode(true);
    c.removeAttribute("id");
    c.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
    c.setAttribute("aria-hidden", "true");
    c.querySelectorAll("button").forEach(b => b.tabIndex = -1);
    return c;
  };

  const sync = () => {
    queued = false;
    const need = !reducedMotion.matches && naturalWidth() > strip.clientWidth + 1;
    if(!need){
      if(clone){ clone.remove(); clone = null; }
      strip.classList.remove("marquee");
      return;
    }
    strip.classList.add("marquee");
    const fresh = makeClone();
    if(clone) clone.replaceWith(fresh); else track.appendChild(fresh);
    clone = fresh;
    const dist = group.offsetWidth; // 한 묶음 폭(뒤 여백·이음매 구분선 포함) — 이만큼 밀면 복제본이 제자리에 온다
    track.style.setProperty("--tk-dist", dist + "px");
    track.style.setProperty("--tk-dur", (dist / MARQUEE_SPEED).toFixed(1) + "s");
  };
  const schedule = () => { if(!queued){ queued = true; requestAnimationFrame(sync); } };

  // 원본 값이 바뀔 때(글자·자리표시·숨김)마다 다시 잰다. 복제본을 바꾸는 건 group 밖이라 다시 불리지 않는다.
  new MutationObserver(schedule).observe(group, { subtree: true, childList: true, characterData: true, attributes: true });
  new ResizeObserver(schedule).observe(strip);
  reducedMotion.addEventListener && reducedMotion.addEventListener("change", schedule);
  // 흐르는 복제본의 환율 칸을 눌러도 추이 그래프가 열리게 원본을 대신 누른다
  track.addEventListener("click", e => {
    if(clone && clone.contains(e.target) && e.target.closest(".fx-mini-btn")){
      const fx = document.getElementById("fxMini");
      if(fx && !fx.disabled) fx.click();
    }
  });
  schedule();
}
