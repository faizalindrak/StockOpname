import { recordMatchesRealtimeFilter } from "./realtimeFilters.js";
import { verifyWorkerToken } from "./workerAuth.js";

function send(ws, value) {
  try {
    ws.send(JSON.stringify(value));
  } catch {
    // Ignore broken sockets; close handling removes them from the set.
  }
}

function matches(sub, message) {
  if (sub.table && sub.table !== message.table) return false;
  const eventType = message.payload?.eventType;
  if (sub.event && sub.event !== "*" && sub.event !== eventType) return false;
  if (sub.filter) {
    const record = message.payload?.new || message.payload?.old || {};
    return recordMatchesRealtimeFilter(sub.filter, record);
  }
  return true;
}

export class RealtimeDurableObject {
  constructor(state, env) {
    this.env = env;
    this.sockets = new Set();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/broadcast" && request.method === "POST") {
      const message = await request.json();
      this.broadcast(message);
      return new Response(null, { status: 204 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    server.user = null;
    server.subscriptions = [];
    this.sockets.add(server);

    server.addEventListener("message", (event) => this.handleMessage(server, event.data));
    server.addEventListener("close", () => this.sockets.delete(server));
    server.addEventListener("error", () => this.sockets.delete(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  async handleMessage(ws, raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (message.type === "auth") {
      const payload = await verifyWorkerToken(message.token, this.env?.JWT_SECRET);
      if (!payload) {
        send(ws, { type: "error", error: "invalid_token" });
        ws.close();
        return;
      }
      ws.user = payload;
      send(ws, { type: "auth_ok" });
      return;
    }

    if (message.type === "subscribe") {
      ws.subscriptions.push({
        channel: message.channel,
        table: message.table,
        event: message.event || "*",
        filter: message.filter || "",
      });
      send(ws, { type: "subscribed", channel: message.channel });
      return;
    }

    if (message.type === "unsubscribe") {
      ws.subscriptions = message.channel
        ? ws.subscriptions.filter((sub) => sub.channel !== message.channel)
        : [];
      send(ws, { type: "unsubscribed", channel: message.channel });
    }
  }

  broadcast(message) {
    for (const ws of this.sockets) {
      if (!ws.user) continue;
      if (ws.subscriptions.some((sub) => matches(sub, message))) {
        send(ws, { type: "postgres_changes", table: message.table, payload: message.payload });
      }
    }
  }
}
