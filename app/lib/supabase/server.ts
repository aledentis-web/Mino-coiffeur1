import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export class SupabaseConfigurationError extends Error {
  constructor() {
    super("Supabase non è ancora configurato.");
    this.name = "SupabaseConfigurationError";
  }
}

export function getServerSupabase() {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new SupabaseConfigurationError();
  }

  client = createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return client;
}
