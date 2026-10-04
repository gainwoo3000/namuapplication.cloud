import test from "node:test";
import assert from "node:assert/strict";
import { t, LANG, compactEn } from "../coinwatch-src/js/i18n.js";

test("창이 없는 node에서는 한국어로 돈다", () => {
  assert.equal(LANG, "ko");
  assert.equal(t("시세", "Market"), "시세");
});

test("compactEn: T·B·M·K로 줄여 쓴다", () => {
  assert.equal(compactEn(2.345e12, 2), "2.35T");
  assert.equal(compactEn(3.5e9), "3.5B");
  assert.equal(compactEn(114_000_000, 2), "114M");
  assert.equal(compactEn(12_300), "12.3K");
  assert.equal(compactEn(123_456, 0), "123K");
  assert.equal(compactEn(999), "999");
});
