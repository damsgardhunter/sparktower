/**
 * What a saved picture is called.
 *
 * Its own module, with no imports at all, for one reason: a test in the
 * repository imports it and compares it with `downloadName` in
 * server/download-name.ts, case for case. It cannot do that from
 * `src/saveImage.ts`, which reaches `expo-file-system` and the API client and so
 * only loads inside the app's own test setup.
 *
 * The phone needs a copy because Metro will not resolve `@shared`. The name
 * written locally is what the share sheet shows and the server's is what the file
 * arrives as, so two answers for one picture reads as a bug in whichever is
 * noticed second.
 */
export function fileName(raw: string, extension = "png"): string {
  const base = String(raw ?? "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "image"}.${extension}`;
}
