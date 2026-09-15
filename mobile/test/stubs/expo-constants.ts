/**
 * The app config the client reads. Kept on globalThis so a test's changes
 * survive vi.resetModules(), which re-imports this stub along with the client.
 */
const g = globalThis as any;
g.__expoConstants ??= { expoConfig: { extra: { apiUrl: "https://api.sparktower.test" }, hostUri: undefined }, deviceName: "Test iPhone" };
const Constants: { expoConfig: any; deviceName?: string; expoGoConfig?: any } = g.__expoConstants;
export default Constants;
