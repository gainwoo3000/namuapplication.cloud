// ---------- 언어 (설정 › 언어: 한국어 / English) ----------
// 언어는 index.html <head>의 작은 스크립트가 정해서 window.APP_LANG에 넣어 둔다 —
// 화면이 한 번이라도 그려지기 전에 정해야 한국어가 잠깐 비쳤다가 영어로 바뀌는 일이 없다.
// (저장된 설정의 lang → 없으면 예전부터 쓰던 사람은 한국어, 처음 온 사람은 접속 IP의 나라.
//  앱은 그게 정해진 뒤에 시작한다 — boot.js)
//
// 바꾸는 방법은 저장 후 새로고침이다(settings.js). 화면 곳곳의 문구·모듈 맨 위의 상수(기간 버튼 이름 등)를
// 하나하나 다시 그리는 것보다 새로 여는 편이 빠뜨리는 게 없다 — 백업 불러오기와 같은 이유.
//
// 문구는 키 사전 대신 쓰는 자리에 두 언어를 나란히 적는다: t("시세", "Market").
// 한국어 원문이 코드에 그대로 남아서 읽기 쉽고, 한쪽만 고치고 다른 쪽을 빠뜨리기도 어렵다.
// node --test(창 없음)에서는 한국어로 돈다.

export const LANGS = ["ko", "en"];
export const LANG = (typeof window !== "undefined" && LANGS.includes(window.APP_LANG)) ? window.APP_LANG : "ko";
export const IS_EN = LANG === "en";
// 날짜·시각을 글자로 바꿀 때 쓰는 로캘 (브라우저 언어가 아니라 앱 언어를 따른다)
export const LOCALE = IS_EN ? "en-US" : "ko-KR";

export function t(ko, en){ return IS_EN ? en : ko; }

// 큰 수를 영어식(T·B·M·K)으로 줄여 쓴다. 한국어 쪽(조·억·만)은 자리마다 규칙이 달라 각 파일에 그대로 둔다.
// digits: 줄였을 때 소수 자릿수 (값이 크면 0으로 줄여 폭을 아낀다 — 부르는 쪽이 정한다)
export function compactEn(v, digits = 1){
  const a = Math.abs(v);
  const f = (x, d) => x.toLocaleString("en-US", { maximumFractionDigits: d });
  if(a >= 1e12) return f(v / 1e12, digits) + "T";
  if(a >= 1e9)  return f(v / 1e9, digits) + "B";
  if(a >= 1e6)  return f(v / 1e6, digits) + "M";
  if(a >= 1e4)  return f(v / 1e3, digits) + "K";
  return f(v, 0);
}

// index.html의 고정 문구. 영어 문구는 각 요소에 data-en(내용, 태그 포함 가능)·data-en-ph(placeholder)·
// data-en-aria(aria-label)로 적어 두고, 영어일 때만 갈아 끼운다. 한국어는 원래 마크업 그대로.
function applyStatic(){
  document.documentElement.lang = LANG;
  if(!IS_EN) return;
  document.title = "CoinWatchCap — Live Crypto Prices";
  document.querySelectorAll("[data-en]").forEach(el => { el.innerHTML = el.dataset.en; });
  document.querySelectorAll("[data-en-ph]").forEach(el => { el.placeholder = el.dataset.enPh; });
  document.querySelectorAll("[data-en-aria]").forEach(el => { el.setAttribute("aria-label", el.dataset.enAria); });
}

if(typeof document !== "undefined"){
  applyStatic();
  // <head>가 걸어 둔 가림막을 걷는다 (문구를 다 바꾼 뒤에 보이게)
  document.documentElement.removeAttribute("data-i18n-pending");
}
