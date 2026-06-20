import { supabase } from "../db/compat.js";

export async function getReportStatusRecords(filters = {}) {
  let q = supabase.from("report_status_raw_mat").select("*");
  if (filters.date_input) q = q.eq("date_input", filters.date_input);
  if (filters.inventory_status) q = q.eq("inventory_status", filters.inventory_status);
  if (filters.follow_up_status) q = q.eq("follow_up_status", filters.follow_up_status);
  if (filters.user_report) q = q.eq("user_report", filters.user_report);
  q = q.order("created_at", { ascending: false });
  return (await q).data || [];
}

export async function createReportStatusRecord(recordData) {
  const r = await supabase.from("report_status_raw_mat").insert([recordData]).select();
  return r.data?.[0] || null;
}

export async function updateReportStatusRecord(id, updateData) {
  const r = await supabase.from("report_status_raw_mat").update(updateData).eq("id", id).select();
  return r.data?.[0] || null;
}

export async function deleteReportStatusRecord(id) {
  await supabase.from("report_status_raw_mat").delete().eq("id", id);
  return true;
}

export async function getReportStatusStats(date_input) {
  let q = supabase.from("report_status_raw_mat").select("inventory_status, follow_up_status");
  if (date_input) q = q.eq("date_input", date_input);
  const { data = [] } = await q;
  return {
    total: data.length,
    by_inventory_status: {
      kritis: data.filter((d) => d.inventory_status === "kritis").length,
      over: data.filter((d) => d.inventory_status === "over").length,
    },
    by_follow_up_status: {
      open: data.filter((d) => d.follow_up_status === "open").length,
      on_progress: data.filter((d) => d.follow_up_status === "on_progress").length,
      closed: data.filter((d) => d.follow_up_status === "closed").length,
    },
  };
}