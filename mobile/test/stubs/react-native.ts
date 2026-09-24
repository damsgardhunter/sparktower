/** Just enough of react-native for the logic under test. Tests set Platform.OS; kept on globalThis to survive vi.resetModules(). */
const g = globalThis as any;
g.__rnPlatform ??= { OS: "ios", Version: "18.0" };
export const Platform: { OS: "ios" | "android" | "web"; Version: string } = g.__rnPlatform;
export const AppState = { currentState: "active", addEventListener: () => ({ remove() {} }) };
/** The one call photos.ts makes: sending somebody to the app's own settings screen. */
export const Linking = { openSettings: async () => { g.__openedSettings = true; } };

