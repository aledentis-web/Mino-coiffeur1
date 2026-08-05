import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AssistantControlPanel } from "../../components/assistant-control-panel";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken
} from "../../lib/admin-auth";

export default async function AssistantControlPage() {
  const cookieStore = await cookies();
  if (
    !verifyAdminSessionToken(
      cookieStore.get(ADMIN_SESSION_COOKIE)?.value
    )
  ) {
    redirect("/admin/login");
  }

  return <AssistantControlPanel />;
}
