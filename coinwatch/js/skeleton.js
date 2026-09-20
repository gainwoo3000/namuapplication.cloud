// 로딩 중 자리표시(스켈레톤). 들어올 내용과 같은 크기의 네모를 깔아두면
// 데이터가 도착할 때 화면이 튀지 않는다. 빛이 훑고 지나가는 건 CSS(.sk)가 맡는다.
//
// 표 자리표시는 진짜 행과 같은 .grid-row를 쓴다 — 열 너비·여백·행 높이가 전부
// 기존 CSS에서 나오므로, 표 모양이 바뀌어도 자리표시가 따로 어긋나지 않는다.

// 표 한 행에서 각 칸에 들어갈 바의 폭(칸 너비 대비 %).
// 첫 칸은 로고 + 이름/심볼 두 줄로 고정이고, 나머지 칸은 오른쪽 정렬이다.
const GRID_SPEC = {
  market:    [[70, 46], [78, 62], [66, 78]],              // 코인 / 가격 / 등락률
  ticker:    [[70, 46], [80, 58], [80, 58], [66, 78]],    // 코인 / 나의 거래소 / 시세 기준 / 등락률
  portfolio: [[70, 46], [72], [82]]                        // 코인 / 보유 수량 / 평가 금액
};

// 행마다 폭을 조금씩 흔들어 실제 목록처럼 보이게. 난수가 아니라 고정 배열이라
// 다시 그려도 같은 모양이 나온다(깜빡이며 길이가 바뀌면 그게 더 눈에 띈다).
const JITTER = [0, -9, 7, -4, 11, -6, 3, -11, 5, -2];

export function skeletonRows(kind, count){
  const spec = GRID_SPEC[kind];
  if(!spec) return "";
  let html = "";
  for(let r = 0; r < count; r++){
    const j = JITTER[r % JITTER.length];
    html += '<div class="grid-row sk-row" aria-hidden="true">';
    spec.forEach((widths, col)=>{
      const bars = widths
        .map((w, i)=> `<span class="sk sk-line" style="width:${Math.max(22, Math.min(96, w + (i ? j / 2 : j)))}%"></span>`)
        .join("");
      html += col === 0
        ? `<div class="coin-cell"><span class="sk sk-logo"></span><div class="sk-stack">${bars}</div></div>`
        : `<div class="sk-stack sk-stack-r">${bars}</div>`;
    });
    html += "</div>";
  }
  return html;
}

// 글자 한 줄 자리. width는 CSS 길이 문자열("15em", "60%" 등)
export function skeletonLine(width){
  return `<span class="sk sk-line" style="width:${width}"></span>`;
}
