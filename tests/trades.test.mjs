// 포트폴리오 계산(trades.js) — 보유량·평균 매수가가 맞는지, 저장소·백업에서 온 이상한 거래 기록을 거르는지
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state } from "../coinwatch-src/js/state.js";
import { loadTrades, recomputeHoldings, holdingAmount, avgBuyPrice, tradedCoins, chronological }
  from "../coinwatch-src/js/trades.js";

const T = (o) => ({ tid: "t" + Math.random().toString(36).slice(2), id: "BTCUSDT", symbol: "BTC", name: "비트코인",
  side: "buy", amount: 1, price: null, cur: null, date: "2026-01-01", ...o });

beforeEach(() => { state.displayCurrency = "usd"; state.usdKrw = 1400; });

test("loadTrades: 정상 기록은 그대로", () => {
  const t = T({ price: 50000, cur: "usd" });
  const [out] = loadTrades({ trades: [t] });
  assert.equal(out.id, "BTCUSDT");
  assert.equal(out.amount, 1);
  assert.equal(out.price, 50000);
  assert.equal(out.cur, "usd");
  assert.equal(out.date, "2026-01-01");
  assert.equal(out.tid, t.tid);
});

test("loadTrades: 수량이 이상한 기록은 버린다", () => {
  const bad = [
    T({ amount: "5" }),        // 문자열 — 합계가 "05"처럼 이어 붙는다
    T({ amount: -1 }),
    T({ amount: 0 }),
    T({ amount: Infinity }),
    T({ amount: NaN }),
    T({ amount: null }),
    T({ side: "steal" }),
    T({ id: "" }),
    T({ id: "<>" }),          // 다듬고 나면 빈 id
    null, 42, "trade", []
  ];
  assert.deepEqual(loadTrades({ trades: bad }), []);
});

test("loadTrades: 이름·심볼·id의 태그를 걷는다", () => {
  const [out] = loadTrades({ trades: [T({ name: '<img src=x onerror="alert(1)">', symbol: 'btc"><', id: 'BTCUSDT"]' })] });
  assert.equal(out.name, "img src=x onerror=alert(1)");
  assert.equal(out.symbol, "BTC");
  assert.equal(out.id, "BTCUSDT");
});

test("loadTrades: 단가·통화·날짜가 이상하면 비운다", () => {
  const [a, b, c] = loadTrades({ trades: [
    T({ price: "100", cur: "usd" }),
    T({ price: -5, cur: "krw" }),
    T({ price: 100, cur: "eur", date: "2026-02-30" })
  ] });
  assert.equal(a.price, null); assert.equal(a.cur, null);
  assert.equal(b.price, null); assert.equal(b.cur, null);
  assert.equal(c.price, 100);  assert.equal(c.cur, "usd"); assert.equal(c.date, null);
});

test("loadTrades: 예전 형식(holdings)을 단가 없는 매수로 옮긴다", () => {
  const out = loadTrades({ holdings: [{ id: "ETHUSDT", symbol: "eth", name: "이더리움", amount: 2 }, { id: "X", amount: "3" }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].side, "buy");
  assert.equal(out[0].amount, 2);
  assert.equal(out[0].legacy, true);
  assert.equal(out[0].symbol, "ETH");
});

test("recomputeHoldings: 매수 − 매도, 다 판 코인은 빠진다", () => {
  const p = { trades: [
    T({ amount: 1 }), T({ amount: 0.5 }), T({ side: "sell", amount: 0.3 }),
    T({ id: "ETHUSDT", symbol: "ETH", amount: 2 }), T({ id: "ETHUSDT", symbol: "ETH", side: "sell", amount: 2 })
  ] };
  recomputeHoldings(p);
  assert.equal(p.holdings.length, 1);
  assert.equal(p.holdings[0].id, "BTCUSDT");
  assert.equal(p.holdings[0].amount, 1.2);
});

test("recomputeHoldings: 소수 찌꺼기 정리 (0.1 + 0.2)", () => {
  const p = { trades: [T({ amount: 0.1 }), T({ amount: 0.2 })] };
  recomputeHoldings(p);
  assert.equal(p.holdings[0].amount, 0.3);
});

test("recomputeHoldings: 보유보다 많이 팔면 목록에서 빠진다 (음수로 남지 않음)", () => {
  const p = { trades: [T({ amount: 1 }), T({ side: "sell", amount: 5 })] };
  recomputeHoldings(p);
  assert.deepEqual(p.holdings, []);
  assert.equal(holdingAmount(p.trades, "BTCUSDT"), -4);
});

test("avgBuyPrice: 이동평균법 — 매도는 평균을 바꾸지 않는다", () => {
  const trades = [
    T({ amount: 1, price: 100, cur: "usd", date: "2026-01-01" }),
    T({ amount: 1, price: 200, cur: "usd", date: "2026-01-02" }),
    T({ side: "sell", amount: 1, date: "2026-01-03" }),
    T({ amount: 2, price: 300, cur: "usd", date: "2026-01-04" })
  ];
  // 150짜리 1개 + 300짜리 2개 = 750 / 3 = 250
  assert.equal(avgBuyPrice(trades, "BTCUSDT").avg, 250);
});

test("avgBuyPrice: 단가 없는 매수가 섞이면 partial", () => {
  const r = avgBuyPrice([T({ amount: 1, price: 100, cur: "usd" }), T({ amount: 1 })], "BTCUSDT");
  assert.equal(r.avg, 100);
  assert.equal(r.partial, true);
});

test("avgBuyPrice: 원화로 산 것도 표시 통화로 바꿔 평균", () => {
  const r = avgBuyPrice([T({ amount: 1, price: 140000, cur: "krw" }), T({ amount: 1, price: 200, cur: "usd" })], "BTCUSDT");
  assert.equal(r.avg, 150); // 140000원 / 1400 = $100
});

test("avgBuyPrice: 단가가 하나도 없으면 null", () => {
  assert.equal(avgBuyPrice([T()], "BTCUSDT").avg, null);
  assert.equal(avgBuyPrice([], "BTCUSDT").avg, null);
});

test("chronological: 날짜 모르는 기존 보유분이 맨 앞, 같은 날은 입력 순서", () => {
  const a = T({ date: "2026-02-01", tid: "a" }), b = T({ date: null, tid: "b" }),
        c = T({ date: "2026-01-01", tid: "c" }), d = T({ date: "2026-01-01", tid: "d" });
  assert.deepEqual(chronological([a, b, c, d]).map(t => t.tid), ["b", "c", "d", "a"]);
});

test("tradedCoins: 첫 거래 순서로 중복 없이", () => {
  const out = tradedCoins([T(), T({ id: "ETHUSDT", symbol: "ETH" }), T()]);
  assert.deepEqual(out.map(c => c.id), ["BTCUSDT", "ETHUSDT"]);
});
