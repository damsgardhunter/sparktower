/**
 * Picks a photo and uploads it, for the profile's avatar and cover.
 *
 * The app has no image picker dependency, so this uses the document picker
 * filtered to images — on iOS that still offers Photos, and it streams the
 * file the same way the résumé upload does.
 */
import * as DocumentPicker from "expo-document-picker";
import { uploadFile } from "../api/client";

/** Resolves to the uploaded object path, or null if they cancelled. */
export async function pickAndUploadImage(): Promise<string | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: ["image/*"], copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const file = picked.assets[0];
  if (file.size && file.size > 10 * 1024 * 1024) throw new Error("That photo is over 10MB.");
  return uploadFile({ uri: file.uri, name: file.name, mimeType: file.mimeType || "image/jpeg", size: file.size });
}
