import { defineConfig } from "vitest/config";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * The skin is mounted at run time on the server (/skin.css, its fonts at
 * /fonts/skin/; solid-kit ADR 011), never built in. In dev, serve the same
 * files from a design-system checkout: DESIGN_SYSTEM, default
 * ../mom-design-system. Absent, both 404 and the kit's look holds, as on a
 * server with no skin mounted.
 */
type Middlewares = {
  use(fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): void;
};

// Untyped as a Plugin on purpose: vitest bundles its own vite, whose Plugin
// type the installed vite's does not satisfy.
function devSkin() {
  const ds = resolve(process.env.DESIGN_SYSTEM ?? resolve(import.meta.dirname, "../mom-design-system"));
  return {
    name: "dev-skin",
    apply: "serve" as const,
    configureServer(server: { middlewares: Middlewares }) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        const file =
          url === "/skin.css"
            ? resolve(ds, "skins/kit/skin.css")
            : url.startsWith("/fonts/skin/")
              ? resolve(ds, "tokens/fonts", url.slice("/fonts/skin/".length))
              : null;
        if (!file) return next();
        if (!file.startsWith(ds) || !existsSync(file)) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : "font/woff2");
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  plugins: [devSkin()],
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
