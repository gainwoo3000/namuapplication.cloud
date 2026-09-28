import { state } from "./state.js";
import { ALL_DAYS } from "./constants.js";
import { fetchCoinCandles } from "./api.js";

// ---------- 코인 상세 페이지: 코인별 공포·탐욕 + 기간별 기술적 지표 요약 ----------
// 둘 다 거래소 캔들로 직접 계산하는 참고값이다(어디서 받아 오는 지수가 아니다).
//   공포·탐욕(0~100): 일봉 기준 RSI · 90일 범위 속 위치 · 30일 모멘텀 · 변동성 변화 · 거래량 추세의 가중 평균
//   기술적 지표: 이동평균·RSI·MACD·모멘텀·스토캐스틱이 매수(+1)/중립(0)/매도(-1)로 한 표씩 던지고
//                그 평균으로 등급을 매긴다(트레이딩뷰 "기술적 등급"과 같은 방식)
//     단기 = 1시간봉(최근 7일), 중기 = 1일봉(최근 1년), 장기 = 1주봉(상장 이후)
// 코인마다 10분 동안은 다시 계산하지 않는다.

const TIMEFRAMES = [
  { key: "short", days: 7,        label: "단기", sub: "1시간봉" },
  { key: "mid",   days: 365,      label: "중기", sub: "1일봉" },
  { key: "long",  days: ALL_DAYS, label: "장기", sub: "1주봉" },
];
const TTL = 10 * 60 * 1000;
const cache = {}; // 코인 id -> { at, fg, ratings, flat, inflight }

