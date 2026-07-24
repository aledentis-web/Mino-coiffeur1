import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVoiceGatherResponse,
  buildVoiceMessageId,
  getVoiceTurnText,
  isVoiceConversationComplete,
  normalizeAssistantTextForVoice,
  parseIncomingVoiceTurn
} from "./twilio-voice.ts";

function validParams() {
  return new URLSearchParams({
    CallSid: "CA1234567890abcdefghijklmnopqrst",
    From: "+393331234567",
    To: "+390321123456",
    SpeechResult: "Vorrei un taglio"
  });
}

test("estrae una richiesta vocale Twilio valida", () => {
  const turn = parseIncomingVoiceTurn(validParams());
  assert.ok(turn);
  assert.equal(getVoiceTurnText(turn), "Vorrei un taglio");
  assert.match(buildVoiceMessageId(turn), /^voice:CA.+:[a-f0-9]{24}$/);
});

test("accetta il tastierino e rifiuta chiamate senza numero E.164", () => {
  const params = validParams();
  params.delete("SpeechResult");
  params.set("Digits", "2");
  const turn = parseIncomingVoiceTurn(params);
  assert.ok(turn);
  assert.equal(getVoiceTurnText(turn), "2");

  params.set("From", "anonymous");
  assert.equal(parseIncomingVoiceTurn(params), null);
});

test("adatta i messaggi lunghi alla lettura telefonica", () => {
  const text = normalizeAssistantTextForVoice(
    "Orari:\n1. 09:30\n2. 10:00\n3. 10:30\n4. 11:00\n5. 11:30\n6. 12:00"
  );
  assert.match(text, /9 e 30/);
  assert.doesNotMatch(text, /6\. 12/);
  assert.match(text, /prime 5 opzioni/);
});

test("genera TwiML vocale con Gather e riconosce la conclusione", () => {
  const xml = buildVoiceGatherResponse({
    message: "Quale servizio vuoi prenotare?",
    action: "/api/webhooks/twilio/voice?attempt=1"
  });
  assert.match(xml, /<Gather/);
  assert.match(xml, /input="speech dtmf"/);
  assert.match(xml, /language="it-IT"/);
  assert.equal(
    isVoiceConversationComplete("Appuntamento confermato ✅"),
    true
  );
});
