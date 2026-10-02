/**
 * `expo-device`, for Node.
 *
 * `isDevice` is false, which is the honest answer for a test runner and the one
 * the code already handles: a simulator has no push service behind it, so
 * registration declines rather than erroring.
 */
export const isDevice = false;
export const deviceName = "test";
