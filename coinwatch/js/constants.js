// 바이낸스를 1순위 소스로 사용 (키 불필요, 요청 한도가 넉넉하고 CORS 허용).
// 바이낸스 응답이 실패하면 CoinGecko(키 없는 공개 API, 분당 호출 제한 있음)로 자동 대체.
export const BINANCE = "https://api.binance.com/api/v3";
export const GECKO = "https://api.coingecko.com/api/v3";
export const API_BASE = "https://api.namuapplication.cloud"; // Cloudflare Worker 프록시 (CORS + 엣지 캐시)
export const CMC_PROXY = API_BASE + "/cmc/krw";
export const CG_MARKETS_PROXY = API_BASE + "/cg/markets"; // 시총 1~500위 (엣지 캐시 15분, 가격은 거래소 값으로 덮어씀)
export const CG_SEARCH_PROXY = API_BASE + "/cg/search";   // 코인 검색 (순위 밖 포함, 엣지 캐시 1시간)
export const FX_HISTORY_PROXY = API_BASE + "/fx/history"; // 원/달러 추이 (야후, 엣지 캐시 10분)
export const FX_RATE_PROXY = API_BASE + "/fx/rate";       // 원/달러 현재가 (야후, 엣지 캐시 60초)
export const UPBIT_CANDLES_PROXY = API_BASE + "/upbit/candles"; // 업비트 캔들 (엣지 캐시 60초)

export const EX_LABEL = {binance:"바이낸스", okx:"OKX", bybit:"바이빗", coinbase:"코인베이스", kraken:"크라켄"};

// 상위 종목 표시용 한글/영문 이름 매핑 (없으면 심볼 그대로 표시)
export const NAME_MAP = {
  BTC:"비트코인", ETH:"이더리움", BNB:"바이낸스코인", SOL:"솔라나", XRP:"리플",
  ADA:"에이다", DOGE:"도지코인", TRX:"트론", TON:"톤코인", AVAX:"아발란체",
  DOT:"폴카닷", MATIC:"폴리곤", LINK:"체인링크", LTC:"라이트코인", BCH:"비트코인캐시",
  SHIB:"시바이누", UNI:"유니스왑", ATOM:"코스모스", XLM:"스텔라루멘", ETC:"이더리움클래식",
  NEAR:"니어프로토콜", APT:"앱토스", ARB:"아비트럼", OP:"옵티미즘", FIL:"파일코인",
  SUI:"수이", INJ:"인젝티브", RNDR:"렌더", HBAR:"헤데라", VET:"비체인", ICP:"인터넷컴퓨터"
};

// 코인게코 공식 영문 이름(name 필드)이 실제로 널리 통용되는 영문 이름과 달라서
// enName만으로는 검색이 안 되는 경우의 보충 별칭 (심볼 -> 별칭 배열).
// 예: XRP의 코인게코 name은 "XRP"라서 "ripple"로 검색하면 로컬에서 안 잡힘.
// 한글 통용명도 여기에 넣으면 표시 이름(name)은 그대로 둔 채 검색만 걸린다.
export const ALIAS_MAP = {
  XRP: ["Ripple"],
  BNB: ["Binance Coin", "Binance"],
  USDT: ["테더"],
  USDC: ["유에스디코인", "USD코인"]
};

// 코인 차트의 기간 버튼. days는 라벨용이고, 실제 요청은 거래소마다 규격이 달라서
// 아래 CANDLE_SPEC에 따로 적어둔다.
export const COIN_RANGES = [
  { days: 1,   label: "1일"   },
  { days: 7,   label: "1주"   },
  { days: 30,  label: "1개월" },
  { days: 90,  label: "3개월" },
  { days: 365, label: "1년"   }
];

