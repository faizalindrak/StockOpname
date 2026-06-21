import { createApp } from "./app.js";
import { createDurableObjectPublisher } from "./realtimePublisher.js";
import { RealtimeDurableObject } from "./realtimeDo.js";
import { createWorkerDb } from "./workerDb.js";

export { RealtimeDurableObject };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/realtime") {
      const id = env.REALTIME.idFromName("global");
      return env.REALTIME.get(id).fetch(request);
    }

    const app = createApp({
      env,
      db: createWorkerDb(env),
      realtime: createDurableObjectPublisher(env),
    });
    return app.fetch(request, env, ctx);
  },
};
