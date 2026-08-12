import assert from "node:assert/strict";
import test from "node:test";
import {
  requireVoiceToolAuthorization,
  voiceConversationReference,
  VoiceToolAuthorizationError
} from "./voice-tool.ts";

test("protegge gli strumenti vocali con un bearer secret robusto", () => {
  const previous = process.env.VOICE_TOOL_SECRET;
  try {
    process.env.VOICE_TOOL_SECRET = "short";
    assert.throws(
      () => requireVoiceToolAuthorization(new Request("https://example.test")),
      (error: unknown) =>
        error instanceof VoiceToolAuthorizationError &&
        error.message === "VOICE_TOOL_NOT_CONFIGURED"
    );

    const secret = "v".repeat(48);
    process.env.VOICE_TOOL_SECRET = secret;
    assert.doesNotThrow(() =>
      requireVoiceToolAuthorization(
        new Request("https://example.test", {
          headers: { Authorization: `Bearer ${secret}` }
        })
      )
    );
    assert.throws(
      () =>
        requireVoiceToolAuthorization(
          new Request("https://example.test", {
            headers: { Authorization: "Bearer secret-sbagliato" }
          })
        ),
      VoiceToolAuthorizationError
    );
  } finally {
    if (previous === undefined) delete process.env.VOICE_TOOL_SECRET;
    else process.env.VOICE_TOOL_SECRET = previous;
  }
});

test("normalizza l'identificatore della chiamata senza caratteri pericolosi", () => {
  const request = new Request("https://example.test", {
    headers: {
      "x-telnyx-call-control-id": "call/cliente 123?studio"
    }
  });
  assert.equal(
    voiceConversationReference(request, "fallback-123"),
    "call-cliente-123-studio"
  );
});
