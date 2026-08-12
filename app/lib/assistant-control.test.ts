import assert from "node:assert/strict";
import test from "node:test";
import { estimateOpenAiTextCostMicrousd } from "./assistant-control.ts";

test("calcola il costo gpt-5-mini in microdollari dai token", () => {
  assert.equal(
    estimateOpenAiTextCostMicrousd({
      model: "gpt-5-mini",
      inputTokens: 1_000,
      outputTokens: 100
    }),
    450
  );
});

test("riconosce anche gli snapshot del modello", () => {
  assert.equal(
    estimateOpenAiTextCostMicrousd({
      model: "gpt-5-mini-2026-01-01",
      inputTokens: 4_000,
      outputTokens: 500
    }),
    2_000
  );
});

test("non inventa un costo per modelli senza listino configurato", () => {
  assert.equal(
    estimateOpenAiTextCostMicrousd({
      model: "modello-sconosciuto",
      inputTokens: 1_000,
      outputTokens: 100
    }),
    null
  );
});
