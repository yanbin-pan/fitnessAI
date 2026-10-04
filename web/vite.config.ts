import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      useCredentials: true,
      includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png"],
      manifest: {
        name: "fitnessAI",
        short_name: "fitnessAI",
        description: "Food, training and goals logbook with an AI coach",
        start_url: "/day/today",
        scope: "/",
        display: "standalone",
        background_color: "#e4e9f0",
        theme_color: "#e4e9f0",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        // Never answer these from the cache: the API, Cloudflare Access's own
        // endpoints, and the sign-in navigation, which must reach the network so
        // Access can show its login page (spec §11.3).
        navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//, /[?&]reauth=/],
      },
    }),
  ],
  server: { proxy: { "/api": "http://127.0.0.1:8080" } },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], include: ["src/**/*.test.{ts,tsx}"] },
});
