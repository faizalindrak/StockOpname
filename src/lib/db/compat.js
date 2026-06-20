import { http, getToken, setToken, onTokenChange, WS_BASE } from "./http.js";

class QueryBuilder {
  constructor(table) {
    this.table = table;
    this._select = "*";
    this._filters = [];
    this._order = null;
    this._range = null;
    this._single = false;
    this._or = null;
  }
  select(cols = "*") { this._select = cols; return this; }
  eq(col, val) { this._filters.push(`${col}.eq.${val}`); return this; }
  neq(col, val) { this._filters.push(`${col}.neq.${val}`); return this; }
  in(col, arr) { this._filters.push(`${col}.in.${arr.join(",")}`); return this; }
  gt(col, val) { this._filters.push(`${col}.gt.${val}`); return this; }
  gte(col, val) { this._filters.push(`${col}.gte.${val}`); return this; }
  lt(col, val) { this._filters.push(`${col}.lt.${val}`); return this; }
  lte(col, val) { this._filters.push(`${col}.lte.${val}`); return this; }
  like(col, val) { this._filters.push(`${col}.like.${val}`); return this; }
  ilike(col, val) { this._filters.push(`${col}.ilike.${val}`); return this; }
  or(expr) { this._or = expr; return this; }
  order(col, opts = {}) {
    this._order = opts.ascending === false ? `-${col}` : col;
    return this;
  }
  range(from, to) { this._range = { offset: from, limit: to - from + 1 }; return this; }
  limit(n) { this._range = { offset: this._range?.offset || 0, limit: n }; return this; }
  single() { this._single = true; return this; }
  async then(resolve, reject) {
    try {
      const query = {};
      if (this._select !== "*") query.select = this._select;
      for (const f of this._filters) {
        const [col, op, ...rest] = f.split(".");
        const val = rest.join(".");
        const key = `${col}.${op}`;
        if (query[key]) {
          if (Array.isArray(query[key])) query[key].push(val);
          else query[key] = [query[key], val];
        } else {
          query[key] = val;
        }
      }
      if (this._or) query.or = this._or;
      if (this._order) query.order = this._order;
      if (this._range) { query.offset = this._range.offset; query.limit = this._range.limit; }
      const res = await http(`/rest/${this.table}`, { query });
      const data = this._single ? (res.data?.[0] || null) : (res.data || []);
      resolve({ data, error: res.error || null, count: res.count });
    } catch (e) { reject({ data: null, error: { message: e.message, code: e.status } }); }
  }
}

class InsertBuilder {
  constructor(table, rows) { this.table = table; this.rows = rows; this._select = "*"; }
  select(cols = "*") { this._select = cols; return this; }
  single() { this._single = true; return this; }
  async then(resolve, reject) {
    try {
      const res = await http(`/rest/${this.table}`, { method: "POST", body: this.rows });
      let data = res.data || [];
      if (this._single) data = data[0] || null;
      resolve({ data, error: res.error || null });
    } catch (e) { reject({ data: null, error: { message: e.message } }); }
  }
}

class UpdateBuilder {
  constructor(table, updates) { this.table = table; this.updates = updates; this._filters = []; }
  eq(col, val) { this._filters.push(`${col}.eq.${val}`); return this; }
  neq(col, val) { this._filters.push(`${col}.neq.${val}`); return this; }
  in(col, arr) { this._filters.push(`${col}.in.${arr.join(",")}`); return this; }
  match(obj) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
  select() { return this; }
  single() { this._single = true; return this; }
  async then(resolve, reject) {
    try {
      const query = {};
      for (const f of this._filters) {
        const [col, op, ...rest] = f.split(".");
        const val = rest.join(".");
        query[`${col}.${op}`] = val;
      }
      const res = await http(`/rest/${this.table}`, { method: "PATCH", body: this.updates, query });
      const data = this._single ? (res.data?.[0] || null) : (res.data || []);
      resolve({ data, error: res.error || null });
    } catch (e) { reject({ data: null, error: { message: e.message } }); }
  }
}

class DeleteBuilder {
  constructor(table) { this.table = table; this._filters = []; }
  eq(col, val) { this._filters.push(`${col}.eq.${val}`); return this; }
  in(col, arr) { this._filters.push(`${col}.in.${arr.join(",")}`); return this; }
  async then(resolve, reject) {
    try {
      const query = {};
      for (const f of this._filters) {
        const [col, op, ...rest] = f.split(".");
        const val = rest.join(".");
        query[`${col}.${op}`] = val;
      }
      const res = await http(`/rest/${this.table}`, { method: "DELETE", query });
      resolve({ data: res.data, error: res.error || null });
    } catch (e) { reject({ data: null, error: { message: e.message } }); }
  }
}

