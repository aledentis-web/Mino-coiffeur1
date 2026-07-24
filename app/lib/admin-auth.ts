import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "studio_barber_admin";
export const ADMIN_SESSION_MAX_AGE = 60 * 60 * 12;

function safeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function sessionSecret() {
  return process.env.SUPABASE_SECRET_KEY ?? "";
}

export function isAdminConfigured() {
  return Boolean(
    process.env.STUDIO_BARBER_ADMIN_PASSWORD?.trim() && sessionSecret()
  );
}

export function verifyAdminPassword(candidate: unknown) {
  const expected = process.env.STUDIO_BARBER_ADMIN_PASSWORD;
  return (
    typeof candidate === "string" &&
    Boolean(expected) &&
    safeEqual(candidate, expected ?? "")
  );
}

export function createAdminSessionToken() {
  return createHmac("sha256", sessionSecret())
    .update("studio-barber-8:admin:v1")
    .digest("base64url");
}

export function verifyAdminSessionToken(candidate: string | undefined) {
  if (!candidate || !isAdminConfigured()) return false;
  return safeEqual(candidate, createAdminSessionToken());
}
