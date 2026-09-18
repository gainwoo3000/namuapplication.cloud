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
