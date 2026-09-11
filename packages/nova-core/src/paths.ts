/**
 * Is this a path we're willing to write to?
 *
 * Nova writes repository-relative paths, but it writes them from a language
 * model, and "trust it, it's relative" is how an extension ends up writing to
 * `/etc/hosts` or to `../../.ssh/authorized_keys`. Anything absolute, anything
 * that climbs, anything with a drive letter or a null byte is refused.
 *
 * Refused, not repaired. A repaired path lands somewhere the person didn't
 * expect, and the diff they approved was for somewhere else — which is worse
 * than an error, because it looks like it worked.
 */
export function safeRelativePath(raw: string): string | null {
  const cleaned = String(raw ?? "").replace(/\\/g, "/").trim();
  if (!cleaned) return null;
  if (cleaned.includes("\0")) return null;
  if (cleaned.startsWith("/") || cleaned.startsWith("~")) return null;
  // "C:/…" and the UNC "//server/share" form.
  if (/^[a-zA-Z]:/.test(cleaned) || cleaned.startsWith("//")) return null;

  const segments = cleaned.replace(/^\.\//, "").split("/").filter((s) => s !== "" && s !== ".");
  if (!segments.length) return null;
  if (segments.includes("..")) return null;

  return segments.join("/");
}
