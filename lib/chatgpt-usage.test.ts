import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUsage } from "./account-usage";
test("limites usam os grupos do provedor, preservam ausência e não expõem dados da conta", () => {
  const u = normalizeUsage({ rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: {
    codex: { limitId: "codex", primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 1800000000 }, secondary: null, accessToken: "segredo" },
    outro: { limitId: "outro", primary: { usedPercent: 110 }, secondary: { usedPercent: null } },
  } });
  assert.equal(u.buckets.length, 2);
  assert.equal(u.buckets[0].primary?.usedPercent, 23);
  assert.equal(u.buckets[1].primary?.usedPercent, 100);
  assert.equal(u.buckets[1].primary?.resetsAt, null);
  assert.equal(u.buckets[1].secondary, null);
  assert.ok(!JSON.stringify(u).includes("segredo"));
  assert.deepEqual(normalizeUsage(null).buckets, []);
});
