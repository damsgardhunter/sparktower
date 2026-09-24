import type { Express } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { getObjectAclPolicy, ObjectPermission } from "./objectAcl";
import { rateLimit } from "../../moderation";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { consumeLocalUpload, LOCAL_UPLOAD_MAX_BYTES } from "./local-uploads";
import { buildDerivative, derivativePathFor, wantedWidth } from "../../image-derivatives";

/**
 * Register object storage routes for file uploads.
 *
 * This provides example routes for the presigned URL upload flow:
 * 1. POST /api/uploads/request-url - Get a presigned URL for uploading
 * 2. The client then uploads directly to the presigned URL
 *
 * IMPORTANT: These are example routes. Customize based on your use case:
 * - Add authentication middleware for protected uploads
 * - Add file metadata storage (save to database after upload)
 * - Add ACL policies for access control
 */
/** Said once per process, not once per broken image. */
let warnedNoBucket = false;
/** Said once, like the bucket warning: one line per deploy, not one per image. */
let warnedNoCredentials = false;

/**
 * Streams the resized copy, making it first if this is the first time anybody
 * asked for that size.
 *
 * Returns false when there is nothing to serve — not an image, already small
 * enough, an upload path this doesn't recognise, or anything at all going
 * wrong. The caller then serves the original, which is what happened before
 * any of this existed.
 */
async function serveDerivative(
  objects: ObjectStorageService,
  objectPath: string,
  width: number,
  res: any,
): Promise<boolean> {
  const derivedPath = derivativePathFor(objectPath, width);
  if (!derivedPath) return false;

  try {
    // Already made: the common case once a page has been looked at once.
    const existing = await objects.getObjectEntityFile(derivedPath).catch(() => null);
    if (existing) {
      const [meta] = await existing.getMetadata();
      const storedType = meta?.metadata?.contentType ?? meta?.contentType;
      await objects.downloadObject(existing, res, DERIVATIVE_TTL, typeof storedType === "string" ? storedType : undefined);
      return true;
    }

    const original = await objects.readObjectBuffer(objectPath, 25 * 1024 * 1024);
    const made = await buildDerivative(original.buffer, original.contentType, width);
    if (!made) return false;

    /*
     * Written before it is served, and the write is allowed to fail. Storing
     * it is what makes the next request cheap; not storing it only means
     * doing this work again, which is not a reason to fail the request in
     * front of somebody.
     */
    await objects.writeObjectAtPath(derivedPath, made.buffer, made.contentType).catch((err) => {
      console.error(`[objects] couldn't keep the ${width}px copy of ${forLog(objectPath)}:`, (err as Error)?.message ?? err);
    });
    res.set({
      "Content-Type": made.contentType,
      "Content-Length": String(made.buffer.length),
      "Cache-Control": `public, max-age=${DERIVATIVE_TTL}`,
    });
    res.end(made.buffer);
    return true;
  } catch (err) {
    console.error(`[objects] couldn't build the ${width}px copy of ${forLog(objectPath)}:`, (err as Error)?.message ?? err);
    return false;
  }
}

/** A day. A derivative is immutable — its path names the width it is — so this could be longer. */
const DERIVATIVE_TTL = 86_400;

/**
 * An object path, safe to put in a log line.
 *
 * The path comes off the request, so it is whatever somebody typed. A newline
 * in it writes a second log line of their choosing — a forged "[objects] all
 * clear" under a real error is the cheap version — and anything a log reader
 * treats as markup is the expensive one. Only the characters an object path is
 * made of survive, and only so many of them.
 */
const forLog = (path: string): string => path.replace(/[^A-Za-z0-9/_.-]/g, "?").slice(0, 120);

