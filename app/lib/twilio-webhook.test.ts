import assert from "node:assert/strict";
import test from "node:test";
import twilio from "twilio";
import {
  buildWhatsAppWelcomeResponse,
  formParamsToRecord,
  isValidTwilioFormRequest,
  parseIncomingWhatsAppMessage
} from "./twilio-webhook.ts";

const AUTH_TOKEN = "test-auth-token";
const WEBHOOK_URL =
  "https://example.com/api/webhooks/twilio/whatsapp";

function validParams() {
  return new URLSearchParams({
    From: "whatsapp:+393331234567",
    To: "whatsapp:+14155238886",
    MessageSid: "SM1234567890abcdefghijklmnopqrst",
    Body: "Ciao"
  });
}

test("convalida una richiesta Twilio firmata e rifiuta firme errate", () => {
  const params = validParams();
  const signature = twilio.getExpectedTwilioSignature(
    AUTH_TOKEN,
    WEBHOOK_URL,
    formParamsToRecord(params)
  );

  assert.equal(
    isValidTwilioFormRequest({
      authToken: AUTH_TOKEN,
      signature,
      url: WEBHOOK_URL,
      params
    }),
    true
  );
  assert.equal(
    isValidTwilioFormRequest({
      authToken: AUTH_TOKEN,
      signature: "invalid",
      url: WEBHOOK_URL,
      params
    }),
    false
  );
});

test("accetta soltanto messaggi WhatsApp con identificatore Twilio valido", () => {
  assert.deepEqual(parseIncomingWhatsAppMessage(validParams()), {
    from: "+393331234567",
    to: "+14155238886",
    messageSid: "SM1234567890abcdefghijklmnopqrst",
    body: "Ciao"
  });

  const invalid = validParams();
  invalid.set("From", "+393331234567");
  assert.equal(parseIncomingWhatsAppMessage(invalid), null);
});

test("genera una risposta TwiML valida senza riflettere input utente", () => {
  const xml = buildWhatsAppWelcomeResponse();
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?><Response>/);
  assert.match(xml, /Studio Barber 8/);
  assert.match(xml, /Scrivi PRENOTA/);
});
