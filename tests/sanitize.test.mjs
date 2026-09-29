// 바깥 글자 다듬기(sanitize.js) — 이상한 입력·악성 입력이 화면에 HTML로 들어가지 못하는지
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText, cleanSym, cleanId, cleanImage, parseNum, cleanDate } from "../coinwatch-src/js/sanitize.js";

test("cleanText: 태그·따옴표·백틱을 걷어 낸다", () => {
  assert.equal(cleanText('<img src=x onerror="alert(1)">'), "img src=x onerror=alert(1)");
  assert.equal(cleanText("<script>alert('x')</script>"), "scriptalert(x)/script");
  assert.equal(cleanText("`${x}`"), "${x}");
});

test("cleanText: 평범한 이름은 그대로 (한글·&·괄호·이모지)", () => {
  assert.equal(cleanText("비트코인"), "비트코인");
  assert.equal(cleanText("Wrapped A&B (Bridged)"), "Wrapped A&B (Bridged)");
  assert.equal(cleanText("Dogwifhat 🐶"), "Dogwifhat 🐶");
});

test("cleanText: 제어 문자·앞뒤 공백을 걷고 길이를 자른다", () => {
  assert.equal(cleanText("  a\u0000b\nc\u007f  "), "abc");
  assert.equal(cleanText("x".repeat(500)).length, 80);
  assert.equal(cleanText("가".repeat(30), 20), "가".repeat(20));
});

test("cleanText: 보이지 않는 문자(방향 뒤집기·폭 없는 문자·한글 채움)를 걷는다", () => {
  assert.equal(cleanText("abc\u202Etxt.exe"), "abctxt.exe");          // 오른쪽→왼쪽 뒤집기
  assert.equal(cleanText("\u202A\u202B\u202C\u202D\u2066\u2067\u2068\u2069x"), "x");
  assert.equal(cleanText("비\u200B트\u200C코\u200E인\u200F"), "비트코인"); // 폭 없는 공백·방향 표시
  assert.equal(cleanText("\uFEFF포트폴리오\u00AD"), "포트폴리오");      // BOM·소프트 하이픈
  assert.equal(cleanText("a\u2028b\u2029c"), "abc");                   // 줄·문단 구분자
  assert.equal(cleanText("\u3164\u3164"), "");                         // 한글 채움 문자만 있는 "빈" 이름
  assert.equal(cleanText("\u115F\u1160\uFFA0x"), "x");
  assert.equal(cleanText("x\u{E0041}\u{E007F}"), "x");                  // 태그 문자
});

test("cleanText: 이모지는 그대로 (ZWJ로 이은 이모지·피부색·국기 포함)", () => {
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}"; // 가족 이모지
  assert.equal(cleanText(family), family);
  assert.equal(cleanText("\u{1F44D}\u{1F3FD}"), "\u{1F44D}\u{1F3FD}");   // 엄지 + 피부색
  assert.equal(cleanText("\u{1F1F0}\u{1F1F7}"), "\u{1F1F0}\u{1F1F7}");   // 태극기
  assert.equal(cleanText("\u2764\uFE0F"), "\u2764\uFE0F");               // 빨간 하트
});

test("cleanText: 문자열이 아닌 값", () => {
  assert.equal(cleanText(null), "");
  assert.equal(cleanText(undefined), "");
  assert.equal(cleanText(123), "123");
  assert.equal(cleanText({ toString(){ return "<b>"; } }), "b");
});

test("cleanSym: 글자·숫자·._- 만 남긴다 (한글·한자 심볼 허용)", () => {
  assert.equal(cleanSym("BTC"), "BTC");
  assert.equal(cleanSym('BTC"><img src=x>'), "BTCimgsrcx");
  assert.equal(cleanSym("../../etc/passwd"), "....etcpasswd");
  assert.equal(cleanSym("BTC USDT"), "BTCUSDT");
  assert.equal(cleanSym("币安币"), "币安币");
  assert.equal(cleanSym("1INCH"), "1INCH");
  assert.equal(cleanSym("A".repeat(50)).length, 20);
  assert.equal(cleanSym(null), "");
});

test("cleanId: 표의 data-id·querySelector에 들어가도 안전", () => {
  assert.equal(cleanId('X"]'), "X");
  assert.equal(cleanId("BTCUSDT"), "BTCUSDT");
});

test("cleanImage: https만, 속성을 깨는 글자가 있으면 버린다", () => {
  assert.equal(cleanImage("https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png"),
    "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png");
  assert.equal(cleanImage("javascript:alert(1)"), null);
  assert.equal(cleanImage("data:image/svg+xml,<svg onload=alert(1)>"), null);
  assert.equal(cleanImage("http://example.com/a.png"), null);
  assert.equal(cleanImage('https://x.com/a.png" onerror="alert(1)'), null);
  assert.equal(cleanImage("https://x.com/a b.png"), null);
  assert.equal(cleanImage("https://x.com/" + "a".repeat(600)), null);
  assert.equal(cleanImage(null), null);
  assert.equal(cleanImage(42), null);
});

test("parseNum: 정상 숫자", () => {
  assert.equal(parseNum("12"), 12);
  assert.equal(parseNum("0.5"), 0.5);
  assert.equal(parseNum(".5"), 0.5);
  assert.equal(parseNum("5."), 5);
  assert.equal(parseNum(" 1,234.5 "), 1234.5);
  assert.equal(parseNum("-3"), -3);
  assert.equal(parseNum("1e3"), 1000);
  assert.equal(parseNum(7), 7);
});

test("parseNum: 이상한 입력은 null", () => {
  assert.equal(parseNum("12abc"), null);   // parseFloat였다면 12
  assert.equal(parseNum("abc"), null);
  assert.equal(parseNum(""), null);
  assert.equal(parseNum("   "), null);
  assert.equal(parseNum("1e400"), null);   // Infinity
  assert.equal(parseNum("Infinity"), null);
  assert.equal(parseNum("NaN"), null);
  assert.equal(parseNum("0x10"), null);
  assert.equal(parseNum("1.2.3"), null);
  assert.equal(parseNum("<b>1</b>"), null);
  assert.equal(parseNum(Infinity), null);
  assert.equal(parseNum(NaN), null);
  assert.equal(parseNum(null), null);
  assert.equal(parseNum({}), null);
});

test("cleanDate: 실제로 있는 YYYY-MM-DD만", () => {
  assert.equal(cleanDate("2026-09-29"), "2026-09-29");
  assert.equal(cleanDate("2024-02-29"), "2024-02-29");  // 윤년
  assert.equal(cleanDate("2026-02-29"), null);          // 윤년 아님
  assert.equal(cleanDate("2026-13-01"), null);
  assert.equal(cleanDate("2026-1-1"), null);
  assert.equal(cleanDate("2026-09-29T00:00"), null);
  assert.equal(cleanDate("<script>"), null);
  assert.equal(cleanDate(null), null);
  assert.equal(cleanDate(20260929), null);
});
