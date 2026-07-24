import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260724220500_automation_outbox.sql",
    import.meta.url
  ),
  "utf8"
);

test("l'outbox è isolato dal browser e riservato al service role", () => {
  assert.match(
    migration,
    /alter table public\.automation_events enable row level security;/
  );
  assert.match(
    migration,
    /create policy automation_events_deny_client_access[\s\S]*?using \(false\)[\s\S]*?with check \(false\);/
  );
  assert.match(
    migration,
    /revoke all on public\.automation_events[\s\S]*?from public, anon, authenticated;/
  );
  assert.match(
    migration,
    /grant select, insert, update, delete on public\.automation_events[\s\S]*?to service_role;/
  );
});

test("gli eventi vengono reclamati in modo concorrente e riprovati", () => {
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /event\.locked_at < now\(\) - interval '15 minutes'/);
  assert.match(migration, /make_interval\([\s\S]*?power\(2,/);
});

test("le RPC n8n non sono esposte ad anon o utenti autenticati", () => {
  assert.match(
    migration,
    /revoke all on function public\.claim_automation_events[\s\S]*?from public, anon, authenticated;/
  );
  assert.match(
    migration,
    /grant execute on function public\.claim_automation_events[\s\S]*?to service_role;/
  );
  assert.match(
    migration,
    /revoke all on function public\.complete_automation_event[\s\S]*?from public, anon, authenticated;/
  );
});
