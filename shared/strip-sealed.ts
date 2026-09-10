/**
 * Fields that must never leave the server, removed from any JSON payload
 * on the way out. Sealed values are still secrets: a ciphertext in a
 * response is a ciphertext in a browser's memory, a log, a crash report.
 * One key today; the list is the point.
 */
export const SEALED_FIELDS = ["dataSource"] as const;

export function stripSealedFields<T>(value: T, depth = 0): T {
  if (depth > 12 || value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => stripSealedFields(v, depth + 1)) as unknown as T;
  if (value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if ((SEALED_FIELDS as readonly string[]).includes(k)) continue;
    out[k] = stripSealedFields(v, depth + 1);
  }
  return out as T;
}
