import { currentTabName, fakeRefresh, FAKE_REFRESH_MS } from "./settings.js";

// ---------- 위에서 아래로 당겨서 새로고침 ----------
// 브라우저에 원래 있는 당겨서 새로고침(페이지 전체를 다시 불러옴)은 CSS(overscroll-behavior-y)로 끄고,
// 대신 헤더 새로고침 버튼과 같은 "가짜" 새로고침을 건다 — 홈 화면 웹앱·안드로이드 앱에서도 똑같이 되게.
// 페이지가 맨 위에 있을 때, 탭마다 정해진 영역에서 시작한 당기기만 받는다. 설정 탭은 없음.
const PULL_ZONES = {
  market: "#marketWrap",       // 코인 표만 (검색창 제외)
  ticker: "#gridWrap",         // 관심 코인 표만 (도구줄 제외)
  portfolio: "#view-portfolio" // 헤더 아래 전부
};
// 영역 안이어도 제 스크롤이 있는 목록·펼침 창에서는 당기기로 보지 않는다
const BLOCKED = ".pf-coin-results, .drop-panel, .pop-panel";

const TRIGGER = 64;  // 표시가 이만큼 내려오면(손가락은 그 두 배쯤) 놓았을 때 새로고침
const MAX_PULL = 96; // 표시가 내려오는 한도
const RESIST = 0.5;  // 손가락 이동 대비 표시 이동 — 무겁게 끌리는 느낌

const ind = document.createElement("div");
ind.className = "ptr";
ind.setAttribute("aria-hidden", "true");
ind.innerHTML = '<svg viewBox="0 0 16 16"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/></svg>';
document.body.appendChild(ind);

let sx = 0, sy = 0, pulling = false, tracking = false, busy = false, dist = 0;

function setPull(d){
  dist = d;
  const p = Math.min(d / TRIGGER, 1);
  ind.style.transform = `translate(-50%, ${d}px) rotate(${d * 4}deg)`;
  ind.style.opacity = String(p);
  ind.classList.toggle("ready", d >= TRIGGER);
}

function release(){
  ind.classList.add("settle");
  setPull(0);
  ind.classList.remove("ready");
}

document.addEventListener("touchstart", (e)=>{
  tracking = false;
  if(busy || e.touches.length !== 1 || window.scrollY > 0) return;
  const zone = PULL_ZONES[currentTabName()];
  const t = e.target;
  if(!zone || !t.closest || !t.closest(zone) || t.closest(BLOCKED)) return;
  sx = e.touches[0].clientX;
  sy = e.touches[0].clientY;
  tracking = true;
  pulling = false;
  ind.classList.remove("settle");
}, { passive: true });

document.addEventListener("touchmove", (e)=>{
  if(!tracking) return;
  if(e.touches.length !== 1 || window.scrollY > 0){ tracking = false; if(pulling) release(); return; }
  const dx = e.touches[0].clientX - sx;
  const dy = e.touches[0].clientY - sy;
  if(!pulling){
    if(Math.abs(dx) > Math.abs(dy)){ if(Math.abs(dx) > 10) tracking = false; return; } // 옆으로 밀기(탭 넘기기)
    if(dy < 8) return;
    pulling = true;
  }
  setPull(Math.min(Math.max(0, dy * RESIST), MAX_PULL));
}, { passive: true });

document.addEventListener("touchend", endPull, { passive: true });
document.addEventListener("touchcancel", endPull, { passive: true });

function endPull(){
  if(!tracking) return;
  tracking = false;
  if(!pulling) return;
  pulling = false;
  if(dist < TRIGGER){ release(); return; }
  // 걸렸다: 표시는 걸림 위치에 멈춰 돌고, 목록은 잠깐 자리표시로 → 끝나면 표시가 올라간다
  busy = true;
  ind.classList.add("settle", "spinning");
  ind.style.transform = `translate(-50%, ${TRIGGER}px)`;
  fakeRefresh();
  setTimeout(()=>{
    ind.classList.remove("spinning");
    release();
    busy = false;
  }, FAKE_REFRESH_MS);
}
