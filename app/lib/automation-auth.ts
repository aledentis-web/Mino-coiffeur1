import "server-only";

import { timingSafeEqual } from "node:crypto";

function tokensMatch(expected: string, received: string) {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export class AutomationConfigurationError extends Error {
  constructor() {
    super("Automazioni n8n non ancora configurate.");
    this.name = "AutomationConfigurationError";
  }
}

export function isAuthorizedAutomationRequest(request: Request) {
  const expected = process.env.N8N_AUTOMATION_SECRET?.trim();
  if (!expected || expected.length < 32) {
    throw new AutomationConfigurationError();
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;

  return tokensMatch(expected, authorization.slice("Bearer ".length).trim());
}
