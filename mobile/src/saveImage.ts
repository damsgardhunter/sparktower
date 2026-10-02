/**
 * Getting a picture Nova drew onto the phone it is being looked at on.
 *
 * Everything the product generates is paid for — a logo, the cover built from
 * it, the visuals drawn from both, a storyboard scene, a badge — and until now
 * there was no way to get any of it off the screen. On a phone "download" means
 * the camera roll: that is where people look for a picture afterwards, and it is
 * what a share sheet's "Save Image" does under the hood.
 *
 * ## Three things this has to get right
 *
 * **The bytes have to be fetched with a session.** Most of these objects carry a
 * private ACL, so the URL alone is a 404. `downloadAsync` takes headers, and the
 * access token goes in one — the same token `api()` uses.
 *
 * **Permission is asked at the tap, not at launch.** Adding to someone's photo
 * library is a permission iOS lets an app ask for once. Asking when they press
 * "Save" is a question with obvious context; asking on first launch is a dialog
 * that gets dismissed and then cannot be re-asked.
 *
 * **A refusal still has a way out.** Somebody who says no to the photo library
 * has not said no to having the file — so the share sheet is offered instead,
 * which puts it in Files, a message, or anywhere else. That path needs no
 * permission at all.
 */
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import { API_URL, getAccessToken } from "./api/client";
import { fileName } from "./imageFileName";

/* Re-exported so a caller needing the name has one import rather than two. */
export { fileName };

export type SaveResult =
  | { ok: true; where: "photos" | "shared" }
  | { ok: false; reason: string };

/**
 * The URL to fetch the bytes from.
 *
 * `download=1` is what makes the server hand over the original rather than a
 * resized copy — a saved logo should be the file, not a thumbnail that happened
 * to be in the cache. `as` only names the file, which matters for the share
 * sheet rather than for us, since the local name is ours either way.
 */
export function downloadUrl(path: string, name: string): string {
  const absolute = path.startsWith("http") ? path : `${API_URL}${path.startsWith("/") ? "" : "/"}${path}`;
  const [base, existing] = absolute.split("?");
  const params = new URLSearchParams(existing ?? "");
  /* A width would be honoured for a view and ignored for a download; drop it anyway. */
  params.delete("w");
  params.set("download", "1");
  params.set("as", name);
  return `${base}?${params.toString()}`;
}

/**
 * Save it to the camera roll, falling back to the share sheet.
 *
 * Never throws: a failure to save a picture is a sentence on the screen, not
 * something that takes a screen down with it.
 */
export async function saveImage(input: { path: string; name: string; extension?: string }): Promise<SaveResult> {
  const local = `${FileSystem.cacheDirectory}${fileName(input.name, input.extension ?? "png")}`;
  try {
    const token = await getAccessToken();
    const { status, uri } = await FileSystem.downloadAsync(
      downloadUrl(input.path, input.name),
      local,
      { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
    );
    if (status !== 200) {
      /*
       * Deleted first. `downloadAsync` writes whatever came back, so a 404's JSON
       * body is now sitting on disk under a .png name — and the share sheet would
       * happily offer it.
       */
      await FileSystem.deleteAsync(local, { idempotent: true }).catch(() => {});
      return { ok: false, reason: status === 404 ? "That image isn't there any more." : "Couldn't fetch that image." };
    }

    const permission = await MediaLibrary.requestPermissionsAsync(/* writeOnly */ true).catch(() => null);
    if (permission?.granted) {
      await MediaLibrary.saveToLibraryAsync(uri);
      return { ok: true, where: "photos" };
    }

    /*
     * No to the photo library is not no to the file. The share sheet needs no
     * permission and reaches Files, a message, a cloud drive — and on iOS it
     * carries its own "Save Image" if they change their mind.
     */
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: input.name });
      return { ok: true, where: "shared" };
    }

    return {
      ok: false,
      reason: Platform.OS === "ios"
        ? "SparkTower can't add to your photos. You can turn that on in Settings."
        : "Couldn't save that image to your photos.",
    };
  } catch (err) {
    console.warn("[saveImage] failed:", err);
    await FileSystem.deleteAsync(local, { idempotent: true }).catch(() => {});
    return { ok: false, reason: "Couldn't save that image." };
  }
}
