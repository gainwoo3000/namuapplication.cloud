// 백업 코드(backup-codec.js) — 만들고 읽으면 그대로 돌아오는지, 잘린 코드·가짜 코드·악성 코드를 막는지
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeCode, decodeInput, stripMarkup, summarize, fmtWhen, MAX_INPUT } from "../coinwatch-src/js/backup-codec.js";

const payload = (data, extra) => ({ app: "coinwatch", v: 1, savedAt: "2026-09-29T06:38:00.000Z", data, ...extra });
const sample = {
  watchlist: ["BTCUSDT", "ETHUSDT"],
  portfolios: [{ name: "내 포트폴리오 🚀", trades: [{ id: "BTCUSDT", side: "buy", amount: 0.5, price: 83000 }], exchanges: ["upbit"] }],
  fontScale: 1.12, theme: "light"
};

test("만들고 읽으면 그대로 (한글·이모지 포함)", () => {
  const code = encodeCode(payload(sample));
  assert.ok(code.startsWith("CW1:"));
  const out = decodeInput(code);
  assert.deepEqual(out.data, sample);
  assert.equal(out.savedAt, "2026-09-29T06:38:00.000Z");
});

test("메신저가 줄을 접거나 앞뒤에 공백·글을 붙여도 읽힌다", () => {
  const code = encodeCode(payload(sample));
  const mangled = "내 백업:\n  " + code.slice(0, 40) + "\n" + code.slice(40, 90) + " \r\n" + code.slice(90) + "\n\n";
  assert.deepEqual(decodeInput(mangled).data, sample);
});

test("백업 파일(JSON 그대로)도 읽힌다", () => {
  assert.deepEqual(decodeInput(JSON.stringify(payload(sample), null, 1)).data, sample);
});

test("잘못된 입력은 사람이 읽을 문장으로 거절", () => {
  const code = encodeCode(payload(sample));
  const cases = [
    ["", /붙여 넣어/],
    ["   \n ", /붙여 넣어/],
    [code.slice(0, 60), /읽지 못했어요/],             // 잘린 코드
    ["CW1:!!!not-base64!!!", /읽지 못했어요/],
    ["CW1:" + Buffer.from([0xff, 0xfe, 0xfd]).toString("base64"), /읽지 못했어요/], // UTF-8이 아닌 바이트
    ["hello world", /읽지 못했어요/],
    ["{broken json", /읽지 못했어요/],
    ['{"hello":1}', /코인워치캡 백업이 아니에요/],
    [JSON.stringify(payload(null)), /코인워치캡 백업이 아니에요/],
    [JSON.stringify(payload("str")), /코인워치캡 백업이 아니에요/],
    [JSON.stringify(payload({ theme: "dark" })), /관심 코인·포트폴리오가 없어요/],
    [JSON.stringify(payload(sample, { v: 99 })), /더 새 버전/],
    ["null", /읽지 못했어요|백업이 아니에요/],
  ];
  for(const [input, re] of cases){
    assert.throws(() => decodeInput(input), re, JSON.stringify(input).slice(0, 60));
  }
});

test("너무 긴 입력은 파싱하기 전에 거절", () => {
  assert.throws(() => decodeInput("CW1:" + "A".repeat(MAX_INPUT)), /너무 길어요/);
});

test("깊게 중첩된 악성 JSON도 앱을 죽이지 않고 거절된다", () => {
  const deep = '{"app":"coinwatch","v":1,"data":{"watchlist":[],"x":' + "[".repeat(200000) + "]".repeat(200000) + "}}";
  assert.throws(() => decodeInput(deep), Error);
});

test("이름에 심은 태그를 걷는다", () => {
  const evil = { watchlist: ['BTC"><img src=x onerror=alert(1)>'],
    portfolios: [{ name: '<img src=x onerror="alert(document.cookie)">', trades: [] }] };
  const out = decodeInput(encodeCode(payload(evil))).data;
  const strings = JSON.stringify(out).match(/"(?:[^"\\]|\\.)*"/g).map(s => JSON.parse(s));
  assert.ok(strings.every(s => !/[<>"'`]/.test(s)), JSON.stringify(out));
  assert.equal(out.portfolios[0].name, "img src=x onerror=alert(document.cookie)");
});

test("__proto__ 키로 객체 프로토타입을 바꿀 수 없다", () => {
  const raw = '{"app":"coinwatch","v":1,"data":{"watchlist":[],"__proto__":{"polluted":true},"constructor":{"x":1}}}';
  const out = decodeInput(raw).data;
  assert.equal(out.polluted, undefined);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.equal({}.polluted, undefined);
});

test("stripMarkup: 숫자·불리언·null은 건드리지 않는다", () => {
  assert.deepEqual(stripMarkup({ a: 1, b: true, c: null, d: [1.5, "x<y"] }), { a: 1, b: true, c: null, d: [1.5, "xy"] });
});

test("summarize: 모양이 이상해도 죽지 않는다", () => {
  assert.equal(summarize(sample), "관심 코인 2개 · 포트폴리오 1개 (거래 1건)");
  assert.equal(summarize({ watchlist: "x", portfolios: [null, { trades: "y" }] }), "관심 코인 0개 · 포트폴리오 2개 (거래 0건)");
});

test("fmtWhen: 날짜가 이상하면 빈 문자열", () => {
  assert.equal(fmtWhen("not a date"), "");
  assert.equal(fmtWhen(undefined), "");
  assert.match(fmtWhen("2026-09-29T06:38:00.000Z"), /^2026\.09\.29 \d\d:\d\d$/);
});
