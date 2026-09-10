import type { Express } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { getObjectAclPolicy, ObjectPermission } from "./objectAcl";
import { rateLimit } from "../../moderation";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { consumeLocalUpload } from "./local-uploads";

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
  app.put("/internal-local-upload/:id", async (req: any, res) => {
    try {
      // Development only, twice over: never when real storage is configured,
      // and never in production even if it isn't. It writes to local disk.
      if (process.env.PRIVATE_OBJECT_DIR || process.env.NODE_ENV === "production") {
        return res.status(404).json({ error: "Not found" });
      }
      // The id names a file on disk; it must be a plain token, never a path.
      const id = String(req.params.id ?? "");
      if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) return res.status(400).json({ error: "Invalid upload id" });
      // The URL is the credential, as with a real presigned URL: only an id
      // this server issued, within its window, once. Anything else is a guess.
      if (!consumeLocalUpload(id)) return res.status(404).json({ error: "Not found" });
      const localRoot = process.env.LOCAL_OBJECT_ROOT || path.join(process.cwd(), "local_objects");
      const uploadsDir = path.join(localRoot, "uploads");
      await fsPromises.mkdir(uploadsDir, { recursive: true });
      const filePath = path.join(uploadsDir, id);

      const writeStream = fs.createWriteStream(filePath);
      req.pipe(writeStream);
      writeStream.on("finish", () => {
        res.json({ success: true, objectPath: `/objects/uploads/${id}` });
      });
      writeStream.on("error", (err: any) => {
        console.error("Local upload error:", err);
        res.status(500).json({ error: "Failed to write file" });
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
      console.error("Error serving object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });
}

