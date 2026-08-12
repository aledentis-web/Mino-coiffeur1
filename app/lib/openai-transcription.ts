import "server-only";

import {
  validateVoiceRecording
} from "./voice-transcription-helpers";

const DEFAULT_TRANSCRIPTION_MODEL = "gpt-transcribe";
const TRANSCRIPTION_TIMEOUT_MS = 30_000;

type TranscriptionPayload = {
  text?: unknown;
};

export class OpenAITranscriptionConfigurationError extends Error {
  constructor() {
    super("La trascrizione OpenAI non è ancora configurata.");
    this.name = "OpenAITranscriptionConfigurationError";
  }
}

export class OpenAITranscriptionProviderError extends Error {
  constructor() {
    super("Non sono riuscito a trascrivere l’audio. Riprova.");
    this.name = "OpenAITranscriptionProviderError";
  }
}

export async function transcribeVoiceRecording(file: File) {
  const recording = validateVoiceRecording(file);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new OpenAITranscriptionConfigurationError();
  }

  const formData = new FormData();
  formData.set(
    "file",
    new File([file], `studio-barber-voice.${recording.extension}`, {
      type: recording.mimeType
    })
  );
  formData.set(
    "model",
    process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() ||
      DEFAULT_TRANSCRIPTION_MODEL
  );
  formData.set("language", "it");
  formData.set(
    "prompt",
    "Prenotazione italiana per Studio Barber 8. Servizi: Taglio, Barba, Taglio + barba, Sistemazione."
  );

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    TRANSCRIPTION_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(process.env.OPENAI_PROJECT_ID?.trim()
            ? { "OpenAI-Project": process.env.OPENAI_PROJECT_ID.trim() }
            : {})
        },
        body: formData,
        signal: controller.signal
      }
    );

    if (!response.ok) {
      console.warn("openai_transcription_rejected", {
        status: response.status
      });
      throw new OpenAITranscriptionProviderError();
    }

    const payload = (await response.json()) as TranscriptionPayload;
    if (
      typeof payload.text !== "string" ||
      !payload.text.trim() ||
      payload.text.length > 4_096
    ) {
      throw new OpenAITranscriptionProviderError();
    }

    return payload.text.trim();
  } catch (error) {
    if (
      error instanceof OpenAITranscriptionProviderError ||
      error instanceof OpenAITranscriptionConfigurationError
    ) {
      throw error;
    }

    console.warn("openai_transcription_unavailable", {
      reason:
        error instanceof DOMException && error.name === "AbortError"
          ? "timeout"
          : "request_failed"
    });
    throw new OpenAITranscriptionProviderError();
  } finally {
    clearTimeout(timeout);
  }
}
