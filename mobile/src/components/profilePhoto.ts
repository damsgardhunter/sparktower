/**
 * Picks a photo and uploads it, for the profile's avatar and cover.
 *
 * From the phone's photos, not from Files: this used the document picker
 * filtered to images, on the belief that iOS would offer Photos behind it. It
 * does not — it offers iCloud Drive — so "change your picture" meant
 * exporting one first. See mobile/src/photos.ts.
 */
import { pickPhoto } from "../photos";
import { uploadFile } from "../api/client";

/** Resolves to the uploaded object path, or null if they cancelled. */
export async function pickAndUploadImage(): Promise<string | null> {
  const file = await pickPhoto();
  if (!file) return null;
  if (file.size && file.size > 10 * 1024 * 1024) throw new Error("That photo is over 10MB.");
  return uploadFile(file);
}
