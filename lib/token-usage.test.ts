import test from "node:test";
import assert from "node:assert/strict";
import { tokenUsage } from "./token-usage";

test("consumo ausente ou inválido não é exibido como zero", () => {
  for (const value of [undefined, {}, { inputTokens: -1, outputTokens: 2 }, { inputTokens: 10 }, { inputTokens: NaN, outputTokens: 2 }]) {
    assert.equal(tokenUsage(value, "chatgpt"), undefined);
  }
  assert.equal(tokenUsage({ inputTokens: 0, outputTokens: 0 }, "chatgpt")?.total, 0);
});

test("cache e raciocínio são detalhados sem somá-los novamente ao total", () => {
  assert.deepEqual(tokenUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 80 }, completion_tokens_details: { reasoning_tokens: 10 } }, "openrouter"), {
    input: 100, output: 20, total: 120, cachedInput: 80, reasoning: 10,
  });
});
