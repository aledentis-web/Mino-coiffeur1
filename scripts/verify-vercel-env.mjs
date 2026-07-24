import { createClient } from "@supabase/supabase-js";

if (!process.env.VERCEL) {
  console.log("Vercel environment check skipped outside Vercel.");
  process.exit(0);
}

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "STUDIO_BARBER_BUSINESS_SLUG",
  "STUDIO_BARBER_RESOURCE_SLUG"
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing Vercel environment variables: ${missing.join(", ")}`);
}

if (!process.env.SUPABASE_SECRET_KEY.startsWith("sb_secret_")) {
  throw new Error("SUPABASE_SECRET_KEY must use a modern sb_secret_ key.");
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const { count, error } = await supabase
  .from("businesses")
  .select("id", { count: "exact", head: true })
  .eq("slug", process.env.STUDIO_BARBER_BUSINESS_SLUG);

if (error) {
  throw new Error(`Supabase server connection failed: ${error.message}`);
}

if (count !== 1) {
  throw new Error(`Expected one configured business, received ${count ?? 0}.`);
}

console.log("Vercel environment and Supabase server connection verified.");
