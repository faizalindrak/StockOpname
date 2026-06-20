import { getToken } from "../db/http.js";
import { supabase } from "../db/compat.js";
import { getCurrentUserProfile } from "./profiles.js";

export async function resolveSession() {
  const token = getToken();
  if (!token) return null;

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  const profile = await getCurrentUserProfile();
  if (!profile || profile.status !== "active") {
    await supabase.auth.signOut();
    return null;
  }

  return { user, profile };
}