/**
 * A file name a person can find again, in characters a header can carry.
 *
 * `Content-Disposition` is a latin-1 header. Node *refuses* to set one holding a
 * character outside that range rather than mangling it, so the request answers
 * 500 — which is how the path export's download broke on the em dash in "Quill &
 * Co — Systemize a business". Project names are full of em dashes, apostrophes
 * and emoji, and every name here comes from one.
 *
 * Same shape as `exportFileName` in server/path-export.ts and `safeFileName` in
 * server/document-routes.ts — lowercase, hyphens, word characters only — so a
 * file saved from any of them looks like the others in a downloads folder.
 *
 * It is also the only thing standing between a query parameter and a response
 * header: the client says what to call the file, so a name carrying a newline
 * would otherwise be header injection. Stripping to `\w`, spaces and hyphens
 * leaves nothing that can end a header line.
 */
export function downloadName(raw: unknown, extension: string, fallback = "image"): string {
  const base = String(raw ?? "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const ext = String(extension ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return `${base || fallback}${ext ? `.${ext}` : ""}`;
}

/** The extension for an image type, for naming a file that is about to be saved. */
export function extensionFor(contentType: string | null | undefined): string {
  const type = String(contentType ?? "").toLowerCase().split(";")[0].trim();
  switch (type) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    case "image/svg+xml": return "svg";
    case "application/pdf": return "pdf";
    /*
     * No guess. A file saved as `.png` that is not a PNG is worse than one with
     * no extension: the operating system opens it with something that then says
     * the file is corrupt.
     */
    default: return "";
  }
}
