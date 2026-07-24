import {
  BookingValidationError,
  normalizeItalianPhone
} from "./public-booking.ts";

const MESSAGE_ID_PATTERN = /^voice:[A-Za-z0-9._:-]{8,160}$/;

export type VoiceLabInput = {
  body: string;
  messageId: string;
  phoneE164: string;
};

export function parseVoiceLabInput(value: unknown): VoiceLabInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BookingValidationError("Richiesta vocale non valida.");
  }

  const body = value as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const messageId =
    typeof body.messageId === "string" ? body.messageId.trim() : "";

  if (!text || text.length > 4096) {
    throw new BookingValidationError("Messaggio vocale non valido.");
  }
  if (!MESSAGE_ID_PATTERN.test(messageId)) {
    throw new BookingValidationError("Identificatore vocale non valido.");
  }

  return {
    body: text,
    messageId,
    phoneE164: normalizeItalianPhone(body.phone)
  };
}
