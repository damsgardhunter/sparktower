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
