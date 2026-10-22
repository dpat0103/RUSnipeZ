/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the API runs locally (`rusnipez serve`); /api is proxied to it
// so the browser sees one origin, exactly as it will behind the production host.
// API_PROXY points it elsewhere, e.g. https://ru-snipez.vercel.app for live data.
const apiTarget = process.env.API_PROXY ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
