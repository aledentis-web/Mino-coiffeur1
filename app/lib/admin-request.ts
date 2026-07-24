import "server-only";

import type { NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken
} from "./admin-auth";

export function isAuthorizedAdminRequest(request: NextRequest) {
  return verifyAdminSessionToken(
    request.cookies.get(ADMIN_SESSION_COOKIE)?.value
  );
}