// 기간 -> 거래소별 봉 규격. 같은 "1개월"이라도 4시간봉을 주는 곳과 6시간봉밖에 없는 곳이
// 있어서, 화면에 적는 "n시간 간격"은 미리 적어두지 않고 받아온 점에서 계산한다(graph.fmtGap).
//   binance/okx/bybit: {i: 봉 크기, n: 개수}
//   upbit:  {p: /candles/ 뒤 경로, n: 개수}  — 한 번에 최대 200개
//   bithumb: {i: 봉 크기, n: 꼬리에서 잘라 쓸 개수} — 전체 이력을 통째로 주므로 잘라서 쓴다
export const CANDLE_SPEC = {
  1:   { binance:{i:"15m",n:96 },  okx:{i:"15m",n:96 },  bybit:{i:"15", n:96 },  upbit:{p:"minutes/15", n:96 },  bithumb:{i:"30m",n:48 } },
  7:   { binance:{i:"1h", n:168},  okx:{i:"1H", n:168},  bybit:{i:"60", n:168},  upbit:{p:"minutes/60", n:168},  bithumb:{i:"1h", n:168} },
  30:  { binance:{i:"4h", n:180},  okx:{i:"4H", n:180},  bybit:{i:"240",n:180},  upbit:{p:"minutes/240",n:180},  bithumb:{i:"6h", n:120} },
  90:  { binance:{i:"12h",n:180},  okx:{i:"12H",n:180},  bybit:{i:"720",n:180},  upbit:{p:"days",       n:90 },  bithumb:{i:"12h",n:180} },
  365: { binance:{i:"1d", n:365},  okx:{i:"1W", n:53 },  bybit:{i:"D",  n:365},  upbit:{p:"weeks",      n:53 },  bithumb:{i:"24h",n:365} }
};

export const CANDLE_SOURCE_LABEL = {
  binance:"바이낸스", okx:"OKX", bybit:"바이빗", upbit:"업비트", bithumb:"빗썸"
};

// "상세" 버튼으로 여는 트레이딩뷰 위젯의 interval/range 매핑 (기간 버튼 값 기준)
export const TV_RANGE_MAP = {
  1:   { interval: "15",  range: "1D"  },
  7:   { interval: "60",  range: "5D"  },
  30:  { interval: "240", range: "1M"  },
  90:  { interval: "720", range: "3M"  },
  365: { interval: "D",   range: "12M" }
};

// 차트가 의미 없는(항상 ≈$1) 스테이블코인들 — 어차피 선이 $1에 납작하게 붙는다
export const STABLECOINS = new Set([
  "USDT","USDC","DAI","USDE","USD1","FDUSD","TUSD","USDD","PYUSD","USDP","GUSD",
  "USDS","BUSD","USDL","USDG","USD0","USDX","USR","LUSD","FRAX","USDB","USDTB","RLUSD","EURC","EURT"
]);

export const FNG_LABEL = {
  "Extreme Fear":"극도의 공포",
  "Fear":"공포",
  "Neutral":"중립",
  "Greed":"탐욕",
  "Extreme Greed":"극도의 탐욕"
};

// 헤더의 환율을 눌렀을 때 뜨는 추이 그래프의 기간 버튼 (일 단위).
// 여기 days는 워커 /fx/history가 아는 값이어야 한다 (다른 값을 보내면 90일로 처리됨).
export const FX_RANGES = [
  { days: 1,   label: "1일"   },
  { days: 30,  label: "1개월" },
  { days: 90,  label: "3개월" },
  { days: 180, label: "6개월" },
  { days: 365, label: "1년"  }
];

// 워커가 돌려주는 source 코드 -> 그래프 아래 출처 줄에 쓸 이름
export const FX_SOURCE_LABEL = {
  yahoo: "야후 파이낸스",
  naver: "네이버 금융"
};

export const MARKET_PAGE_SIZE = 100; // 1페이지 = 1~100위, 2페이지 = 101~200위 …
export const MAX_PORTFOLIOS = 10;

// 참고: 이 저장 기능은 파일을 다운로드해서 사파리/크롬 등 실제 브라우저로 직접 열었을 때만 동작합니다.
// 클로드 앱/웹 안의 파일 미리보기 화면에서는 브라우저 저장소 접근이 막혀 있어 저장되지 않아요.
export const STORAGE_KEY = "coinwatch_state_v1";
