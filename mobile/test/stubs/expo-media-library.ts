/**
 * `expo-media-library`, for Node.
 *
 * Refuses permission by default, which is the honest answer for a test runner
 * and exercises the fallback the real code has: no to the photo library is not
 * no to the file, so it goes to the share sheet instead.
 */
export const requestPermissionsAsync = async (_writeOnly?: boolean) => ({ granted: false, status: "denied", canAskAgain: true });
export const getPermissionsAsync = async () => ({ granted: false, status: "denied", canAskAgain: true });
export const saveToLibraryAsync = async (_uri: string) => {};
