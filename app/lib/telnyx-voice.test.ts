import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign
} from "node:crypto";
import test from "node:test";
import {
  isValidTelnyxWebhookSignature,
  parseTelnyxConversationEnded
} from "./telnyx-voice.ts";

test("verifica la firma Ed25519 Telnyx e rifiuta replay o payload alterati", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const telnyxRawPublicKey = publicDer.subarray(-32).toString("base64");
  const now = new Date("2026-08-05T10:00:00.000Z");
  const timestamp = String(Math.floor(now.getTime() / 1_000));
  const rawBody = JSON.stringify({ data: { event_type: "test" } });
  const signature = sign(
    null,
    Buffer.from(`${timestamp}|${rawBody}`, "utf8"),
    privateKey
  ).toString("base64");

  assert.equal(
    isValidTelnyxWebhookSignature({
      rawBody,
      signature,
      timestamp,
      publicKey: telnyxRawPublicKey,
      now
    }),
    true
  );
  assert.equal(
    isValidTelnyxWebhookSignature({
      rawBody: `${rawBody} `,
      signature,
      timestamp,
      publicKey: telnyxRawPublicKey,
      now
    }),
    false
  );
  assert.equal(
    isValidTelnyxWebhookSignature({
      rawBody,
      signature,
      timestamp,
      publicKey: telnyxRawPublicKey,
      now: new Date(now.getTime() + 301_000)
    }),
    false
  );
});

test("estrae soltanto un evento Telnyx di fine conversazione completo", () => {
  const occurredAt = "2026-08-05T10:30:00.000Z";
  const parsed = parseTelnyxConversationEnded({
    data: {
      event_type: "call.conversation.ended",
      id: "11111111-1111-4111-8111-111111111111",
      occurred_at: occurredAt,
      payload: {
        assistant_id: "assistant-test",
        call_session_id: "22222222-2222-4222-8222-222222222222",
        conversation_id: "33333333-3333-4333-8333-333333333333",
        duration_sec: 91.4,
        from: "+393331234567",
        to: "assistant-test.sip.telnyx.com",
        llm_model: "openai/gpt-5-mini",
        stt_model: "whisper",
        tts_model_id: "NaturalHD",
        reason: "customer_disconnect"
      }
    }
  });

  assert.ok(parsed);
  assert.equal(parsed.durationSeconds, 91);
  assert.equal(parsed.occurredAt.toISOString(), occurredAt);
  assert.equal(parsed.assistantId, "assistant-test");
  assert.equal(parseTelnyxConversationEnded({ data: { event_type: "other" } }), null);
});
