/**
 * The database-free parts of the data shape: the URL guard and the
 * code-vs-database comparison. Kept apart so unit tests and anything else
 * that must not touch a database can use them.
 */
import { isIP } from "net";
import type { DataShape } from "@shared/data-shape";

/** Postgres URLs only, to public hosts, with credentials; "self" is handled by the caller. */
export function safeDbUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (isIP(host) && (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === "::1" || /^f[cde]/.test(host))) return null;
  return u;
}

/** Code declares tables (Drizzle pgTable names, model names); the database has tables. Both ways of disagreeing matter. */
export function compareWithCode(shape: DataShape, dataModels: { name: string }[]): DataShape {
  if (shape.error) return shape;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const db = new Set(shape.tables.map((t) => norm(t.name)));
  const code = new Map(dataModels.map((m) => [norm(m.name), m.name]));
  // Drizzle names camelCase in code and snake_case in the DB; compare on letters only, and also singular/plural loosely.
  const has = (set: Set<string>, n: string) => set.has(n) || set.has(n + "s") || set.has(n.replace(/s$/, ""));
  const inCodeNotInDb = [...code.entries()].filter(([n]) => !has(db, n)).map(([, name]) => name).sort();
  const codeSet = new Set(code.keys());
  const inDbNotInCode = shape.tables.map((t) => t.name).filter((n) => !has(codeSet, norm(n))).sort();
  return { ...shape, compare: { inCodeNotInDb, inDbNotInCode } };
}

