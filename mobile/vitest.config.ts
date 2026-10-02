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
      "expo-image-picker": stub("expo-image-picker"),
      "expo-document-picker": stub("expo-document-picker"),
      /*
       * Both reached from `src/push.ts`, which calls `setNotificationHandler`
       * at import time — so a test that imports anything leading there (via
       * AuthContext, for instance) crashes on the import without these.
       */
      "expo-notifications": stub("expo-notifications"),
      "expo-device": stub("expo-device"),
      /*
       * Saving a picture to the phone (src/saveImage.ts). The legacy entry point
       * is aliased as well as the package, because that is the one the module
       * imports — `expo-file-system/legacy` is where the simple
       * download-to-a-path API lives in SDK 54 and later.
       */
      /*
       * The `/legacy` entry first, and that order is load-bearing: Vite matches a
       * string alias as a *prefix*, so the bare key listed first turns
       * `expo-file-system/legacy` into `<stub>.ts/legacy` and the module is not
       * found. `/legacy` is where the download-to-a-path API lives in SDK 54 and
       * later, which is the one src/saveImage.ts imports.
       */
      "expo-file-system/legacy": stub("expo-file-system"),
      "expo-file-system": stub("expo-file-system"),
      "expo-media-library": stub("expo-media-library"),
      "expo-sharing": stub("expo-sharing"),
    },
  },
});
