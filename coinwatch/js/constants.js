// 바이낸스를 1순위 소스로 사용 (키 불필요, 요청 한도가 넉넉하고 CORS 허용).
// 바이낸스 응답이 실패하면 CoinGecko(키 없는 공개 API, 분당 호출 제한 있음)로 자동 대체.
export const BINANCE = "https://api.binance.com/api/v3";
export const GECKO = "https://api.coingecko.com/api/v3";
export const API_BASE = "https://api.namuapplication.cloud"; // Cloudflare Worker 프록시 (CORS + 엣지 캐시)
export const CMC_PROXY = API_BASE + "/cmc/krw";
export const CG_MARKETS_PROXY = API_BASE + "/cg/markets"; // 시총 1~500위 (엣지 캐시 60초)
export const CG_SEARCH_PROXY = API_BASE + "/cg/search";   // 코인 검색 (순위 밖 포함, 엣지 캐시 120초)

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
export const ALIAS_MAP = {
  XRP: ["Ripple"],
  BNB: ["Binance Coin", "Binance"]
};

// range 버튼 값(1/7/30/365) -> 트레이딩뷰 interval/range 매핑
export const TV_RANGE_MAP = {
  1:   { interval: "15",  range: "1D"  },
  7:   { interval: "60",  range: "5D"  },
  30:  { interval: "240", range: "1M"  },
  365: { interval: "D",   range: "12M" }
};

// 차트가 의미 없는(항상 ≈$1) 스테이블코인들 — TradingView에 SYMUSDT 페어가 없어 "Invalid symbol"이 뜬다
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

export const MARKET_PAGE_SIZE = 100; // 1페이지 = 1~100위, 2페이지 = 101~200위 …
export const MAX_PORTFOLIOS = 10;

// 참고: 이 저장 기능은 파일을 다운로드해서 사파리/크롬 등 실제 브라우저로 직접 열었을 때만 동작합니다.
// 클로드 앱/웹 안의 파일 미리보기 화면에서는 브라우저 저장소 접근이 막혀 있어 저장되지 않아요.
export const STORAGE_KEY = "coinwatch_state_v1";
