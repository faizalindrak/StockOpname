import { WebSocketServer } from "ws";
import { verifyToken } from "./auth.js";
import { getListenClient } from "./db.js";
import { recordMatchesRealtimeFilter } from "./realtimeFilters.js";

const CHANNELS = new Map(); // channelName -> Set<ws>

function broadcast(channel, payload, exceptWs) {
  const subs = CHANNELS.get(channel);
  if (!subs) return;
  const msg = JSON.stringify({ type: "message", channel, payload });
  for (const ws of subs) {
    if (ws === exceptWs) continue;
    if (ws.readyState === 1) ws.send(msg);
  }
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

export function attachRealtime(server) {
  const wss = new WebSocketServer({ server, path: "/realtime" });

  wss.on("connection", (ws, req) => {
    ws.user = null;
    ws.subscriptions = new Set();
    ws.broadcastChannels = new Set();

    // First message must be "phx_join" style or a direct join; we use a simple
    // protocol: { type: "auth", token } then { type: "subscribe", channel, filter }.
    ws.on("message", async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === "auth") {
        const payload = await verifyToken(msg.token);
        if (payload) {
          ws.user = payload;
          send(ws, { type: "auth_ok" });
        } else {
          send(ws, { type: "error", error: "invalid_token" });
          ws.close();
        }
        return;
      }
      if (msg.type === "subscribe") {
        const { channel, table, event, filter } = msg;
        const subKey = `${channel}:${table || ""}:${event || "*"}:${filter || ""}`;
        ws.subscriptions.add(subKey);
        if (!CHANNELS.has(channel)) CHANNELS.set(channel, new Set());
        CHANNELS.get(channel).add(ws);
        send(ws, { type: "subscribed", channel });
        return;
      }
      if (msg.type === "unsubscribe") {
        const { channel } = msg;
        const set = CHANNELS.get(channel);
        if (set) set.delete(ws);
        ws.subscriptions.clear();
        send(ws, { type: "unsubscribed", channel });
        return;
      }
      if (msg.type === "broadcast") {
        const { channel, event, payload } = msg;
        broadcast(channel, { event, payload, sender: ws.user }, ws);
        return;
      }
      if (msg.type === "presence") {
        const { channel, state } = msg;
        broadcast(channel, { event: "presence", payload: { state, user: ws.user } }, ws);
        return;
      }
    });

    ws.on("close", () => {
      for (const ch of CHANNELS.keys()) {
        CHANNELS.get(ch)?.delete(ws);
      }
    });
  });

  // Wire LISTEN/NOTIFY for postgres_changes-style subscriptions.
  startPgListener(wss);
}

async function startPgListener(wss) {
  const client = await getListenClient();
  client.on("notification", (msg) => {
    // msg.channel is the relation name; msg.payload is JSON {event,new,old,table}
    let payload;
    try { payload = JSON.parse(msg.payload); } catch { return; }
    const table = payload.table || msg.channel;
    const event = payload.event;
    const data = { eventType: event === "INSERT" ? "INSERT" : event === "UPDATE" ? "UPDATE" : event === "DELETE" ? "DELETE" : event, new: payload.new, old: payload.old, table };
    for (const ws of wss.clients) {
      if (ws.readyState !== 1) continue;
      for (const sub of ws.subscriptions) {
        if (sub.includes(`:${table}:`)) {
          if (sub.includes(":INSERT") && event !== "INSERT") continue;
          if (sub.includes(":UPDATE") && event !== "UPDATE") continue;
          if (sub.includes(":DELETE") && event !== "DELETE") continue;
          const filterStr = sub.split(":").pop();
          if (filterStr && !filterStr.startsWith("*")) {
            const rec = data.new || data.old || {};
            if (!recordMatchesRealtimeFilter(filterStr, rec)) continue;
          }
          send(ws, { type: "postgres_changes", table, payload: data });
        }
      }
    }
  });
  // Listen for a curated set of tables. Add more here as needed.
  const tables = [
    "items", "categories", "locations", "profiles", "sessions",
    "session_items", "session_users", "counts", "item_groups",
    "item_group_items", "report_status_raw_mat",
  ];
  for (const t of tables) {
    await client.query(`LISTEN ${t}_changes`);
  }
}
