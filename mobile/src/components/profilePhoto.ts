/**
 * Picks a photo and uploads it, for the profile's avatar and cover.
 *
 * From the phone's photos, not from Files: this used the document picker
 * filtered to images, on the belief that iOS would offer Photos behind it. It
 * does not — it offers iCloud Drive — so "change your picture" meant
 * exporting one first. See mobile/src/photos.ts.
 *
 * ## Why it asks which one
 *
 * Both are shown in a fixed shape, so something has to be cut, and before this
 * the phone cut the middle without asking: the avatar is a circle and the cover
 * is a wide band, and a photo of a person is neither. The web answers this with
 * its own cropper (`client/src/lib/image-crop.ts`, framed 1:1 and 4:1); the
 * phone hands the same job to the native crop UI, which is better than anything
 * worth hand-rolling here and costs no new dependency.
 *
 * The ratios deliberately match the web's `CROP_PRESETS`, so a cover framed on
 * either lands the same way in the band. On iOS the frame is square whatever is
 * asked for — `aspect` is Android-only — which `pickPhoto` explains.
 */
import { pickPhoto } from "../photos";
import { uploadFile } from "../api/client";
import { CROP } from "../profileCrop";

/** Resolves to the uploaded object path, or null if they cancelled. */
export async function pickAndUploadImage(shape: "avatar" | "cover" = "avatar"): Promise<string | null> {
  const file = await pickPhoto({ crop: { aspect: CROP[shape] } });
  if (!file) return null;
  if (file.size && file.size > 10 * 1024 * 1024) throw new Error("That photo is over 10MB.");
  return uploadFile(file);
}
