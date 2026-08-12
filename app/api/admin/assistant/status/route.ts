import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "../../../../lib/admin-request";
import { getAssistantStatus } from "../../../../lib/assistant-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json(
      { error: "Accesso non autorizzato." },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }

  return NextResponse.json(getAssistantStatus(), {
    headers: { "Cache-Control": "no-store" }
  });
}
