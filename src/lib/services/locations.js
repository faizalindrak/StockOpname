import { supabase } from "../db/compat.js";

export async function checkLocationUsage(locationId) {
  const { data: counts = [] } = await supabase.from("counts").select("id, session_id, item_id, counted_qty, timestamp").eq("location_id", locationId);
  const { data: location } = await supabase.from("locations").select("id, name, category_id, is_active").eq("id", locationId).single();
  const { data: category } = await supabase.from("categories").select("name").eq("id", location.category_id).single();
  return {
    location: location.name,
    category: category.name,
    countRecords: counts.length,
    sessions: [...new Set(counts.map((c) => c.session_id))],
    isActive: location.is_active,
    canModify: counts.length === 0,
    counts,
  };
}

export async function softDeleteLocation(locationId, userId) {
  return (await supabase.rpc("soft_delete_location", { location_id_param: locationId, user_id_param: userId })).data;
}

export async function reactivateLocation(locationId) {
  return (await supabase.rpc("reactivate_location", { location_id_param: locationId })).data;
}