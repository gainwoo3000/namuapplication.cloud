// 화면 여러 곳(모듈 여러 개)에서 함께 읽고 쓰는 전역 상태.
// ES 모듈에서는 다른 파일이 import한 let 바인딩을 재할당할 수 없기 때문에,
// 재할당이 필요한 값은 전부 이 객체의 속성으로 모아두고 state.xxx 형태로 접근한다.
export const state = {
  coinsList: [],       // 현재 화면에 표시되는 관심 코인 목록(최대 30개)
  allTickers: [],       // 검색/추가용 전체 마켓 풀
  watchlist: [],       // 사용자가 선택한 코인 id 목록 (순서 유지)
  editMode: false,      // 삭제 버튼 표시 여부
  visibleCount: 8,
  selectedCoinId: null,
  intlExchangeFilter: new Set(), // 빈 값 = 5개 해외 거래소 전체 평균, 값이 있으면 그것들만 평균
  refreshSec: 30,
  currentDays: 1,        // 코인 차트 기간 버튼 (COIN_RANGES의 days)
  chartStyle: "line",    // 코인 차트 모양: "line" | "candle" (설정과 함께 저장된다)
  showVolume: true,      // 코인 차트 아래 거래량 막대 (차트 도구줄에서 켜고 끈다, 저장된다)
  refreshTimer: null,
  usdKrw: null,
  usdKrwPrev: null,      // 원/달러 전일 종가 (헤더 띠의 등락률용, 워커 /fx/rate가 줄 때만)
  lastSource: "binance",
  myExchanges: new Set(["upbit","bithumb"]), // "나의 거래소" 평균에 포함할 국내 거래소
  displayCurrency: "usd", // "usd" | "krw" - 나의 거래소/가격 컬럼 표시 통화
  fontScale: 1,           // 글자 크기 배율 (CSS --fs). 1 | 1.12 | 1.24
  krakenPairMap: null,    // 심볼 -> 크라켄 페어 키 (최초 1회 캐싱)
  enrichedCache: {},      // id -> 마지막으로 보강된 가격/등락률/거래소별 시세
  virtualCoins: {},       // id -> 검색으로 추가한, 시총 500위 밖이라 기본 풀에 없는 코인(새로고침에도 유지)
  cmcKrwMap: {},          // 심볼(대문자) -> KRW. CoinMarketCap(프록시 경유) — 국내 거래소에 없는 코인 메꿈용
  marketExtraCoins: new Map(), // 시세 탭 검색으로만 찾은(시총 500위 밖) 코인 임시 보관소 — 저장/영구 목록에는 넣지 않음
  rowAnimating: false,    // 코인 행 삭제 애니메이션 중에는 목록 재렌더를 잠깐 멈춤
  portfolios: [ { name:"포트폴리오 1", holdings:[], exchanges:["upbit"] } ], // {name, holdings:[{id,symbol,name,amount}], exchanges:[...]}
  activePortfolioIdx: 0,
  pfSortMode: "added" // 보유 코인 표시 순서: "added"(추가순) | "asc"(금액 오름차순) | "desc"(내림차순)
};
