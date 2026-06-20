// Backwards-compatibility shim — prefer importing from ./db/index.js
export * from "./db/index.js";
export { handleSupabaseError } from "./api.js";