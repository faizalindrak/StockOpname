import { supabase } from "../db/compat.js";

export async function checkCategoryUsage(categoryId) {
  const { data: category } = await supabase.from("categories").select("name").eq("id", categoryId).single();
  const { data: items = [] } = await supabase.from("items").select("id, item_name, sku").eq("category", category.name);
  const { data: locations = [] } = await supabase.from("locations").select("id, name").eq("category_id", categoryId);
  return {
    category: category.name,
    itemCount: items.length,
    locationCount: locations.length,
    items,
    locations,
    canDelete: items.length === 0 && locations.length === 0,
  };
}