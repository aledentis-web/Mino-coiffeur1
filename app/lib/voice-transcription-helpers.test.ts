import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_VOICE_RECORDING_BYTES,
  validateVoiceRecording,
  VoiceRecordingValidationError
} from "./voice-transcription-helpers.ts";

test("accetta i formati registrati dai browser principali", () => {
  assert.deepEqual(
    validateVoiceRecording({
      size: 4_096,
      type: "audio/webm;codecs=opus"
    }),
    { extension: "webm", mimeType: "audio/webm" }
  );

  assert.deepEqual(
    validateVoiceRecording({ size: 4_096, type: "audio/mp4" }),
    { extension: "m4a", mimeType: "audio/mp4" }
  );
});

test("rifiuta registrazioni vuote o troppo grandi", () => {
  assert.throws(
    () => validateVoiceRecording({ size: 0, type: "audio/webm" }),
    VoiceRecordingValidationError
  );
  assert.throws(
    () =>
      validateVoiceRecording({
        size: MAX_VOICE_RECORDING_BYTES + 1,
        type: "audio/webm"
      }),
    VoiceRecordingValidationError
  );
});

test("rifiuta formati non ammessi", () => {
  assert.throws(
    () => validateVoiceRecording({ size: 4_096, type: "audio/ogg" }),
    VoiceRecordingValidationError
  );
});
