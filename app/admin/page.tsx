import { cookies } from "next/headers";
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

  return <AdminDashboard />;
}
