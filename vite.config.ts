import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Browser client. Built output lands in dist/web and is served by the room server.
export default defineConfig({
  root: "src/web",
  plugins: [react()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
  server: {
    // In dev the Vite server proxies API and WebSocket traffic to the room server.
    proxy: {
      "/api": "http://localhost:3000",
      "/auth": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
