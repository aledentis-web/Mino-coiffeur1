import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  isValidMetaWebhookSignature,
  parseMetaWhatsAppMessages,
  verifyMetaWebhookChallenge
} from "./meta-whatsapp.ts";

test("verifica challenge e token Meta", () => {
  assert.equal(
    verifyMetaWebhookChallenge({
      mode: "subscribe",
      token: "verify-studio-barber",
      challenge: "123456",
      expectedToken: "verify-studio-barber"
    }),
    "123456"
  );
  assert.equal(
    verifyMetaWebhookChallenge({
      mode: "subscribe",
      token: "token-sbagliato",
      challenge: "123456",
      expectedToken: "verify-studio-barber"
    }),
    null
  );
});

test("accetta soltanto payload firmati con App Secret", () => {
  const appSecret = "meta-app-secret";
  const rawBody = JSON.stringify({ object: "whatsapp_business_account" });
  const signature = `sha256=${createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex")}`;

  assert.equal(
    isValidMetaWebhookSignature({ rawBody, signature, appSecret }),
    true
  );
  assert.equal(
    isValidMetaWebhookSignature({
      rawBody,
      signature: "sha256=invalid",
      appSecret
    }),
    false
  );
});

test("estrae messaggi testuali WhatsApp dal webhook Meta", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "123456789012345" },
              messages: [
                {
                  from: "393331234567",
                  id: "wamid.test-message-123456",
                  type: "text",
                  text: { body: "Vorrei prenotare" }
                },
                {
                  from: "393331234567",
                  id: "wamid.image-message-123456",
                  type: "image",
                  image: { id: "image" }
                }
              ]
            }
          }
        ]
      }
    ]
  };

  assert.deepEqual(parseMetaWhatsAppMessages(payload), [
    {
      body: "Vorrei prenotare",
      from: "+393331234567",
      messageId: "wamid.test-message-123456",
      phoneNumberId: "123456789012345"
    }
  ]);
});

test("ignora payload di stato e strutture non valide", () => {
  assert.deepEqual(
    parseMetaWhatsAppMessages({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1" }] } }] }]
    }),
    []
  );
  assert.deepEqual(parseMetaWhatsAppMessages({ object: "page" }), []);
});
