import { state } from "./state.js";
import { fmtPrice, fmtKrw } from "./format.js";

// ---------- 포트폴리오 거래 기록 ----------
// 포트폴리오는 거래 기록(trades)이 원본이고, 보유 코인(holdings)은 거래 합계로 매번 다시 계산한다.
// holdings를 따로 들고 있는 이유: 시세 보강 대상(main.js)·표 렌더가 예전처럼 holdings만 보면 되게.
//
// 거래 한 건: { tid, id, symbol, name, side:"buy"|"sell", amount, price, cur, date, legacy? }
//   price/cur: 입력한 단가와 그때의 통화("usd"|"krw"). 단가를 비워 두면 둘 다 null.
//              원화로 산 걸 달러로 바꿔 저장하면 환율이 움직일 때마다 입력한 값이 달라 보이므로 입력 통화 그대로 둔다.
//   date: "YYYY-MM-DD". 거래 기록이 생기기 전부터 있던 보유분(legacy)은 날짜를 모르니 null.

const EPS = 1e-12;
let seq = 0;
export function newTid(){ return Date.now().toString(36) + (seq++).toString(36); }

export function todayStr(){
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// 소수 덧셈 찌꺼기(0.30000000000000004) 정리
const tidy = n => parseFloat(n.toPrecision(12));

// 저장된 포트폴리오 → 거래 목록. 거래 기록이 없던 예전 데이터는 보유 수량을 단가 없는 매수로 옮긴다.
export function loadTrades(p){
  if(Array.isArray(p.trades)){
    return p.trades.filter(t => t && t.id && t.amount > 0 && (t.side === "buy" || t.side === "sell"));
  }
  return (Array.isArray(p.holdings) ? p.holdings : [])
    .filter(h => h && h.id && h.amount > 0)
    .map(h => ({ tid: newTid(), id: h.id, symbol: h.symbol, name: h.name, side: "buy",
      amount: h.amount, price: null, cur: null, date: null, legacy: true }));
}

// 보유 코인 = 코인별 (매수 − 매도). 순서는 그 코인의 첫 거래 순서(= 예전의 "추가순")
export function recomputeHoldings(p){
  const map = new Map();
  for(const t of p.trades){
    let h = map.get(t.id);
    if(!h){ h = { id: t.id, symbol: t.symbol, name: t.name, amount: 0 }; map.set(t.id, h); }
    h.amount += t.side === "buy" ? t.amount : -t.amount;
  }
  p.holdings = [...map.values()].filter(h => h.amount > EPS).map(h => ({ ...h, amount: tidy(h.amount) }));
}

export function holdingAmount(trades, id){
  let a = 0;
  for(const t of trades) if(t.id === id) a += t.side === "buy" ? t.amount : -t.amount;
  return tidy(a);
}

// 오래된 순. 날짜 모르는 기존 보유분이 맨 앞, 같은 날은 입력한 순서대로
export function chronological(trades){
  return trades.map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.date || "").localeCompare(b.t.date || "") || a.i - b.i)
    .map(x => x.t);
}

// 거래 기록에 등장한 코인들(첫 거래 순서). 거래 탭의 코인 필터 목록
export function tradedCoins(trades){
  const map = new Map();
  for(const t of trades) if(!map.has(t.id)) map.set(t.id, { id: t.id, symbol: t.symbol, name: t.name });
  return [...map.values()];
}

// 단가를 지금 표시 통화로. 통화가 다르면 현재 환율로 바꾼다(환율을 아직 모르면 null)
export function priceInDisplay(price, cur){
  if(price === null || price === undefined) return null;
  if(cur === state.displayCurrency) return price;
  if(!state.usdKrw) return null;
  return cur === "krw" ? price / state.usdKrw : price * state.usdKrw;
}

export function fmtMoney(v){
  if(v === null || v === undefined || isNaN(v)) return "-";
  return state.displayCurrency === "krw" ? fmtKrw(v) : fmtPrice(v);
}

export function fmtAmount(n){
  return tidy(n).toLocaleString(undefined, { maximumFractionDigits: 8 });
}

// 평균 매수가(표시 통화). 이동평균법: 매수할 때만 평균이 바뀌고, 매도는 평균을 그대로 둔 채 수량만 줄인다.
// 단가 없는 매수는 평균에서 빼되, 매도는 단가 있는 몫과 없는 몫에서 같은 비율로 줄인다.
// partial: 단가 없는 보유분이 남아 있어 평균이 일부 수량만으로 계산됐는지
export function avgBuyPrice(trades, id){
  let qty = 0, pq = 0, cost = 0;
  for(const t of chronological(trades.filter(t => t.id === id))){
    if(t.side === "buy"){
      qty += t.amount;
      const px = priceInDisplay(t.price, t.cur);
      if(px !== null){ pq += t.amount; cost += px * t.amount; }
    }else if(qty > EPS){
      const r = Math.min(t.amount / qty, 1);
      pq -= pq * r; cost -= cost * r; qty -= t.amount;
    }
  }
  if(pq <= EPS) return { avg: null, partial: qty > EPS };
  return { avg: cost / pq, partial: qty - pq > EPS };
}
