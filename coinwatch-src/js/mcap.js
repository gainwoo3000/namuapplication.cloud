import { state } from "./state.js";
import { CG_GLOBAL_PROXY } from "./constants.js";
import { chgClass } from "./format.js";

// ---------- 헤더 지수 띠의 "시총" 칸: 코인 시장 전체 시가총액 ----------
// CoinGecko /global을 워커가 30분 캐시해서 준다. 값은 달러라 표시 통화가 원화면 환율로 바꾼다.
let latest = null; // { mcap, chg }

function fmtTotal(usd){
  if(state.displayCurrency === "krw" && state.usdKrw > 0){
    const krw = usd * state.usdKrw;
    return "₩" + Math.round(krw / 1e12).toLocaleString() + "조";
  }
  return "$" + (usd / 1e12).toFixed(2) + "T";
}

// 표시 통화가 바뀌거나 환율이 새로 오면 받아 둔 값으로 다시 쓴다
export function renderMcapMini(){
  const box = document.getElementById("mcapMini");
  if(!box || !latest) return;
  document.getElementById("mcapVal").textContent = fmtTotal(latest.mcap);
  const chg = document.getElementById("mcapChg");
  if(latest.chg == null){
    chg.textContent = "";
  }else{
    const cls = chgClass(latest.chg);
    // 소수 한 자리 — 시장 전체는 0.0x% 단위까지 볼 일이 없다
    chg.textContent = (cls === "up" ? "▲" : cls === "down" ? "▼" : "") + Math.abs(latest.chg).toFixed(1) + "%";
    chg.className = "tk-chg " + cls;
  }
  box.classList.remove("is-loading");
  box.style.display = "";
}

export async function loadMarketCap(){
  const box = document.getElementById("mcapMini");
  try{
    // 10분 단위 버킷: 브라우저가 옛 응답을 오래 붙들지 않게 (다른 프록시 요청과 같은 이유)
    const r = await fetch(`${CG_GLOBAL_PROXY}?t=${Math.floor(Date.now() / 600000)}`);
    if(!r.ok) throw new Error("global http " + r.status);
    const d = await r.json();
    if(!(d && d.mcap > 0)) throw new Error("global empty");
    latest = { mcap: d.mcap, chg: d.chg };
    renderMcapMini();
  }catch(e){
    // 한 번도 못 받았을 때만 칸을 감춘다. 받아 둔 값이 있으면 그대로 둔다.
    if(!latest && box) box.style.display = "none";
  }
}
