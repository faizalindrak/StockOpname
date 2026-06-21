/** Accepts Supabase (`col=eq.val`) and dot (`col.eq.val`) filter syntax. */
export function recordMatchesRealtimeFilter(filterStr, record) {
  const supabaseEq = filterStr.match(/^([^=]+)=eq\.(.+)$/);
  if (supabaseEq) {
    const [, col, val] = supabaseEq;
    return String(record[col]) === val;
  }
  const [col, op, ...rest] = filterStr.split(".");
  const val = rest.join(".");
  if (op === "eq") return String(record[col]) === val;
  if (op === "neq") return String(record[col]) !== val;
  return true;
}