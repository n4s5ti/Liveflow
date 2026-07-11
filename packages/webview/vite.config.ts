import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Vite config for the Liveflow browser-native dashboard.
 *
 * Builds a standard SPA — the Python backend serves it alongside the WebSocket
 * API on a single port.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
