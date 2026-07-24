import { createHash } from "node:crypto";
import twilio from "twilio";

const CALL_SID_PATTERN = /^CA[a-zA-Z0-9]{20,40}$/;
const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const MAX_SPEECH_LENGTH = 4096;
const MAX_VOICE_OPTIONS = 5;

export type IncomingVoiceTurn = {
  callSid: string;
  from: string;
  to: string;
  speech: string;
  digits: string;
};

export function parseIncomingVoiceTurn(params: URLSearchParams) {
  const callSid = params.get("CallSid")?.trim() ?? "";
  const from = params.get("From")?.trim() ?? "";
  const to = params.get("To")?.trim() ?? "";
  const speech = params.get("SpeechResult")?.trim() ?? "";
  const digits = params.get("Digits")?.trim() ?? "";

  if (
    !CALL_SID_PATTERN.test(callSid) ||
    !E164_PATTERN.test(from) ||
    !E164_PATTERN.test(to)
  ) {
    return null;
  }

  return {
    callSid,
    from,
    to,
    speech: speech.slice(0, MAX_SPEECH_LENGTH),
    digits: /^\d{1,4}$/.test(digits) ? digits : ""
  } satisfies IncomingVoiceTurn;
}

export function getVoiceTurnText(turn: IncomingVoiceTurn) {
  return turn.speech || turn.digits;
}

export function buildVoiceMessageId(turn: IncomingVoiceTurn) {
  const input = getVoiceTurnText(turn) || "start";
  const digest = createHash("sha256")
    .update(`${turn.callSid}\0${input}`)
    .digest("hex")
    .slice(0, 24);
  return `voice:${turn.callSid}:${digest}`;
}

export function normalizeAssistantTextForVoice(message: string) {
  const lines = message
    .replace(/[✅📅]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const spoken: string[] = [];
  let numberedOptions = 0;

  for (const line of lines) {
    if (/^\d+\.\s/.test(line)) {
      numberedOptions += 1;
      if (numberedOptions > MAX_VOICE_OPTIONS) continue;
    }

    spoken.push(
      line
        .replace(/(\d{1,2}):(\d{2})/g, "$1 e $2")
        .replace(/€/g, " euro")
        .replace(/\s+/g, " ")
    );
  }

  if (numberedOptions > MAX_VOICE_OPTIONS) {
    spoken.push(
      `Ti ho letto le prime ${MAX_VOICE_OPTIONS} opzioni. Puoi anche dire direttamente un altro orario.`
    );
  }

  return spoken.join(". ").slice(0, 4096);
}

export function isVoiceConversationComplete(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("appuntamento confermato") ||
    normalized.includes("prenotazione annullata") ||
    normalized.includes("non ho creato l’appuntamento")
  );
}

export function buildVoiceGatherResponse({
  message,
  action,
  complete = false
}: {
  message: string;
  action: string;
  complete?: boolean;
}) {
  const response = new twilio.twiml.VoiceResponse();
  const spokenMessage = normalizeAssistantTextForVoice(message);

  if (complete) {
    response.say({ language: "it-IT", voice: "alice" }, spokenMessage);
    response.say(
      { language: "it-IT", voice: "alice" },
      "Grazie per aver chiamato Studio Barber 8. A presto."
    );
    response.hangup();
    return response.toString();
  }

  const gather = response.gather({
    action,
    actionOnEmptyResult: true,
    input: ["speech", "dtmf"],
    language: "it-IT",
    method: "POST",
    numDigits: 1,
    speechTimeout: "auto",
    timeout: 5
  });
  gather.say({ language: "it-IT", voice: "alice" }, spokenMessage);
  return response.toString();
}

export function buildVoiceHangupResponse(message: string) {
  const response = new twilio.twiml.VoiceResponse();
  response.say(
    { language: "it-IT", voice: "alice" },
    normalizeAssistantTextForVoice(message)
  );
  response.hangup();
  return response.toString();
}
