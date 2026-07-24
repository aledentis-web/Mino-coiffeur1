import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE,
  createAdminSessionToken,
  isAdminConfigured,
  verifyAdminPassword
} from "../../../lib/admin-auth";

export const runtime = "nodejs";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: Request) {
  if (!isAdminConfigured()) {
    return noStore({ error: "Accesso gestionale non ancora configurato." }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStore({ error: "Richiesta non valida." }, 400);
  }

  const password =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).password
      : null;

  if (!verifyAdminPassword(password)) {
    return noStore({ error: "Password non corretta." }, 401);
  }

  const response = noStore({ ok: true });
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: createAdminSessionToken(),
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE
  });
  return response;
}

export async function DELETE() {
  const response = noStore({ ok: true });
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
  return response;
}
