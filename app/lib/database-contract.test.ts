import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260723221901_booking_core.sql",
    import.meta.url
  ),
  "utf8"
);

const bookingAgentHardening = readFileSync(
  new URL(
    "../../supabase/migrations/20260804122814_booking_agent_hardening.sql",
    import.meta.url
  ),
  "utf8"
);

test("il database separa ogni record per attività", () => {
  for (const table of [
    "business_members",
    "resources",
    "services",
    "customers",
    "customer_service_profiles",
    "appointments"
  ]) {
    assert.match(
      migration,
      new RegExp(`create table public\\.${table}[\\s\\S]*?business_id uuid not null`)
    );
  }
});

test("il database impedisce sovrapposizioni sulla stessa risorsa", () => {
  assert.match(migration, /exclude using gist \(\s*resource_id with =,/);
  assert.match(
    migration,
    /tstzrange\(starts_at, ends_at, '\[\)'\) with &&/
  );
  assert.match(
    migration,
    /where \(status in \('pending', 'confirmed'\)\)/
  );
});

test("tutte le tabelle operative hanno RLS attiva", () => {
  for (const table of [
    "businesses",
    "business_members",
    "resources",
    "services",
    "customers",
    "customer_service_profiles",
    "appointments"
  ]) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security;`)
    );
  }
});

test("le funzioni pubbliche non sono eseguibili dal browser", () => {
  assert.match(
    migration,
    /revoke all on function public\.get_public_availability[\s\S]*?from public, anon, authenticated;/
  );
  assert.match(
    migration,
    /revoke all on function public\.create_public_booking[\s\S]*?from public, anon, authenticated;/
  );
  assert.match(
    migration,
    /grant execute on function public\.create_public_booking[\s\S]*?to service_role;/
  );
});

test("il booking agent registra eventi inbound univoci e versiona le conversazioni", () => {
  assert.match(
    bookingAgentHardening,
    /provider_message_id text primary key/
  );
  assert.match(
    bookingAgentHardening,
    /status text not null default 'processing'[\s\S]*?'processed'[\s\S]*?'failed'/
  );
  assert.match(
    bookingAgentHardening,
    /add column if not exists version bigint not null default 0/
  );
  assert.match(
    bookingAgentHardening,
    /BOOKING_CONVERSATION_VERSION_CONFLICT/
  );
  assert.match(
    bookingAgentHardening,
    /BOOKING_CONVERSATION_STALE_EVENT/
  );
});

test("le RPC di hardening sono riservate al service role", () => {
  assert.match(
    bookingAgentHardening,
    /alter table public\.booking_inbound_events enable row level security;/
  );
  for (const rpc of [
    "claim_booking_inbound_event",
    "save_booking_conversation",
    "confirm_booking_conversation"
  ]) {
    assert.match(
      bookingAgentHardening,
      new RegExp(`revoke all on function public\\.${rpc}[\\s\\S]*?from public, anon, authenticated;`)
    );
    assert.match(
      bookingAgentHardening,
      new RegExp(`grant execute on function public\\.${rpc}[\\s\\S]*?to service_role;`)
    );
  }
});
