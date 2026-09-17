import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The mobile app's own tests: the logic that doesn't need a screen — the API
 * client's refresh and visit rules, the project and section rules — run in
 * Node. React Native and the Expo native modules are replaced with small
 * stand-ins (test/stubs), so a test can drive the platform, the stored
 * tokens and the app config the client reads.
 */
const stub = (name: string) => fileURLToPath(new URL(`./test/stubs/${name}.ts`, import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    // Nothing here imports a stylesheet, so none needs processing.
    css: false,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    restoreMocks: true,
  },
  /*
   * An empty PostCSS config, given inline.
   *
   * Vite resolves PostCSS by searching upward from its root, so from `mobile/`
   * it finds the web app's config at the repository root and tries to load
   * Tailwind — which this package doesn't install. That was green locally,
   * where the root's `node_modules` is right there, and red in CI, where the
   * mobile job installs only its own dependencies.
   *
   * `test.css: false` does NOT prevent this, which is the trap: it turns off
   * processing stylesheets for the tests, while the config search happens
   * earlier, when Vite resolves its own config. Passing `postcss` explicitly
   * is what stops the search — there is nothing to look for.
   */
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: {
      "react-native": stub("react-native"),
      "expo-constants": stub("expo-constants"),
      "expo-secure-store": stub("expo-secure-store"),
      "expo-linking": stub("expo-linking"),
    },
  },
});
