import "server-only";

import { getServerSupabase } from "./supabase/server";

export type DeliveryStatus = "pending" | "sent" | "failed";

export function sanitizeProviderError(error: unknown) {
  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const rawCode = record.code ?? record.status ?? "UNKNOWN";
  const rawMessage =
    typeof record.message === "string"
      ? record.message
      : "Errore sconosciuto del provider.";

  return {
    code: String(rawCode).slice(0, 80),
    message: rawMessage
      .replace(/AC[A-Za-z0-9]{20,40}/g, "AC[redacted]")
      .replace(/EAA[A-Za-z0-9_-]{20,}/g, "EAA[redacted]")
      .replace(/\s+/g, " ")
      .slice(0, 500)
  };
}

export async function recordAssistantDelivery({
  messageId,
  status,
  outboundId,
  errorCode,
  errorMessage
}: {
  messageId: string;
  status: DeliveryStatus;
  outboundId?: string;
  errorCode?: string;
  errorMessage?: string;
}) {
  const { error } = await getServerSupabase()
    .from("whatsapp_conversations")
    .update({
      last_delivery_status: status,
      last_outbound_sid: outboundId ?? null,
      last_delivery_error_code: errorCode ?? null,
      last_delivery_error_message: errorMessage ?? null,
      last_delivery_attempt_at: new Date().toISOString()
    })
    .eq("last_message_sid", messageId);

  if (error) {
    console.error("assistant_delivery_diagnostic_failed", {
      messageId,
      code: error.code
    });
  }
}