class RpcBuilder {
  constructor(fn, args) { this.fn = fn; this.args = args || {}; }
  async then(resolve, reject) {
    try {
      const res = await http(`/rest/rpc/${this.fn}`, { method: "POST", body: this.args });
      resolve({ data: res.data, error: res.error || null });
    } catch (e) { reject({ data: null, error: { message: e.message } }); }
  }
}

class Channel {
  constructor(name, opts = {}) {
    this.name = name;
    this.opts = opts;
    this._handlers = [];
    this._ws = null;
    this._closed = false;
  }
  on(event, filter, handler) {
    if (typeof filter === "function") { handler = filter; filter = {}; }
    this._handlers.push({ event, filter, handler });
    return this;
  }
  subscribe(cb) {
    this._ws = new WebSocket(`${WS_BASE}/realtime`);
    this._ws.onopen = () => {
      const tok = getToken();
      this._ws.send(JSON.stringify({ type: "auth", token: tok }));
      for (const h of this._handlers) {
        if (h.event === "postgres_changes") {
          this._ws.send(JSON.stringify({
            type: "subscribe",
            channel: this.name,
            table: h.filter.table,
            event: h.filter.event,
            filter: h.filter.filter,
          }));
        }
      }
      if (cb) cb("SUBSCRIBED");
    };
    this._ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "postgres_changes") {
        for (const h of this._handlers) {
          if (h.event !== "postgres_changes") continue;
          if (h.filter.table && h.filter.table !== msg.table) continue;
          h.handler(msg.payload);
        }
      } else if (msg.type === "message") {
        const p = msg.payload || {};
        for (const h of this._handlers) {
          if (h.event === "broadcast" && p.event === (h.filter?.event || p.event)) {
            h.handler({ payload: p.payload, event: p.event });
          }
        }
      }
    };
    this._ws.onerror = () => { if (cb) cb("CHANNEL_ERROR"); };
    this._ws.onclose = () => { if (!this._closed && cb) cb("CLOSED"); };
    return this;
  }
  send(event, payload) {
    if (this._ws && this._ws.readyState === 1) {
      this._ws.send(JSON.stringify({ type: "broadcast", channel: this.name, event, payload }));
    }
  }
  track(state) {
    if (this._ws && this._ws.readyState === 1) {
      this._ws.send(JSON.stringify({ type: "presence", channel: this.name, state }));
    }
    return Promise.resolve();
  }
  unsubscribe() {
    this._closed = true;
    if (this._ws) { try { this._ws.close(); } catch {} }
  }
}

class SupabaseCompat {
  from(table) {
    return {
      select: (cols = "*") => { const q = new QueryBuilder(table); q.select(cols); return q; },
      insert: (rows) => new InsertBuilder(table, rows),
      update: (updates) => new UpdateBuilder(table, updates),
      delete: () => new DeleteBuilder(table),
    };
  }
  rpc(fn, args) { return new RpcBuilder(fn, args); }
  channel(name, opts = {}) { return new Channel(name, opts); }
  removeChannel(ch) { if (ch && typeof ch.unsubscribe === "function") ch.unsubscribe(); }

  auth = {
    getSession: async () => {
      const tok = getToken();
      if (!tok) return { data: { session: null }, error: null };
      try {
        const res = await http("/auth/me");
        return { data: { session: { access_token: tok, user: res.data?.user } }, error: null };
      } catch (e) {
        setToken(null);
        return { data: { session: null }, error: { message: e.message } };
      }
    },
    getUser: async () => {
      const tok = getToken();
      if (!tok) return { data: { user: null }, error: null };
      const res = await http("/auth/me");
      return { data: { user: res.data?.user }, error: null };
    },
    signInWithPassword: async ({ email, password }) => {
      const res = await http("/auth/signin", { method: "POST", body: { email, password } });
      if (res.data?.session?.access_token) setToken(res.data.session.access_token);
      return { data: res.data, error: res.error || null };
    },
    signUp: async ({ email, password, name, username, role, status, options }) => {
      const res = await http("/auth/signup", {
        method: "POST",
        body: { email, password, name, username, role, status, ...(options ? { options } : {}) },
      });
      if (res.data?.session?.access_token) setToken(res.data.session.access_token);
      return { data: res.data, error: res.error || null };
    },
    signOut: async () => {
      setToken(null);
      return { error: null };
    },
    onAuthStateChange: (cb) => {
      const unsub = onTokenChange((token) => {
        cb(token ? "SIGNED_IN" : "SIGNED_OUT", token ? { access_token: token } : null);
      });
      return { data: { subscription: { unsubscribe: unsub } } };
    },
  };
}

export const supabase = new SupabaseCompat();