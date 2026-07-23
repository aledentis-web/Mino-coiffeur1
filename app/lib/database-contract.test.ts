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
