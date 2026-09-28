// 등락률 아래에 그리는 "24시간 최저가 —●— 최고가" 범위 바.
// 왼쪽 끝 = 24시간 최저가, 오른쪽 끝 = 최고가, 점 = 그 사이 현재가의 위치.
// 시세 탭과 관심 코인 탭이 같은 마크업을 쓰도록 한 곳에 모아둔다.

// 24시간 구간에서 현재가의 위치(0~100). 데이터가 없거나 구간 폭이 0이면 null.
export function range24hPct(c){
  const lo = c.low_24h, hi = c.high_24h, cur = c.current_price;
  if(lo == null || hi == null || cur == null) return null;
  if(isNaN(lo) || isNaN(hi) || isNaN(cur) || !(hi > lo)) return null;
  const pct = ((cur - lo) / (hi - lo)) * 100;
  // 현재가(거래소 평균)와 고저가(단일 소스)의 출처가 달라 구간을 살짝 벗어날 수 있어 양 끝으로 고정
  return Math.max(0, Math.min(100, pct));
}

// 데이터가 없을 땐 숨기되(visibility) 자리는 남겨서 행 높이가 들쭉날쭉해지지 않게 한다.
export function rangeBarHtml(c){
  const pct = range24hPct(c);
  return `<span class="range-bar${pct === null ? " is-empty" : ""}"><span class="range-dot" style="left:${pct === null ? 50 : pct}%"></span></span>`;
}

// 목록을 다시 그리지 않고 점 위치만 갱신 (CSS transition으로 부드럽게 이동)
export function syncRangeBar(rowEl, c){
  const bar = rowEl.querySelector(".range-bar");
  if(!bar) return;
  const pct = range24hPct(c);
  bar.classList.toggle("is-empty", pct === null);
  const dot = bar.querySelector(".range-dot");
  if(dot) dot.style.left = (pct === null ? 50 : pct) + "%";
}
