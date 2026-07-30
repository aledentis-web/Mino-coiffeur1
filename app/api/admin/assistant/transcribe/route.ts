import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "../../../../lib/admin-request";
import {
  OpenAITranscriptionConfigurationError,
  OpenAITranscriptionProviderError,
  transcribeVoiceRecording
} from "../../../../lib/openai-transcription";
import { VoiceRecordingValidationError } from "../../../../lib/voice-transcription-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return noStore({ error: "Accesso non autorizzato." }, 401);
  }

  try {
    const formData = await request.formData();
    const audio = formData.get("audio");
    if (!(audio instanceof File)) {
      throw new VoiceRecordingValidationError(
        "Registrazione audio non valida."
      );
    }

    return noStore({
      text: await transcribeVoiceRecording(audio)
    });
  } catch (error) {
    if (error instanceof VoiceRecordingValidationError) {
      return noStore({ error: error.message }, 400);
    }
    if (error instanceof OpenAITranscriptionConfigurationError) {
      return noStore({ error: error.message }, 503);
    }
    if (error instanceof OpenAITranscriptionProviderError) {
      return noStore({ error: error.message }, 502);
    }

    console.error("voice_transcription_failed", {
      name: error instanceof Error ? error.name : "unknown"
    });
    return noStore(
      { error: "La trascrizione vocale non è momentaneamente disponibile." },
      500
    );
  }
}
