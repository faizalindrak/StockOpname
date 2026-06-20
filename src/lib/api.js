export { http, getToken, setToken, onTokenChange } from "./db/http.js";
export { supabase } from "./db/compat.js";

export const handleSupabaseError = (error) => {
  console.error("API error:", error);
  if (error?.message) throw new Error(error.message);
  throw error;
};

export { getCurrentUserProfile } from "./services/profiles.js";
export { checkCategoryUsage } from "./services/categories.js";
export {
  checkLocationUsage,
  softDeleteLocation,
  reactivateLocation,
} from "./services/locations.js";
export {
  getReportStatusRecords,
  createReportStatusRecord,
  updateReportStatusRecord,
  deleteReportStatusRecord,
  getReportStatusStats,
} from "./services/reports.js";