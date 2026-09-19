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
  /*
   * An empty PostCSS config, given inline.
   *
   * `test.css: false` says "don't process stylesheets", and it isn't enough:
   * Vite still *looks* for a PostCSS config before deciding there is nothing to
   * do, walks up out of this package, finds the web app's at the repository
   * root and tries to load Tailwind — which mobile doesn't install. Green on a
   * laptop where the root's node_modules is right there, red in CI where the
   * mobile job installs only its own dependencies. Handing Vite a config stops
   * the search.
   */
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    /*
     * No CSS pipeline. These are Node tests with no stylesheet in sight, but
     * Vitest looks upward for a PostCSS config and finds the web app's at the
     * repository root — then fails to load Tailwind, which this package
     * doesn't install. Green here, red in CI, where mobile installs only its
     * own dependencies.
     */
    css: false,
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    restoreMocks: true,
  },
  resolve: {
    alias: {
      "react-native": stub("react-native"),
      "expo-constants": stub("expo-constants"),
      "expo-secure-store": stub("expo-secure-store"),
      "expo-linking": stub("expo-linking"),
    },
  },
});
