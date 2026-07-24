import { NextResponse } from "next/server";
import {
  AutomationConfigurationError,
  isAuthorizedAutomationRequest
} from "../../../../lib/automation-auth";
import {
  getServerSupabase,
  SupabaseConfigurationError
} from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: Request) {
  try {
    if (!isAuthorizedAutomationRequest(request)) {
      return noStore({ error: "Accesso non autorizzato." }, 401);
    }

    const body = (await request.json().catch(() => ({}))) as {
      eventId?: unknown;
      workerId?: unknown;
      succeeded?: unknown;
      error?: unknown;
    };
    const eventId =
      typeof body.eventId === "string" ? body.eventId.trim() : "";
    const workerId =
      typeof body.workerId === "string" ? body.workerId.trim() : "";
    const succeeded =
      typeof body.succeeded === "boolean" ? body.succeeded : null;
    const failureMessage =
      typeof body.error === "string" ? body.error.trim().slice(0, 1000) : null;

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        eventId
      ) ||
      !workerId ||
      workerId.length > 120 ||
      succeeded === null
    ) {
      return noStore({ error: "Esito automazione non valido." }, 400);
    }

    const { data, error } = await getServerSupabase().rpc(
      "complete_automation_event",
      {
        p_event_id: eventId,
        p_worker_id: workerId,
        p_succeeded: succeeded,
        p_error: failureMessage
      }
    );
    if (error) throw new Error(error.message);
    if (!data) {
      return noStore(
        { error: "Evento non trovato o assegnato a un altro worker." },
        409
      );
    }

    return noStore({ completed: true });
  } catch (error) {
    if (
      error instanceof AutomationConfigurationError ||
      error instanceof SupabaseConfigurationError
    ) {
      return noStore({ error: error.message }, 503);
    }
    console.error("automation_outbox_complete_failed", error);
    return noStore({ error: "Esito automazione non registrato." }, 500);
  }
}
