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
      workerId?: unknown;
      limit?: unknown;
    };
    const workerId =
      typeof body.workerId === "string" ? body.workerId.trim() : "";
    const requestedLimit =
      typeof body.limit === "number" && Number.isInteger(body.limit)
        ? body.limit
        : 20;
    const limit = Math.max(1, Math.min(requestedLimit, 100));

    if (!workerId || workerId.length > 120) {
      return noStore({ error: "workerId non valido." }, 400);
    }

    const { data, error } = await getServerSupabase().rpc(
      "claim_automation_events",
      {
        p_worker_id: workerId,
        p_limit: limit
      }
    );
    if (error) throw new Error(error.message);

    return noStore({ events: data ?? [] });
  } catch (error) {
    if (
      error instanceof AutomationConfigurationError ||
      error instanceof SupabaseConfigurationError
    ) {
      return noStore({ error: error.message }, 503);
    }
    console.error("automation_outbox_claim_failed", error);
    return noStore({ error: "Coda automazioni non disponibile." }, 500);
  }
}
