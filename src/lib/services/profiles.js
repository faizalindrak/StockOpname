import { supabase } from "../db/compat.js";

export async function getCurrentUserProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  try {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    if (error) { console.error("Error fetching user profile:", error); return null; }
    return data;
  } catch {
    return null;
  }
}