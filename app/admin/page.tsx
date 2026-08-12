import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminDashboard } from "../components/admin-dashboard";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken
} from "../lib/admin-auth";

export default async function AdminPage() {
  const cookieStore = await cookies();
  if (
    !verifyAdminSessionToken(
      cookieStore.get(ADMIN_SESSION_COOKIE)?.value
    )
  ) {
    redirect("/admin/login");
  }

  return (
    <>
      <AdminDashboard />
      <Link
        aria-label="Apri il pannello del segretario digitale"
        href="/admin/assistant"
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          zIndex: 80,
          display: "inline-flex",
          alignItems: "center",
          gap: 9,
          padding: "13px 17px",
          border: "1px solid rgba(255,255,255,.16)",
          borderRadius: 999,
          background: "#111713",
          color: "#d8ff4f",
          boxShadow: "0 16px 44px rgba(17,23,19,.24)",
          fontSize: 12,
          fontWeight: 850,
          letterSpacing: "-.01em"
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "currentColor",
            boxShadow: "0 0 0 4px rgba(216,255,79,.15)"
          }}
        />
        Controlla agente
      </Link>
    </>
  );
}
