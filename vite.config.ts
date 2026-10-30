import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  server: {
    // In production the gateway sends /api/ on this host to the map. In dev,
    // the map's own stack (maps_of_making: docker compose, dev override) is
    // on :8080.
    proxy: { "/api": "http://localhost:8080" },
  },
  build: {
    rollupOptions: {
      input: {
        // The app itself.
        main: resolve(import.meta.dirname, "index.html"),
        // The design system, built and deployed alongside it so it has a URL.
        // See docs/manual-tests.md — it is how the theme is checked by eye.
        styleguide: resolve(import.meta.dirname, "styleguide.html"),
        // The UX patterns, running. Same reason: a guideline you can click is
        // one that cannot drift from the components it describes.
        guidelines: resolve(import.meta.dirname, "guidelines.html"),
      },
    },
  },
  test: {
    // The kit's code is browser code; jsdom-free tests stub what they need,
    // but localStorage and DOM globals have to exist for draft.ts.
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