export function registerObjectStorageRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();

  /**
   * Request a presigned URL for file upload.
   *
   * Request body (JSON):
   * {
   *   "name": "filename.jpg",
   *   "size": 12345,
   *   "contentType": "image/jpeg"
   * }
   *
   * Response:
   * {
   *   "uploadURL": "https://storage.googleapis.com/...",
   *   "objectPath": "/objects/uploads/uuid"
   * }
   *
   * IMPORTANT: The client should NOT send the file to this endpoint.
   * Send JSON metadata only, then upload the file directly to uploadURL.
   */
  app.post("/api/uploads/request-url", (req: any, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    next();
  }, rateLimit("upload"), async (req, res) => {
    try {
      const { name, size, contentType } = req.body;

      if (!name) {
        return res.status(400).json({
          error: "Missing required field: name",
        });
      }

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();

      // Extract object path from the presigned URL for later reference
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json({
        uploadURL,
        objectPath,
        // Echo back the metadata for client convenience
        metadata: { name, size, contentType },
      });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  // Internal development-only upload endpoint used when PRIVATE_OBJECT_DIR is not configured.
  // Accepts PUT /internal-local-upload/:id and writes the body to local disk under local_objects/uploads/:id
  app.put("/internal-local-upload/:id", rateLimit("upload"), async (req: any, res) => {
    // public-write: a single-use upload id this server issued (a presigned URL); development only (404 in production), size-capped
    try {
      // Development only, twice over: never when real storage is configured,
      // and never in production even if it isn't. It writes to local disk.
      if (process.env.PRIVATE_OBJECT_DIR || process.env.NODE_ENV === "production") {
        return res.status(404).json({ error: "Not found" });
      }
      // The id names a file on disk; it must be a plain token, never a path.
      const id = String(req.params.id ?? "");
      if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) return res.status(400).json({ error: "Invalid upload id" });
      // Refused on its declared size before the id is spent, so an oversized
      // attempt doesn't cost the real upload its one use.
      if (Number(req.headers["content-length"] ?? 0) > LOCAL_UPLOAD_MAX_BYTES) {
        // The body goes unread, so the connection can't be reused.
        res.set("Connection", "close");
        return res.status(413).json({ error: "File too large" });
      }
      // The URL is the credential, as with a real presigned URL: only an id
      // this server issued, within its window, once. Anything else is a guess.
      if (!consumeLocalUpload(id)) return res.status(404).json({ error: "Not found" });
      const localRoot = process.env.LOCAL_OBJECT_ROOT || path.join(process.cwd(), "local_objects");
      const uploadsDir = path.join(localRoot, "uploads");
      await fsPromises.mkdir(uploadsDir, { recursive: true });
      const filePath = path.join(uploadsDir, id);

      const writeStream = fs.createWriteStream(filePath);
      // Counted as it arrives too: a chunked body declares no length at all.
      let received = 0;
      req.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > LOCAL_UPLOAD_MAX_BYTES && !res.headersSent) {
          req.unpipe(writeStream);
          // Removed once the stream has closed: deleting first let a write
          // still in flight recreate the partial file afterwards.
          writeStream.once("close", () => { void fsPromises.rm(filePath, { force: true }); });
          writeStream.destroy();
          res.status(413).json({ error: "File too large" });
          req.resume(); // Drain the rest, so the client reads the answer rather than a reset.
        }
      });
      req.pipe(writeStream);
      writeStream.on("finish", () => {
        if (!res.headersSent) res.json({ success: true, objectPath: `/objects/uploads/${id}` });
      });
      writeStream.on("error", (err: any) => {
        console.error("Local upload error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Failed to write file" });
      });
    } catch (error) {
      console.error("Local upload handler error:", error);
      res.status(500).json({ error: "Failed to handle local upload" });
    }
  });

  /**
   * Serve uploaded objects.
   *
   * GET /objects/:objectPath(*)
   *
   * Objects carrying an explicit `private` ACL policy are only served to their
   * owner (or a user matching an ACL rule). Objects with no policy — every
   * upload predating ACLs, including project media that is meant to be
   * publicly viewable — are served as before, so this stays backwards
   * compatible while making `visibility: "private"` actually mean something.
   */
  app.get("/objects/:objectPath{/*rest}", async (req: any, res) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);

      const aclPolicy = await getObjectAclPolicy(objectFile).catch(() => null);

      /*
       * `?w=` — the size it is actually being looked at.
       *
       * Only for objects the world can already read: a derivative is a second
       * copy with its own life, and a copy of a private object is how a
       * private object stops being private. Anything that fails on the way is
       * answered with the original, because a wrong-sized picture beats a
       * missing one and none of this is worth a 500.
       */
      const width = aclPolicy?.visibility === "private" ? null : wantedWidth(req.query?.w);
      if (width) {
        const served = await serveDerivative(objectStorageService, req.path, width, res);
        if (served) return;
      }

      if (aclPolicy && aclPolicy.visibility === "private") {
        const allowed = await objectStorageService.canAccessObjectEntity({
          userId: req.user?.id,
          objectFile,
          requestedPermission: ObjectPermission.READ,
        });
        if (!allowed) {
          // 404 rather than 403 so object paths aren't confirmable.
          return res.status(404).json({ error: "Object not found" });
        }
      }

      await objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      /*
       * The failure worth naming: no bucket configured. Every image in the
       * product — avatars, covers, post media, anything Nova drew — is a path
       * through this route, so an unset PRIVATE_OBJECT_DIR doesn't break
       * uploads alone, it breaks every picture already uploaded. It surfaced as
       * a 500 per image with "Failed to serve object" in the log, which reads
       * like a storage outage rather than a missing setting, and on a phone it
       * reads as nothing at all: React Native renders a failed image as empty
       * space with no error anywhere.
       */
      const message = String((error as Error)?.message ?? error);
      if (message.includes("PRIVATE_OBJECT_DIR")) {
        if (!warnedNoBucket) {
          warnedNoBucket = true;
          console.error(
            "[objects] No object storage configured, so every image in the product will fail to load — " +
            "not just new uploads. Set PRIVATE_OBJECT_DIR and GCS_SERVICE_ACCOUNT_KEY (docs/ops/deploy.md). " +
            "Check with: npm run check:env",
          );
        }
        return res.status(503).json({ error: "Image storage isn't configured on this deployment.", code: "storage_unconfigured" });
      }
      /*
       * The other way storage fails, and the one that was unreadable.
       *
       * PRIVATE_OBJECT_DIR set, credentials not — or set to something the
       * bucket won't accept. `file.exists()` throws out of the Google client
       * with "Could not load the default credentials", and this handler turned
       * every one of them into "Failed to serve object", which names neither
       * the cause nor the thing to change. Meanwhile every picture in the
       * product is a 500: avatars, covers, post media, anything Nova drew. On
       * a phone that is not a broken-image icon, it is blank space, so the
       * first report is "the AI images don't work" and the real answer is that
       * no image works and the deployment has no key.
       */
      if (/credential|invalid_grant|unauthorized|permission|forbidden|ENOTFOUND|could not load/i.test(message)) {
        if (!warnedNoCredentials) {
          warnedNoCredentials = true;
          console.error(
            "[objects] Object storage rejected this deployment's credentials, so every image in the product " +
            `will fail to load — not just new uploads. Set GCS_SERVICE_ACCOUNT_KEY (and check the bucket in ` +
            `PRIVATE_OBJECT_DIR is reachable by it). Underlying error: ${message.slice(0, 200)}`,
          );
        }
        return res.status(503).json({ error: "Image storage isn't configured on this deployment.", code: "storage_unconfigured" });
      }
      console.error("Error serving object:", error);
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });
}

