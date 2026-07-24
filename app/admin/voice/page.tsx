import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { VoiceLab } from "../../components/voice-lab";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken
} from "../../lib/admin-auth";

export default async function VoiceLabPage() {
  const cookieStore = await cookies();
  if (
    !verifyAdminSessionToken(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)
  ) {
    redirect("/admin/login");
  }

  return <VoiceLab />;
}
