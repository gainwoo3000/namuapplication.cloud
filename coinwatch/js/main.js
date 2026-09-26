import { state } from "./state.js";
import { loadFromGecko, loadFromBinance, fetchCmcKrw } from "./api.js";
import { enrichIntlPrices, enrichDomesticPrices, applyExchangeTickers } from "./pricing.js";
import { buildCoinsList, renderGrid, findCoinAnywhere } from "./watchlist.js";
import { renderMarketGrid } from "./market.js";
import { renderPortfolio } from "./portfolio.js";
import { updateChartPrice, openCoinFromHash } from "./chart.js";
import { ensureUsdKrw, refreshUsdKrw, renderFxMini } from "./fx.js";
import { loadFearGreed } from "./fng.js";
import { loadState, applyLoadedUIState, requestPersistentStorage } from "./persist.js";
import { restartRefreshTimer, renderStorageDiag } from "./settings.js";
import "./layout.js";
import "./swipe.js"; // 좌우 스와이프로 탭 넘기기

// 이 모듈들은 자기 파일 안에서 이벤트 리스너를 등록하는 부수효과를 가지므로
// import만으로 화면 배선이 끝난다. 서로 순환 참조하지만 실제 호출은
// 전부 함수 본문 안(이벤트 콜백 등)에서 일어나므로 로드 순서 문제는 없다.
import "./chart.js";
import "./fxchart.js"; // 헤더 환율 버튼 -> 원/달러 추이 그래프

// 글자 복사 막기. CSS(user-select:none)로 선택을 막아도 전체 선택(Cmd+A) 뒤 복사 같은 길이
// 남아 있어서 복사 자체도 막는다. 입력칸 안의 글자는 사용자가 친 것이라 그대로 둔다.
["copy", "cut"].forEach(type => document.addEventListener(type, e => {
  if(e.target.closest && e.target.closest("input, textarea")) return;
  e.preventDefault();
}));

// 거래소별 시세(exUsd/domestic)를 보강할 대상. 관심 코인뿐 아니라 모든 포트폴리오의
// 보유 코인도 포함해야 한다 — 이 값이 없으면 포트폴리오 가치가 "-"로 나온다.
// 거래소 API는 전체 티커를 한 번에 받아오는 방식이라 대상이 늘어도 요청 수는 그대로다.
function coinsToEnrich(){
  const ids = new Set(state.watchlist);
  state.portfolios.forEach(p => p.holdings.forEach(h => ids.add(h.id)));
  return [...ids].map(id => findCoinAnywhere(id)).filter(Boolean);
}

export async function loadMarkets(){
  try{
    let list = await loadFromGecko();
    state.allTickers = list;
    state.lastSource = "gecko";
  }catch(e1){
    // 이미 시총 순위 기준 목록을 갖고 있는데 이번 갱신만 실패한 거라면,
    // 순위 산정 기준이 완전히 다른 바이낸스 거래대금 순위로 화면이 바뀌지 않도록
    // (예: 스테이블코인 간 차익거래로 거래대금이 늘 최상위인 USDC가 잠깐 1위로 보임)
    // 이번 갱신은 건너뛰고 기존 목록을 유지한 채 다음 주기에 다시 시도한다.
    if(state.allTickers.length > 0) return;
    try{
      state.allTickers = await loadFromBinance();
      state.lastSource = "binance";
    }catch(e2){
      document.getElementById("gridWrap").innerHTML =
        '<div class="loading">시세를 불러오지 못했습니다.<br>(' + e1.message + ' / ' + e2.message + ')<br>네트워크 연결을 확인하고 아래 버튼을 눌러주세요.</div>' +
        '<button class="more-btn" id="marketsRetryBtn" style="margin-top:0;">다시 시도</button>';
      document.getElementById("marketsRetryBtn").addEventListener("click", loadMarkets);
      return;
    }
  }
  // allTickers는 매번 새로 받아오므로, 검색으로 추가한 시총 500위 밖 코인은 여기서 다시 합쳐줌
  Object.values(state.virtualCoins).forEach(v=>{
    if(!state.allTickers.find(c=>c.id===v.id)) state.allTickers.push(v);
  });
  // 최초 로드 시에는 시총 상위 8개를 기본 관심 코인으로 지정
  if(state.watchlist.length === 0){
    state.watchlist = state.allTickers.slice(0,8).map(c=>c.id);
  }
  state.coinsList = buildCoinsList(); // 우선 캐시된 값(있다면)으로 즉시 렌더
  renderGrid();
  renderMarketGrid();
  document.getElementById("updatedAt").textContent = "업데이트: " + new Date().toLocaleTimeString() + (state.lastSource==="binance" ? " (대체 소스)":"");
  // 시세 목록의 가격·등락률·고저가를 거래소 실시간 값으로 덮어쓴 뒤 다시 그림
  // (CoinGecko는 순위·이름만 담당 → 워커 캐시를 길게 잡아도 가격은 실시간)
  if(await applyExchangeTickers(state.allTickers)) renderMarketGrid();
  const targets = coinsToEnrich();
  if(targets.length > 0){
    let enriched = await enrichIntlPrices(targets);
    await ensureUsdKrw();
    enriched = await enrichDomesticPrices(enriched);
    enriched.forEach(c=>{
      state.enrichedCache[c.id] = {
        current_price: c.current_price,
        price_change_percentage_24h: c.price_change_percentage_24h,
        exUsd: c.exUsd,
        baseUsdPrice: c.baseUsdPrice,
        domestic: c.domestic,
        high_24h: c.high_24h,
        low_24h: c.low_24h
      };
    });
    state.coinsList = buildCoinsList();
    renderGrid();
    renderMarketGrid();
  }
  updateChartPrice();
  renderPortfolio();
}

async function loadCmcKrw(){
  try{
    const m = await fetchCmcKrw();
    if(m){
      state.cmcKrwMap = m;
      renderGrid();
    }
  }catch(e){ /* 프록시 실패해도 앱은 계속 (usd×환율 추정으로 폴백) */ }
}

// ---------- 초기화 ----------
loadState();
applyLoadedUIState();
// 저장소를 "함부로 지우지 말 것"으로 표시 요청 — 안드로이드 크롬은 저장공간이 부족하면
// 보호되지 않은 사이트 데이터를 비운다. 요청 결과와 무관하게 앱은 그대로 동작한다.
requestPersistentStorage().then(renderStorageDiag);
// 시세가 도착하기 전에 각 탭에 자리표시를 깔아둔다. 목록이 비어 있으면 각 렌더 함수가
// 알아서 자리표시를 그리므로 그냥 한 번씩 호출하면 된다 — 첫 화면이든, 로딩 중에
// 다른 탭으로 넘어가든 같은 코드가 처리한다.
renderMarketGrid();
renderGrid();
renderPortfolio();
// 자리표시 행들이 높이를 만들어 주므로 임시 높이는 걷는다
document.querySelectorAll(".grid-wrap.is-boot").forEach(el => el.classList.remove("is-boot"));
// 첫 목록이 오면, 주소로 코인 페이지(#coin/<id>)가 열려 있었는지 본다
loadMarkets().then(openCoinFromHash);
loadFearGreed();
ensureUsdKrw().then(renderFxMini);
// 탭이 안 보일 때는 건너뛴다 (시세 갱신은 settings.js에서 같은 이유로 멈춤)
setInterval(()=>{ if(!document.hidden) refreshUsdKrw(); }, 120000); // 2분마다 환율 갱신
loadCmcKrw();
setInterval(()=>{ if(!document.hidden) loadCmcKrw(); }, 600000);
restartRefreshTimer();
