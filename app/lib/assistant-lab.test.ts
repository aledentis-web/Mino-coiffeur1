import assert from "node:assert/strict";
import test from "node:test";
import { parseVoiceLabInput } from "./assistant-lab.ts";

test("normalizza una richiesta del laboratorio vocale", () => {
  assert.deepEqual(
    parseVoiceLabInput({
      phone: "333 123 4567",
      text: "  Vorrei prenotare  ",
      messageId: "voice:12345678-abcd"
    }),
    {
      body: "Vorrei prenotare",
      messageId: "voice:12345678-abcd",
      phoneE164: "+393331234567"
    }
  );
});

test("rifiuta messaggi vuoti e identificatori non isolati", () => {
  assert.throws(() =>
    parseVoiceLabInput({
      phone: "+393331234567",
      text: "",
      messageId: "voice:12345678"
    })
  );
  assert.throws(() =>
    parseVoiceLabInput({
      phone: "+393331234567",
      text: "Ciao",
      messageId: "twilio:12345678"
    })
  );
});