// ---------- 지표 계산 ----------
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sma = (a, n) => mean(a.slice(-n));
function emaSeries(a, n){
  const k = 2 / (n + 1), out = [];
  let e = mean(a.slice(0, n));
  for(let i = 0; i < a.length; i++){
    if(i < n - 1){ out.push(null); continue; }
    if(i > n - 1) e = a[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}
// 와일더 방식 RSI(14)
function rsi(c, n = 14){
  if(c.length < n + 1) return null;
  let up = 0, dn = 0;
  for(let i = 1; i <= n; i++){ const d = c[i] - c[i - 1]; if(d > 0) up += d; else dn -= d; }
  up /= n; dn /= n;
  for(let i = n + 1; i < c.length; i++){
    const d = c[i] - c[i - 1];
    up = (up * (n - 1) + Math.max(d, 0)) / n;
    dn = (dn * (n - 1) + Math.max(-d, 0)) / n;
  }
  if(dn === 0) return 100;
  return 100 - 100 / (1 + up / dn);
}
function macdCross(c){
  if(c.length < 35) return null;
  const e12 = emaSeries(c, 12), e26 = emaSeries(c, 26);
  const macd = c.map((_, i) => e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null).filter(v => v != null);
  const sig = emaSeries(macd, 9);
  return macd[macd.length - 1] - sig[sig.length - 1];
}
function stochK(k, n = 14){
  if(k.length < n) return null;
  const w = k.slice(-n), hi = Math.max(...w.map(p => p.h)), lo = Math.min(...w.map(p => p.l));
  return hi > lo ? (k[k.length - 1].c - lo) / (hi - lo) * 100 : null;
}

// 표 모으기: +1 매수, 0 중립, -1 매도. 데이터가 모자란 지표는 빠진다.
function rate(k){
  const c = k.map(p => p.c), price = c[c.length - 1], votes = [];
  for(const n of [10, 20, 50, 100, 200]) if(c.length >= n) votes.push(price > sma(c, n) ? 1 : -1);
  if(c.length >= 50){
    const e20 = emaSeries(c, 20), e50 = emaSeries(c, 50);
    votes.push(e20[e20.length - 1] > e50[e50.length - 1] ? 1 : -1);
  }
  const r = rsi(c);
  if(r != null) votes.push(r < 30 ? 1 : r > 70 ? -1 : 0);   // 과매도면 반등(매수), 과매수면 조정(매도) 쪽
  const m = macdCross(c);
  if(m != null) votes.push(m > 0 ? 1 : -1);
  if(c.length > 11) votes.push(Math.sign(price - c[c.length - 11]));  // 모멘텀(10)
  const st = stochK(k);
  if(st != null) votes.push(st < 20 ? 1 : st > 80 ? -1 : 0);
  if(votes.length < 3) return null;
  return {
    score: mean(votes),
    buy: votes.filter(v => v > 0).length,
    neutral: votes.filter(v => v === 0).length,
    sell: votes.filter(v => v < 0).length,
  };
}

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
function stdev(a){ const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); }

// 일봉으로 계산하는 이 코인만의 공포·탐욕. 두 달치(60봉)는 있어야 한다.
function fearGreed(k){
  if(k.length < 60) return null;
  const c = k.map(p => p.c), price = c[c.length - 1];
  const parts = []; // [점수, 가중치]
  const r = rsi(c);
  if(r != null) parts.push([r, 0.30]);
  const w90 = k.slice(-90), lo = Math.min(...w90.map(p => p.l)), hi = Math.max(...w90.map(p => p.h));
  if(hi > lo) parts.push([(price - lo) / (hi - lo) * 100, 0.25]);            // 90일 바닥 근처면 공포
  if(c.length > 31) parts.push([clamp(50 + (price / c[c.length - 31] - 1) * 150), 0.20]); // 30일 ±33%가 양 끝
  const rets = c.slice(1).map((v, i) => Math.log(v / c[i]));
  if(rets.length >= 60){
    const ratio = stdev(rets.slice(-14)) / (stdev(rets.slice(-60)) || 1);
    parts.push([clamp(50 - (ratio - 1) * 60), 0.15]);                          // 요즘 더 출렁이면 공포
  }
  const v = k.map(p => p.v || 0);
  if(v.slice(-30).every(x => x > 0) && c.length > 8){
    const vr = mean(v.slice(-7)) / mean(v.slice(-30));
    const dir = Math.sign(price - c[c.length - 8]);                            // 거래가 붙은 쪽이 오르면 탐욕, 내리면 공포
    parts.push([clamp(50 + dir * clamp((vr - 1) * 60, 0, 50)), 0.10]);
  }
  const wsum = parts.reduce((s, [, w]) => s + w, 0);
  return wsum ? Math.round(parts.reduce((s, [x, w]) => s + x * w, 0) / wsum) : null;
}

// ---------- 표시 ----------
function fgLabel(v){
  if(v < 25) return "극도의 공포";
  if(v < 45) return "공포";
  if(v <= 55) return "중립";
  if(v <= 75) return "탐욕";
  return "극도의 탐욕";
}
function fgColor(v){ // 헤더 공포·탐욕 지수와 같은 색
  if(v < 25) return "#F05464";
  if(v < 45) return "#E8833A";
  if(v < 55) return "#D9A441";
  if(v < 75) return "#7FC77E";
  return "#3ECF8E";
}
function ratingLabel(s){
  if(s <= -0.5) return ["강한 매도", "down"];
  if(s < -0.1)  return ["매도", "down"];
  if(s <= 0.1)  return ["중립", "flat"];
  if(s < 0.5)   return ["매수", "up"];
  return ["강한 매수", "up"];
}

function paint(entry){
  const fgVal = document.getElementById("cfgVal"), fgLab = document.getElementById("cfgLabel");
  const fgBar = document.getElementById("cfgBar");
  if(!entry || entry.loading){
    fgVal.textContent = "-"; fgVal.style.color = ""; fgLab.textContent = "계산 중…";
    fgBar.classList.add("is-empty");
  }else if(entry.flat){
    fgVal.textContent = "-"; fgVal.style.color = ""; fgLab.textContent = "가격이 거의 안 움직이는 코인이라 해당 없음";
    fgBar.classList.add("is-empty");
  }else if(entry.fg == null){
    fgVal.textContent = "-"; fgVal.style.color = ""; fgLab.textContent = "데이터 부족";
    fgBar.classList.add("is-empty");
  }else{
    fgVal.textContent = entry.fg; fgVal.style.color = fgColor(entry.fg);
    fgLab.textContent = fgLabel(entry.fg); fgLab.style.color = fgColor(entry.fg);
    fgBar.classList.remove("is-empty");
    fgBar.firstElementChild.style.left = entry.fg + "%";
  }
  for(const tf of TIMEFRAMES){
    const lab = document.getElementById("sig-" + tf.key), cnt = document.getElementById("sigc-" + tf.key);
    const bar = document.getElementById("sigb-" + tf.key);
    const r = entry && !entry.loading && !entry.flat ? entry.ratings[tf.key] : null;
    if(!r){
      lab.textContent = !entry || entry.loading ? "…" : entry.flat ? "해당 없음" : "데이터 부족";
      lab.className = "sig-rating flat"; cnt.textContent = ""; bar.classList.add("is-empty");
      continue;
    }
    const [text, cls] = ratingLabel(r.score);
    lab.textContent = text; lab.className = "sig-rating " + cls;
    cnt.textContent = `매수 ${r.buy} · 중립 ${r.neutral} · 매도 ${r.sell}`;
    bar.classList.remove("is-empty");
    bar.firstElementChild.style.left = ((r.score + 1) / 2 * 100) + "%";
  }
}

// 코인 상세 페이지를 열 때·시세가 갱신될 때 부른다. 캐시가 살아 있으면 다시 받지 않는다.
export function renderCoinSignals(c){
  const hit = cache[c.id];
  paint(hit && hit.at ? hit : { loading: true });   // 처음 받는 중이면 "계산 중…"
  if(hit && (hit.inflight || Date.now() - (hit.at || 0) < TTL)) return;
  cache[c.id] = { ...(hit || {}), inflight: true };   // 받는 동안 또 부르지 않게

  Promise.all(TIMEFRAMES.map(tf => fetchCoinCandles(c, tf.days).catch(() => null))).then(results => {
    const ratings = {};
    TIMEFRAMES.forEach((tf, i) => { ratings[tf.key] = results[i] && results[i].candles.length ? rate(results[i].candles) : null; });
    const daily = results[1] && results[1].candles;
    // 90일 동안 위아래 폭이 3%도 안 되면(스테이블코인 등) 공포·탐욕도 매수·매도도 의미가 없다
    let flat = false;
    if(daily && daily.length >= 30){
      const w = daily.slice(-90), hi = Math.max(...w.map(p => p.h)), lo = Math.min(...w.map(p => p.l));
      flat = (hi - lo) / ((hi + lo) / 2) < 0.03;
    }
    cache[c.id] = { at: Date.now(), fg: daily ? fearGreed(daily) : null, ratings, flat };
  }).catch(() => {
    cache[c.id] = { at: Date.now(), fg: null, ratings: {}, flat: false };
  }).then(() => {
    if(state.selectedCoinId === c.id) paint(cache[c.id]); // 그 사이 다른 코인으로 넘어갔으면 그리지 않는다
  });
}
