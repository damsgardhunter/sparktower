/**
 * Enough of `expo-notifications` to import `src/push.ts` in Node.
 *
 * The module calls `setNotificationHandler` at import time — it has to, because
 * a notification can arrive before any screen has mounted — so without this
 * stand-in the first test that imports anything reaching `src/push.ts` crashes
 * on the import rather than on anything it meant to check. `AuthContext` reaches
 * it, which makes that a short walk from most of the app.
 *
 * Deliberately inert: every call records nothing and resolves. A test that wants
 * to drive push should spy on these.
 */
export const setNotificationHandler = (_handler: unknown) => {};
export const setNotificationChannelAsync = async (_id: string, _channel: unknown) => {};
export const getPermissionsAsync = async () => ({ status: "undetermined", canAskAgain: true });
export const requestPermissionsAsync = async () => ({ status: "undetermined", canAskAgain: true });
export const getExpoPushTokenAsync = async (_opts: unknown) => ({ data: "" });
export const getLastNotificationResponseAsync = async () => null;
export const addNotificationResponseReceivedListener = (_fn: unknown) => ({ remove: () => {} });
export const AndroidImportance = { DEFAULT: 3, HIGH: 4, MAX: 5 } as const;
