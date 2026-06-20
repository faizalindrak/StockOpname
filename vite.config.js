import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.VITE_API_URL || "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    open: true,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/auth": { target: apiTarget, changeOrigin: true },
      "/rest": { target: apiTarget, changeOrigin: true },
      "/rpc": { target: apiTarget, changeOrigin: true },
      "/realtime": { target: apiTarget, changeOrigin: true, ws: true },
    },
  },
});
