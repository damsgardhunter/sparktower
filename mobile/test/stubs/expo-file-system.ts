/**
 * `expo-file-system`, for Node.
 *
 * Enough to import `src/saveImage.ts` and to drive it: a test can replace
 * `downloadAsync` to say what the server answered without a network or a disk.
 */
export const cacheDirectory = "file:///tmp/test-cache/";
export const documentDirectory = "file:///tmp/test-docs/";
export const downloadAsync = async (_url: string, to: string) => ({ status: 200, uri: to, headers: {} });
export const deleteAsync = async (_uri: string, _opts?: unknown) => {};
export const getInfoAsync = async (_uri: string) => ({ exists: false });
