/**
 * Stand-in for the photo library, so the picking rules can be driven from a
 * test: what happens when permission is refused, when it is refused for good,
 * when they back out, and what an asset with no filename is called.
 *
 * Tests set `__picker` before importing what they are testing.
 */
const g = globalThis as any;
g.__picker ??= { permission: { granted: true, canAskAgain: true }, result: { canceled: true }, launched: [] as any[] };

export interface ImagePickerAsset {
  uri: string; fileName?: string | null; mimeType?: string | null; fileSize?: number; type?: string | null;
}

/** Set `__picker.native = false` to behave like a build without the native half. */
function bridge() {
  if (g.__picker.native === false) {
    throw new Error("Cannot find native module 'ExponentImagePicker'");
  }
}

export async function requestMediaLibraryPermissionsAsync() {
  bridge();
  return g.__picker.permission;
}

export async function launchImageLibraryAsync(options: any) {
  bridge();
  g.__picker.launched.push(options);
  return g.__picker.result;
}
