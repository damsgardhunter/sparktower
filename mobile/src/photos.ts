/**
 * Picking a photo, from the phone's photos.
 *
 * Every image upload in this app went through the document picker, filtered
 * to image types. The comment that set it up said "on iOS that still offers
 * Photos", and that is not what iOS does: the document picker opens Files, so
 * a person adding a photo to a post was shown iCloud Drive and a Recents list
 * of PDFs, and the picture they had just taken was nowhere in it unless they
 * had thought to save it as a file. The answer to "add a photo" was "go and
 * export it first".
 *
 * So images come from the photo library now, and the document picker keeps
 * the two jobs that really are about files — a project's documents and an
 * applicant's CV.
 *
 * One helper rather than four call sites each asking for permission their own
 * way: a refused permission is the most likely outcome after "cancelled", and
 * it deserves the same sentence everywhere, including what to do about it.
 */
import { Linking, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

/** What an upload needs, in the shape `uploadFile` already takes. */
export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
}

/** Thrown when the library can't be opened; `settings` says whether the phone can be sent to change it. */
export class PhotoAccessError extends Error {
  readonly settings: boolean;
  constructor(message: string, settings: boolean) {
    super(message);
    this.name = "PhotoAccessError";
    this.settings = settings;
  }
}

/** Takes the person to the app's own settings screen, where the permission lives. */
export const openPhotoSettings = () => Linking.openSettings();

/**
 * A name for the file, because the library doesn't always give one.
 *
 * iOS hands back `fileName` for most assets and null for some — a photo
 * pasted from another app, or one shared into the library — and the upload
 * needs something to call it. The extension has to match what is actually
 * being sent, or the object is stored under a name that lies about its type.
 */
function nameFor(asset: ImagePicker.ImagePickerAsset, mimeType: string): string {
  if (asset.fileName) return asset.fileName;
  const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
  return `photo-${Date.now()}.${ext}`;
}

/**
 * Opens the phone's photos and returns what was chosen, or null if they
 * backed out.
 *
 * `videos` is for the one place that takes both (a project's media). Editing
 * is left off: cropping a screenshot to a square is not what somebody adding
 * one to a post came to do, and the server keeps the original either way.
 */
export async function pickPhoto(opts: { videos?: boolean } = {}): Promise<PickedFile | null> {
  /*
   * A build that predates the photo library.
   *
   * The picker is a native module, so a dev build or a TestFlight build made
   * before it was added has the JavaScript half and not the native one — the
   * call throws "Cannot find native module" at the moment it reaches across.
   * Installing the package does not help; only a rebuild does, and somebody
   * on yesterday's binary should not lose the ability to add a picture while
   * they wait for one.
   *
   * Caught rather than predicted, because the JavaScript function exists in
   * that build and answers every question you could ask it beforehand.
   */
  let permission: ImagePicker.PermissionResponse;
  try {
    permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  } catch (err) {
    if (!isMissingNativeModule(err)) throw err;
    return pickFromFiles(opts);
  }
  if (!permission.granted) {
    /*
     * `canAskAgain` false means the system dialog will not appear again, so
     * "allow it when we ask" would be a lie — the only way through is
     * Settings. On Android an outright denial can be permanent in the same
     * way, which is why this asks the permission rather than the platform.
     */
    throw new PhotoAccessError(
      permission.canAskAgain
        ? "SparkTower needs access to your photos to add one."
        : `Photo access is off for SparkTower. Turn it on in ${Platform.OS === "ios" ? "Settings › SparkTower › Photos" : "Settings › Apps › SparkTower › Permissions"}.`,
      !permission.canAskAgain,
    );
  }

  let picked: ImagePicker.ImagePickerResult;
  try {
    picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: opts.videos ? ["images", "videos"] : ["images"],
      allowsMultipleSelection: false,
      /*
       * Full quality. The server keeps a resized copy per width
       * (server/image-derivatives.ts) and serves that, so squeezing it here
       * as well would be two lossy passes to save bytes twice — and the first
       * thing anybody uploads is a screenshot, which shows every one of them.
       */
      quality: 1,
      exif: false,
    });
  } catch (err) {
    if (!isMissingNativeModule(err)) throw err;
    return pickFromFiles(opts);
  }
  if (picked.canceled || !picked.assets?.[0]) return null;

  const asset = picked.assets[0];
  const mimeType = asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg");
  return { uri: asset.uri, name: nameFor(asset, mimeType), mimeType, size: asset.fileSize };
}

/**
 * The error a build without the native half gives.
 *
 * Matched on the message because that is all there is: Expo throws a plain
 * Error from the bridge. Narrow on purpose — anything else is a real failure
 * and belongs to the caller, who will say "couldn't open your photos" rather
 * than silently opening something else.
 */
function isMissingNativeModule(err: unknown): boolean {
  const message = String((err as Error)?.message ?? err);
  return /cannot find native module|native module.*not (found|available)|requireNativeModule|ExponentImagePicker|ExpoImagePicker/i.test(message);
}

/** The old way in, kept for builds that have no photo library to open. */
async function pickFromFiles(opts: { videos?: boolean }): Promise<PickedFile | null> {
  const type = opts.videos
    ? ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/webm"]
    : ["image/*"];
  const picked = await DocumentPicker.getDocumentAsync({ type, copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const file = picked.assets[0];
  return {
    uri: file.uri,
    name: file.name || `photo-${Date.now()}.jpg`,
    mimeType: file.mimeType || "image/jpeg",
    size: file.size ?? undefined,
  };
}
