export const MAX_VOICE_RECORDING_BYTES = 10 * 1024 * 1024;

type SupportedRecording = {
  extension: string;
  mimeType: string;
};

const SUPPORTED_RECORDING_TYPES = new Map<string, SupportedRecording>([
  ["audio/webm", { extension: "webm", mimeType: "audio/webm" }],
  ["audio/mp4", { extension: "m4a", mimeType: "audio/mp4" }],
  ["video/mp4", { extension: "mp4", mimeType: "video/mp4" }],
  ["audio/mpeg", { extension: "mp3", mimeType: "audio/mpeg" }],
  ["audio/wav", { extension: "wav", mimeType: "audio/wav" }],
  ["audio/x-wav", { extension: "wav", mimeType: "audio/wav" }]
] as const);

export class VoiceRecordingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceRecordingValidationError";
  }
}

function normalizeMimeType(value: string) {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function validateVoiceRecording({
  size,
  type
}: {
  size: number;
  type: string;
}) {
  if (!Number.isFinite(size) || size <= 0) {
    throw new VoiceRecordingValidationError(
      "La registrazione è vuota. Riprova parlando più vicino al microfono."
    );
  }

  if (size > MAX_VOICE_RECORDING_BYTES) {
    throw new VoiceRecordingValidationError(
      "La registrazione è troppo lunga. Registra un messaggio più breve."
    );
  }

  const normalizedType = normalizeMimeType(type);
  const supported = SUPPORTED_RECORDING_TYPES.get(normalizedType);

  if (!supported) {
    throw new VoiceRecordingValidationError(
      "Il formato audio del browser non è supportato."
    );
  }

  return supported;
}
