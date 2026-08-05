import "server-only";

import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAssistantControl } from "./assistant-control.ts";

export class VoiceToolAuthorizationError extends Error {
  constructor(message = "VOICE_TOOL_UNAUTHORIZED") {
    super(message);
    this.name = "VoiceToolAuthorizationError";
  }
}

export class VoiceAgentPausedError extends Error {
  constructor(message = "VOICE_AGENT_PAUSED") {
    super(message);
    this.name = "VoiceAgentPausedError";
  }
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function requireVoiceToolAuthorization(request: Request) {
  const expected = process.env.VOICE_TOOL_SECRET?.trim();
  if (!expected) throw new VoiceToolAuthorizationError("VOICE_TOOL_NOT_CONFIGURED");

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const explicit = request.headers.get("x-voice-tool-secret")?.trim() ?? "";
  const supplied = bearer || explicit;

  if (!supplied || !secureEqual(supplied, expected)) {
    throw new VoiceToolAuthorizationError();
  }
}

export function configuredVoiceBusinessSlug() {
  return process.env.STUDIO_BARBER_BUSINESS_SLUG?.trim() || "studio-barber-8";
}

export function configuredVoiceResourceSlug() {
  return process.env.STUDIO_BARBER_RESOURCE_SLUG?.trim() || "main";
}

export async function requireVoiceAgentOperational({
  supabase
}: {
  supabase: SupabaseClient;
}) {
  const businessSlug = configuredVoiceBusinessSlug();
  const control = await getAssistantControl({ supabase, businessSlug });
  if (!control.agentEnabled || !control.voiceEnabled) {
    throw new VoiceAgentPausedError();
  }
  return { control, businessSlug };
}

export function voiceConversationReference(request: Request, fallback: string) {
  const raw =
    request.headers.get("x-telnyx-conversation-id") ??
    request.headers.get("x-telnyx-call-control-id") ??
    request.headers.get("x-voice-conversation-id") ??
    fallback;
  const clean = raw.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 96);
  return clean.length >= 8 ? clean : fallback;
}
