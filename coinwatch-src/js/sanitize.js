// ---------- 바깥에서 들어온 글자 다듬기 ----------
// 코인 이름·심볼은 화면에 HTML로 끼워 넣어 그리는 곳이 많다(목록·포트폴리오·배분 차트…).
// 그 값은 전부 바깥에서 온다 — CoinGecko 검색(누구나 아무 이름으로 토큰을 올릴 수 있다),
// 백업 코드(남에게 받은 것일 수 있다), 사용자가 친 포트폴리오 이름, 그리고 그걸 저장해 둔 localStorage.
// 그리는 곳마다 이스케이프하는 대신 들어오는 입구에서 한 번 다듬는다. 입구는 이 파일의 함수를 부른다.
//
// DOM이나 state에 기대지 않는 순수 함수만 둔다 — node --test로 바로 돌릴 수 있게.

// 태그·속성을 열 수 있는 글자(< > " ' `)와 제어 문자를 걷어 내고 앞뒤 공백을 자른다.
// &는 그대로 둔다 — 혼자서는 태그를 열 수 없고, "Wrapped A&B" 같은 실제 이름이 있다.
//
// 눈에 안 보이는 문자도 걷는다. 스크립트를 돌리지는 못하지만 보이는 글자를 속인다 —
// 방향 뒤집기(U+202E)로 "abc(U+202E)txt"가 거꾸로 보이게 하거나, 폭 없는 문자로 같아 보이는 다른 이름을 만들거나,
// 한글 채움 문자(U+3164 등)로 빈 이름을 "글자가 있는" 이름처럼 통과시킨다.
//   \p{Cf}: 서식 문자 전부(방향 제어·폭 없는 공백·BOM·소프트 하이픈·태그 문자…)
//           단 U+200D(ZWJ)는 남긴다 — 가족 이모지 같은 이모지가 이걸로 이어져 있다
//   U+2028/2029: 줄·문단 구분자, U+115F/1160/3164/FFA0: 한글 채움 문자
const INVISIBLE = /(?!\u200d)\p{Cf}|[\u2028\u2029\u115f\u1160\u3164\uffa0]/gu;

export function cleanText(s, max = 80){
  if(s == null) return "";
  return String(s)
    .replace(INVISIBLE, "")
    .replace(/[<>"'`\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

// 심볼은 글자·숫자와 . _ - 만. 거래소 주소(https://…/BTC_USDT)와 표의 data-id에도 들어간다.
// 한자·한글 심볼 토큰도 있어서 영문만 남기지는 않는다(\p{L}).
export function cleanSym(s, max = 20){
  if(s == null) return "";
  return String(s).replace(/[^\p{L}\p{N}._-]/gu, "").slice(0, max);
}

// 코인 id = 심볼(대문자) + "USDT". 같은 규칙으로 다듬는다.
export function cleanId(s){
  return cleanSym(s, 40);
}

// 로고 주소는 https만. 따옴표·꺾쇠가 섞인 주소는 <img src="…">를 깨고 나올 수 있어서 통째로 버린다.
export function cleanImage(u){
  if(typeof u !== "string" || u.length > 500 || /[\s<>"'`]/.test(u)) return null;
  return /^https:\/\//i.test(u) ? u : null;
}

// 유한한 수만 통과시킨다. "12abc"(parseFloat가 12로 읽는 것)·"1e400"(Infinity)·빈 문자열은 null.
export function parseNum(s){
  if(typeof s === "number") return Number.isFinite(s) ? s : null;
  if(typeof s !== "string") return null;
  const t = s.replace(/,/g, "").trim();
  if(!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// "YYYY-MM-DD" 모양이고 실제로 있는 날짜만. 아니면 null.
export function cleanDate(s){
  if(typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? s : null;
}
