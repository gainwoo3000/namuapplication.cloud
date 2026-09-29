// 차트 계산 — 이동평균(graph.js smaSeries), 눈금, 봉 간격, 빗썸 일봉→주봉(api.js toWeekly)
import { test } from "node:test";
import assert from "node:assert/strict";
import { smaSeries, niceTicks, medianGap, fmtGap } from "../coinwatch-src/js/graph.js";

// api.js는 constants.js를 거쳐 window.APP_VERSION을 읽는다 — 브라우저 밖이라 빈 window를 깔아 둔다
globalThis.window ??= {};
const { toWeekly } = await import("../coinwatch-src/js/api.js");

test("smaSeries: 앞쪽 n-1개는 null, 그다음부터 평균", () => {
  assert.deepEqual(smaSeries([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(smaSeries([10, 20], 1), [10, 20]);
  assert.deepEqual(smaSeries([1, 2], 5), [null, null]);
  assert.deepEqual(smaSeries([], 5), []);
});

test("smaSeries: 긴 시리즈에서도 누적 오차가 없다", () => {
  const c = Array.from({ length: 5000 }, (_, i) => 100 + Math.sin(i) * 10);
  const s = smaSeries(c, 120);
  const direct = c.slice(4880, 5000).reduce((a, b) => a + b, 0) / 120;
  assert.ok(Math.abs(s[4999] - direct) < 1e-9);
});

test("이평선 워밍업: 앞 봉을 계산에만 쓰고 잘라 내면 보이는 첫 봉부터 값이 있다", () => {
  const warm = Array.from({ length: 119 }, (_, i) => i);
  const vis = Array.from({ length: 96 }, (_, i) => 119 + i);
  const vals = smaSeries(warm.concat(vis), 120).slice(warm.length);
  assert.equal(vals.length, 96);
  assert.ok(vals.every(v => v !== null));
  assert.equal(vals[0], (0 + 119) / 2);
});

test("niceTicks: 범위 안의 고른 눈금", () => {
  const t = niceTicks(83012, 84977, 5);
  assert.ok(t.length >= 3 && t.length <= 8);
  assert.ok(t.every(v => v >= 83012 && v <= 84977));
  const step = t[1] - t[0];
  assert.ok(t.every((v, i) => i === 0 || Math.abs(v - t[i - 1] - step) < 1e-6));
});

test("niceTicks: 이상한 범위에서 무한히 돌지 않는다", () => {
  assert.deepEqual(niceTicks(5, 5, 4), []);
  assert.deepEqual(niceTicks(NaN, 1, 4), []);
  assert.ok(niceTicks(0, 1e300, 4).length <= 41);
  assert.equal(niceTicks(-1, 1, 4).includes(-0), true); // 0 근처가 -0.0000001로 찍히지 않고 0
});

test("medianGap / fmtGap: 공백이 끼어도 중앙값", () => {
  const pts = [0, 900, 1800, 2700, 99999, 100899].map(t => ({ t }));
  assert.equal(medianGap(pts), 900);
  assert.equal(medianGap([{ t: 1 }]), 0);
  assert.equal(fmtGap(900), "15분");
  assert.equal(fmtGap(0), "");
});

test("toWeekly: 월요일(UTC) 시작 주봉으로 묶는다", () => {
  const day = 86400;
  const mon = Date.UTC(2026, 8, 21) / 1000; // 2026-09-21 월요일
  const days = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ t: mon + i * day, o: 10 + i, h: 20 + i, l: 5 + i, c: 11 + i, v: 1 }));
  const w = toWeekly(days);
  assert.equal(w.length, 2);
  assert.equal(w[0].t, mon);
  assert.deepEqual([w[0].o, w[0].h, w[0].l, w[0].c, w[0].v], [10, 26, 5, 17, 7]);
  assert.equal(w[1].t, mon + 7 * day);
  assert.equal(w[1].o, 17);
});
