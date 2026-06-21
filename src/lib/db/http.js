const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

function tokenKey() { return "stockopname_token"; }

const authListeners = new Set();

export function getToken() { return localStorage.getItem(tokenKey()); }

export function onTokenChange(fn) {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

export function setToken(t) {
  if (t) localStorage.setItem(tokenKey(), t);
  else localStorage.removeItem(tokenKey());
  const cur = getToken();
  authListeners.forEach((fn) => fn(cur));
}

export async function http(path, { method = "GET", body, query, headers = {} } = {}) {
  const url = new URL(API_BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v == null) continue;
      if (Array.isArray(v)) v.forEach((vv) => url.searchParams.append(k, String(vv)));
      else url.searchParams.append(k, String(v));
    }
  }
  const tok = getToken();
  const res = await fetch(url.toString(), {
    method,
    headers: {
      "content-type": "application/json",
      ...(tok ? { authorization: `Bearer ${tok}` } : {}),
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const message = json?.error || json?.message || res.statusText;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return json;
}

export const WS_BASE = API_BASE.replace(/^http/, "ws");