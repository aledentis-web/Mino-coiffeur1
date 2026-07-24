import { createClient } from "@supabase/supabase-js";

if (!process.env.VERCEL) {
  console.log("Vercel environment check skipped outside Vercel.");
  process.exit(0);
}

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "STUDIO_BARBER_ADMIN_PASSWORD"
];
const missing = required.filter((key) => !process.env[key]?.trim());

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

const businessSlug =
  process.env.STUDIO_BARBER_BUSINESS_SLUG?.trim() || "studio-barber-8";
const { count, error } = await supabase
  .from("businesses")
  .select("id", { count: "exact", head: true })
  .eq("slug", businessSlug);

if (error) {
  throw new Error(`Supabase server connection failed: ${error.message}`);
}

if (count !== 1) {
  throw new Error(
    `Configured business slug ${JSON.stringify(businessSlug)} did not match exactly one business.`
  );
}

console.log("Vercel environment and Supabase server connection verified.");
