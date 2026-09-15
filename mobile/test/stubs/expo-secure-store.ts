/** An in-memory keychain, inspectable from tests, surviving vi.resetModules() like a real one survives a relaunch. */
const g = globalThis as any;
g.__secureStore ??= new Map<string, string>();
export const store: Map<string, string> = g.__secureStore;
export const getItemAsync = async (key: string) => store.get(key) ?? null;
export const setItemAsync = async (key: string, value: string) => { store.set(key, value); };
export const deleteItemAsync = async (key: string) => { store.delete(key); };
