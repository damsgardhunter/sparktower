/**
 * Personal access tokens for the editor bridge, and the guard that spends them.
 *
 * The threat here is different from the web app's. A token lives in a config
 * file on a laptop, gets pasted into a chat window by mistake, and outlives
 * the machine it was made on — so the design assumptions are that it *will*
 * leak eventually and that the person will find out late:
 *
 *  - Only a SHA-256 is stored. A database read gives an attacker nothing.
 *  - It can be pinned to one project, so a token in a repo's config reaches
 *    that repo's project and nothing else in the account.
 *  - `lastUsedAt` is written on every call, so "is this one still in use?" is
 *    answerable before revoking it.
 *  - Revoking is immediate: the guard reads the row every request. No cache,
 *    because a five-minute stale window on a leaked credential is exactly the
 *    five minutes that matters.
 */
import crypto from "node:crypto";
import type { RequestHandler } from "express";
import { eq, and, isNull, desc } from "drizzle-orm";
import { db } from "./db";
import { mcpTokens } from "@shared/schema";

/** Recognisable in a log or a leaked gist, which is the point of a prefix. */
const TOKEN_PREFIX = "nova_pat_";
/** Shown in the token list so a row can be told apart without being usable. */
const DISPLAY_CHARS = TOKEN_PREFIX.length + 6;

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export interface MintedToken {
  id: string;
  /** The only time the full token exists outside the user's machine. */
  token: string;
  label: string;
  prefix: string;
  projectId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export async function mintToken(
  userId: string,
  opts: { label: string; projectId?: string | null; expiresInDays?: number | null }
): Promise<MintedToken> {
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  const expiresAt = opts.expiresInDays ? new Date(Date.now() + opts.expiresInDays * 86_400_000) : null;
  const [row] = await db.insert(mcpTokens).values({
    userId,
    tokenHash: hash(token),
    label: opts.label.slice(0, 80),
    prefix: token.slice(0, DISPLAY_CHARS),
    projectId: opts.projectId ?? null,
    expiresAt,
  }).returning();
  return { id: row.id, token, label: row.label, prefix: row.prefix, projectId: row.projectId, expiresAt: row.expiresAt, createdAt: row.createdAt };
}

/** What the web app lists. Never includes anything a request could be made with. */
export async function listTokens(userId: string) {
  const rows = await db.select().from(mcpTokens)
    .where(and(eq(mcpTokens.userId, userId), isNull(mcpTokens.revokedAt)))
    .orderBy(desc(mcpTokens.createdAt));
  return rows.map((r) => ({
    id: r.id, label: r.label, prefix: r.prefix, projectId: r.projectId,
    expiresAt: r.expiresAt, lastUsedAt: r.lastUsedAt, createdAt: r.createdAt,
  }));
}

/** Idempotent, and scoped to the owner: revoking someone else's token is a no-op, not an error. */
export async function revokeToken(userId: string, id: string): Promise<boolean> {
  const rows = await db.update(mcpTokens).set({ revokedAt: new Date() })
    .where(and(eq(mcpTokens.id, id), eq(mcpTokens.userId, userId), isNull(mcpTokens.revokedAt)))
    .returning({ id: mcpTokens.id });
  return rows.length > 0;
}

export interface TokenIdentity { userId: string; tokenId: string; projectId: string | null }

/** Resolves a presented token, or null for anything expired, revoked, unknown or malformed. */
export async function resolveToken(presented: string): Promise<TokenIdentity | null> {
  if (!presented.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await db.select().from(mcpTokens).where(eq(mcpTokens.tokenHash, hash(presented)));
  if (!row || row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  // Best-effort: a failed timestamp write must not fail the request it describes.
  void db.update(mcpTokens).set({ lastUsedAt: new Date() }).where(eq(mcpTokens.id, row.id)).catch(() => {});
  return { userId: row.userId, tokenId: row.id, projectId: row.projectId };
}

/**
 * The guard on every bridge route.
 *
 * Deliberately not `attachBearerUser`-style. That middleware is permissive by
 * design — no header, no problem, fall through to the session — because it
 * sits above the whole app. This one refuses, because everything under
 * `/api/mcp` requires a token and a request that gets that far without one is
 * a bug in the client or an attempt.
 *
 * A cookie session is not accepted here either. Browsers send cookies on
 * cross-site requests they were not asked to make; a token has to be pasted
 * deliberately, which makes this whole surface CSRF-proof by construction.
 */
export const requireMcpToken: RequestHandler = async (req: any, res, next) => {
  const header = String(req.headers.authorization ?? "");
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented) {
    return res.status(401).json({
      message: "This endpoint needs a Nova access token. Create one in SparkTower under Settings → Editor access.",
      code: "token_required",
    });
  }
  const identity = await resolveToken(presented);
  if (!identity) {
    return res.status(401).json({ message: "That token isn't valid any more. Create a new one in SparkTower.", code: "token_invalid" });
  }
  /*
   * A pinned token is checked here rather than in each route, so a route added
   * later inherits the restriction instead of having to remember it.
   *
   * Read from the URL rather than from `req.params`, because this is mounted
   * on a prefix and Express only fills params from a route's own pattern —
   * so `req.params.projectId` is undefined here however the route below
   * declares it. Trusting it silently let a pinned token reach every project
   * in the account, which is precisely the restriction this exists to apply.
   */
  const inPath = /^\/api\/mcp\/projects\/([^/?#]+)/.exec(req.originalUrl ?? "")?.[1];
  const target = (inPath ? decodeURIComponent(inPath) : undefined) ?? req.params?.projectId ?? req.body?.projectId;
  if (identity.projectId && target && target !== identity.projectId) {
    return res.status(403).json({ message: "This token is limited to one project, and that isn't it.", code: "token_scope" });
  }
  req.user = { id: identity.userId };
  req.mcpToken = identity;
  next();
};
