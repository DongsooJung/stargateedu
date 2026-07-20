import test from "node:test";
import assert from "node:assert/strict";
import { decodeCodefResponse, normalizeRates } from "../lib/codef.js";

test("decodes URL-encoded CODEF JSON", () => {
  const source = { result: { code: "CF-00000" }, data: [] };
  assert.deepEqual(decodeCodefResponse(encodeURIComponent(JSON.stringify(source))), source);
});

test("normalizes fields without exposing the raw response", () => {
  const rates = normalizeRates({ data: { resList: [{ resCurrencyCode: "USD", resExchangeRate: "1,487.40", accountNo: "must-not-leak" }] } });
  assert.equal(rates.length, 1);
  assert.equal(rates[0].currency, "USD");
  assert.equal(rates[0].rate, "1,487.40");
  assert.equal("accountNo" in rates[0], false);
});
