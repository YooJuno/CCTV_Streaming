import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const backendTarget = process.env.VITE_PROXY_TARGET || "http://127.0.0.1:8081";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    // changeOrigin rewrites Host but not Origin, so the browser's Origin
    // (e.g. http://<public-ip>:5174) reached Spring and was rejected as a disallowed
    // CORS origin -- even though the browser itself saw a same-origin request through
    // this proxy. Presenting the backend's own origin keeps these hops non-CORS, so
    // remote access no longer depends on listing every host in API_ALLOWED_ORIGINS.
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: true,
        headers: { Origin: backendTarget },
      },
      "/hls": {
        target: backendTarget,
        changeOrigin: true,
        headers: { Origin: backendTarget },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.ts",
    css: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
