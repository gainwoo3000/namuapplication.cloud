import { state } from "./state.js";

export function fmtPrice(n){
  if(n === null || n === undefined || isNaN(n)) return "-";
  if(n >= 1000) return "$" + n.toLocaleString(undefined,{maximumFractionDigits:0});
  if(n >= 1) return "$" + n.toLocaleString(undefined,{maximumFractionDigits:2});
  return "$" + n.toLocaleString(undefined,{maximumFractionDigits:6});
}
export function fmtKrw(n){
  if(n === null || n === undefined || isNaN(n)) return "-";
  return "₩" + Math.round(n).toLocaleString();
}
export function fmtChg(n){
  if(n === null || n === undefined || isNaN(n)) return "-";
  if(Math.abs(n) < 0.005) return "0.00%"; // 0.00%로 표시되는 값엔 +/- 안 붙임
  const s = n>0? "+":"";
  return s + n.toFixed(2) + "%";
}
// 등락률 색상 클래스: 0.00%로 표시되는 값(|n|<0.005)은 회색(flat), 그 외 초록/빨강
export function chgClass(n){
  if(n === null || n === undefined || isNaN(n)) return "flat";
  if(Math.abs(n) < 0.005) return "flat";
  return n > 0 ? "up" : "down";
}

// "가격(USD)" 컬럼 표시값: displayCurrency에 따라 USD 그대로 또는 KRW로 환산해서 보여줌
export function displayPriceNum(usdVal){
  if(usdVal === null || usdVal === undefined || isNaN(usdVal)) return null;
  if(state.displayCurrency === "krw"){
    if(!state.usdKrw) return null;
    return usdVal * state.usdKrw;
  }
  return usdVal;
}
export function fmtDisplayPrice(usdVal){
  const v = displayPriceNum(usdVal);
  if(v === null) return "-";
  return state.displayCurrency === "krw" ? fmtKrw(v) : fmtPrice(v);
}
// 시세 탭 가격 셀의 보조(회색) 줄: 주 통화(설정) 반대편 통화를 함께 보여줌 (원화 병기용)
export function priceSubText(usdVal){
  if(usdVal === null || usdVal === undefined || isNaN(usdVal)) return "";
  if(state.displayCurrency === "krw") return fmtPrice(usdVal);
  return state.usdKrw ? fmtKrw(usdVal * state.usdKrw) : "";
}
// "나의 거래소" 컬럼 표시값: displayCurrency에 따라 KRW 그대로 또는 USD로 환산해서 보여줌
export function displayMyxNum(krwVal){
  if(krwVal === null || krwVal === undefined || isNaN(krwVal)) return null;
  if(state.displayCurrency === "usd"){
    if(!state.usdKrw) return null;
    return krwVal / state.usdKrw;
  }
  return krwVal;
}
export function fmtDisplayMyx(krwVal){
  const v = displayMyxNum(krwVal);
  if(v === null) return "-";
  return state.displayCurrency === "usd" ? fmtPrice(v) : fmtKrw(v);
}
