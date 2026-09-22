import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  /*
   * The optimiser's cache belongs to this checkout, not to node_modules.
   *
   * Vite keeps pre-bundled dependencies in `node_modules/.vite` by default,
   * and a worktree with node_modules symlinked to the main checkout — which is
   * how several of these are set up, because installing the tree again per
   * worktree is gigabytes — therefore shares one cache between two servers
   * with two different configs. They overwrite each other's pre-bundle, and
   * the page comes back with two copies of React: "Cannot read properties of
   * null (reading 'useMemo')", from a dispatcher that belongs to the other
   * copy. Keeping the cache beside the config rather than inside node_modules
   * gives every checkout its own, symlinked or not.
   */
  cacheDir: path.resolve(import.meta.dirname, ".vite-cache"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
