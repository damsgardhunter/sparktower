import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { issueLocalUpload } from "./local-uploads";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

/**
 * How this process proves to Google Cloud Storage that it's allowed in.
 *
 * This used to have one answer: a sidecar on localhost:1106 that only exists
 * inside Replit. Anywhere else the credentials resolved to nothing, uploads
 * failed, and the signer said "make sure you're running on Replit" — which is
 * unhelpful advice to a container on Render. Since production refuses the
 * local-disk fallback on purpose (see `isLocalFallback` below), that made every
 * avatar, cover image, artifact and merch render a failure off Replit.
 *
 * So there are three answers now, chosen in this order:
 *
 *  - `GCS_SERVICE_ACCOUNT_KEY`: the JSON key for a service account, as one
 *    environment variable. Base64 is accepted because most dashboards mangle
 *    pasted multi-line JSON. This is what a normal host uses.
 *  - Application Default Credentials, when `GOOGLE_APPLICATION_CREDENTIALS`
 *    points at a key file, or when running on Google's own infrastructure.
 *  - Replit's sidecar, when this really is running on Replit.
 *
 * The mode is decided once and named, because "uploads don't work" is a
 * miserable thing to debug without knowing which set of credentials was tried.
 */
export type StorageCredentialMode = "service-account" | "default" | "replit-sidecar";

export function storageCredentialMode(env: NodeJS.ProcessEnv = process.env): StorageCredentialMode {
  if (env.GCS_SERVICE_ACCOUNT_KEY?.trim()) return "service-account";
  if (env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || env.GOOGLE_CLOUD_PROJECT?.trim()) return "default";
  // REPL_ID is set inside every Replit container; the sidecar only exists there.
  if (env.REPL_ID || env.REPLIT_DEPLOYMENT || env.REPLIT_DOMAINS) return "replit-sidecar";
  return "default";
}

/** The service-account JSON, however it was pasted in: raw, or base64. */
export function parseServiceAccountKey(raw: string): { client_email?: string; private_key?: string; project_id?: string } {
  const text = raw.trim().startsWith("{") ? raw.trim() : Buffer.from(raw.trim(), "base64").toString("utf8");
  const key = JSON.parse(text);
  if (!key.client_email || !key.private_key) {
    throw new Error("GCS_SERVICE_ACCOUNT_KEY is missing client_email or private_key — is it the whole JSON key file?");
  }
  // A key pasted through a form often arrives with its newlines escaped.
  if (typeof key.private_key === "string") key.private_key = key.private_key.replace(/\\n/g, "\n");
  return key;
}

function buildStorageClient(): Storage {
  const mode = storageCredentialMode();
  if (mode === "service-account") {
    const key = parseServiceAccountKey(process.env.GCS_SERVICE_ACCOUNT_KEY!);
    return new Storage({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || key.project_id,
      credentials: { client_email: key.client_email, private_key: key.private_key },
    });
  }
  if (mode === "replit-sidecar") {
    return new Storage({
      credentials: {
        audience: "replit",
        subject_token_type: "access_token",
        token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
        type: "external_account",
        credential_source: {
          url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
          format: { type: "json", subject_token_field_name: "access_token" },
        },
        universe_domain: "googleapis.com",
      },
      projectId: "",
    });
  }
  return new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT || undefined });
}

/*
 * Built on first use rather than at import: a bad key should fail when somebody
 * uploads something, with a message about the key, not at boot in a test run
 * that never touches storage.
 */
let client: Storage | null = null;
export function getObjectStorageClient(): Storage {
  if (!client) client = buildStorageClient();
  return client;
}
/** Test seam: credentials are read once, and tests change the environment. */
export function resetObjectStorageClient(): void { client = null; }

/**
 * Kept as a property bag so existing callers (`objectStorageClient.bucket(…)`)
 * keep working while the client itself is built lazily.
 */
export const objectStorageClient = {
  bucket: (name: string) => getObjectStorageClient().bucket(name),
} as unknown as Storage;

const LOCAL_OBJECT_ROOT = process.env.LOCAL_OBJECT_ROOT || path.join(process.cwd(), "local_objects");

/**
 * Whether to write to local disk instead of a bucket.
 *
 * Development and test, and only when no bucket is configured. Production is
 * deliberately excluded: if PRIVATE_OBJECT_DIR is missing there, the caller
 * throws instead, because silently writing user uploads to a container's
 * ephemeral disk is worse than failing.
 */
function isLocalFallback(): boolean {
  return (
    !process.env.PRIVATE_OBJECT_DIR &&
    (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")
  );
}

/** Where a local object's metadata lives, next to the object itself. */
const sidecarPath = (filePath: string): string => `${filePath}.meta.json`;

/**
 * A file on local disk, standing in for a bucket object.
 *
 * Metadata is kept in a sidecar `.meta.json` rather than dropped, which it used
 * to be: `getMetadata` returned only a size, so `getObjectAclPolicy` always saw
 * nothing and every object read as having no policy. That meant an upload
 * marked `visibility: "private"` was served to anyone who asked — in local
 * development only, but that is exactly where the ACL work gets tried out and
 * pronounced fine.
 */
class LocalFile {
  filePath: string;
  constructor(filePath: string) {
    this.filePath = filePath;
  }
  async exists(): Promise<[boolean]> {
    try {
      await fsPromises.access(this.filePath, fs.constants.R_OK);
      return [true];
    } catch {
      return [false];
    }
  }
  async getMetadata(): Promise<any[]> {
    const stat = await fsPromises.stat(this.filePath);
    let custom: Record<string, unknown> | undefined;
    try {
      custom = JSON.parse(await fsPromises.readFile(sidecarPath(this.filePath), "utf8"));
    } catch {
      // No sidecar is the normal case: the object simply has no metadata.
    }
    return [
      {
        contentType: "application/octet-stream",
        size: stat.size,
        ...(custom ? { metadata: custom } : {}),
      },
    ];
  }
  /** Merges into whatever is already there, the way a bucket's patch does. */
  async setMetadata(update: { metadata?: Record<string, unknown> }): Promise<void> {
    const [existing] = await this.getMetadata();
    const merged = { ...(existing?.metadata ?? {}), ...(update?.metadata ?? {}) };
    await fsPromises.writeFile(sidecarPath(this.filePath), JSON.stringify(merged), "utf8");
  }
  createReadStream() {
    return fs.createReadStream(this.filePath);
  }
}

export class ObjectNotFoundError extends Error {
  /**
   * Where a local-dev store was searched, when the path was well formed and
   * the file simply was not there. Absent when the path itself was refused —
   * a traversal attempt is not a misplaced folder, and saying so would put
   * somebody's probing in the log as advice.
   */
  readonly searchedIn?: string;

  constructor(searchedIn?: string) {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    this.searchedIn = searchedIn;
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// The object storage service is used to interact with the object storage service.
/**
 * Reads a MIME type off a file's leading bytes.
 *
 * Only the formats this app actually serves. Deliberately signature-based
 * rather than extension-based: uploads are stored under a UUID with no
 * extension at all, so there is nothing else to go on.
 */
export function sniffContentType(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  const hex = buf.subarray(0, 12).toString("hex").toLowerCase();
  const ascii = buf.subarray(0, 64).toString("utf8");

  if (hex.startsWith("89504e47")) return "image/png";
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("47494638")) return "image/gif";
  if (hex.startsWith("52494646") && hex.slice(16, 24) === "77656270") return "image/webp";
  if (hex.startsWith("00000100")) return "image/x-icon";
  if (hex.startsWith("25504446")) return "application/pdf";
  if (hex.slice(8, 16) === "66747970") return "video/mp4";
  if (hex.startsWith("1a45dfa3")) return "video/webm";
  // SVG and other text formats have no magic number; sniff the opening tag.
  if (/^\s*(<\?xml|<svg)/i.test(ascii)) return "image/svg+xml";
  return null;
}

export class ObjectStorageService {
  constructor() {}

  // Gets the public object search paths.
  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  // Gets the private object directory.
  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      if (isLocalFallback()) {
        // For local development, use a local folder as the object dir root.
        return `/local/${path.relative(process.cwd(), LOCAL_OBJECT_ROOT)}`;
      }
      throw new Error(
        "PRIVATE_OBJECT_DIR is not set, so there is nowhere to put uploads. " +
          "Set it to /<bucket>/<prefix> and give the process credentials for that " +
          "bucket (GCS_SERVICE_ACCOUNT_KEY). See docs/ops/custom-domain.md."
      );
    }
    return dir;
  }

  // Search for a public object from the search paths.
  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      // Full path format: /<bucket_name>/<object_name>
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      // Check if file exists
      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  // Downloads an object to the response.
  /**
   * Reads an object fully into memory.
   *
   * Uses createReadStream rather than the GCS-only `download()` so it works
   * against both real object storage and the local-dev disk fallback. Guarded
   * by maxBytes because callers pass user-uploaded files.
   */
  async readObjectBuffer(
    objectPath: string,
    maxBytes = 15 * 1024 * 1024
  ): Promise<{ buffer: Buffer; contentType: string; size: number }> {
    const file = await this.getObjectEntityFile(objectPath);
    const [metadata] = await file.getMetadata();

    const chunks: Buffer[] = [];
    let total = 0;
    await new Promise<void>((resolve, reject) => {
      const stream = file.createReadStream();
      stream.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          stream.destroy();
          reject(new Error(`File is larger than ${Math.round(maxBytes / 1024 / 1024)}MB`));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => resolve());
      stream.on("error", reject);
    });

    return {
      buffer: Buffer.concat(chunks),
      contentType: metadata?.contentType || "application/octet-stream",
      size: total,
    };
  }

  /**
   * Streams an object to the response.
   *
   * `contentTypeOverride` exists because the local-dev disk fallback doesn't
   * persist object metadata, so callers that already know the MIME type can
   * supply it rather than serving application/octet-stream.
   */
  async downloadObject(
    file: File,
    res: Response,
    cacheTtlSec: number = 3600,
    contentTypeOverride?: string
  ) {
    try {
      // Get file metadata
      const [metadata] = await file.getMetadata();
      // Get the ACL policy for the object.
      const aclPolicy = await getObjectAclPolicy(file);
      const isPublic = aclPolicy?.visibility === "public";

      const declared = contentTypeOverride || metadata.contentType;
      /*
       * The local-dev disk fallback persists no metadata, so every upload came
       * back as application/octet-stream. Browsers sniff `<img>` and CSS
       * backgrounds and render it anyway, which is why this survived — but
       * anything stricter does not: a Printful fetch of a print file, a
       * download that saves with no extension, a future nosniff header.
       *
       * So when the type is missing or generic, it's read off the file's own
       * signature bytes instead of guessed from a name we don't have.
       */
      const needsSniff = !declared || declared === "application/octet-stream";

      res.set({
        "Content-Length": metadata.size,
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
      });
      if (!needsSniff) res.set("Content-Type", declared);

      const stream = file.createReadStream();
      let typeResolved = !needsSniff;

      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });

      if (needsSniff) {
        // Set from the first chunk, which must happen before anything is
        // written — headers are already gone once the body starts.
        stream.once("data", (chunk: Buffer) => {
          if (!typeResolved) {
            res.set("Content-Type", sniffContentType(chunk) || "application/octet-stream");
            typeResolved = true;
          }
        });
      }

      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  // Gets the upload URL for an object entity.
  async getObjectEntityUploadURL(): Promise<string> {
    // Local-dev fallback: return an internal upload endpoint the server will accept.
    if (isLocalFallback()) {
      const objectId = randomUUID();
      // Ensure local directories exist
      const uploadsDir = path.join(LOCAL_OBJECT_ROOT, "uploads");
      await fsPromises.mkdir(uploadsDir, { recursive: true });
      const serverBase = process.env.SERVER_BASE_URL || `http://localhost:${process.env.PORT || 5001}`;
      issueLocalUpload(objectId);
      return `${serverBase}/internal-local-upload/${objectId}`;
    }

    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR is not set, so there is nowhere to put uploads. " +
          "Set it to /<bucket>/<prefix> and give the process credentials for that " +
          "bucket (GCS_SERVICE_ACCOUNT_KEY). See docs/ops/custom-domain.md."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    // Sign URL for PUT method with TTL
    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  /**
   * Writes a Buffer straight into object storage and returns its object path.
   *
   * The signed-URL flow exists for browser uploads; server-generated artefacts
   * (a rendered PDF, for one) have the bytes in hand already and shouldn't
   * have to round-trip through an HTTP PUT to store them.
   */
  async writeObjectBuffer(
    buffer: Buffer,
    contentType = "application/octet-stream",
  ): Promise<string> {
    const objectId = randomUUID();

    if (isLocalFallback()) {
      const uploadsDir = path.join(LOCAL_OBJECT_ROOT, "uploads");
      await fsPromises.mkdir(uploadsDir, { recursive: true });
      await fsPromises.writeFile(path.join(uploadsDir, objectId), buffer);
      return `/objects/uploads/${objectId}`;
    }

    const fullPath = `${this.getPrivateObjectDir()}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    await objectStorageClient
      .bucket(bucketName)
      .file(objectName)
      .save(buffer, { contentType, resumable: false });

    return `/objects/uploads/${objectId}`;
  }

  // Gets the object entity file from the object path.
  async getObjectEntityFile(objectPath: string): Promise<File> {
    /*
     * Heal legacy malformed paths.
     *
     * /api/uploads/request-url already returns "/objects/uploads/<id>", but
     * several clients used to prefix it again. Depending on the call site that
     * produced "/objects/objects/uploads/<id>" or "/objects//objects/uploads/<id>".
     * Collapse repeated slashes and repeated "/objects" segments so those
     * records still resolve rather than orphaning the files.
     */
    objectPath = objectPath
      .replace(/\/{2,}/g, "/")
      .replace(/^(\/objects)(?:\/objects)+\//, "$1/");

    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");

    /*
     * The path arrives from the router undecoded and unnormalised, so "..",
     * "." and empty segments are the caller's to send. Joined onto a root they
     * walk out of it — to another user's uploads locally, to another prefix in
     * the bucket in production. Refused here, where the path is built, rather
     * than trusting whatever called in.
     */
    if (entityId.split("/").some((seg) => seg === "" || seg === "." || seg === ".." || seg.startsWith("\\"))) {
      throw new ObjectNotFoundError();
    }

    // Local fallback: map to filesystem path under LOCAL_OBJECT_ROOT
    if (isLocalFallback()) {
      const localPath = path.resolve(LOCAL_OBJECT_ROOT, entityId);
      // Belt and braces: whatever the segments were, the file has to be inside the root.
      if (path.relative(LOCAL_OBJECT_ROOT, localPath).startsWith("..")) {
        throw new ObjectNotFoundError();
      }
      try {
        await fsPromises.access(localPath, fs.constants.R_OK);
        return new (LocalFile as any)(localPath) as any;
      } catch {
        // Well formed, and not there: the caller can say which folder it looked in.
        throw new ObjectNotFoundError(LOCAL_OBJECT_ROOT);
      }
    }

    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(
    rawPath: string,
  ): string {
    // If this is a standard Google Storage URL, extract the path
    if (rawPath.startsWith("https://storage.googleapis.com/")) {
      const url = new URL(rawPath);
      return url.pathname;
    }

    // Local fallback: if the rawPath points to our internal-local-upload endpoint,
    // convert it to an object entity path used by the app: /objects/uploads/<id>
    const serverBase = process.env.SERVER_BASE_URL || `http://localhost:${process.env.PORT || 5001}`;
    if (rawPath.startsWith(serverBase + "/internal-local-upload/")) {
      const id = rawPath.split("/internal-local-upload/")[1];
      return `/objects/uploads/${id}`;
    }

    // Unknown URL; return as-is
    if (!rawPath.startsWith("/")) {
      try {
        const url = new URL(rawPath);
        return url.pathname;
      } catch {
        return rawPath;
      }
    }
  
    // Extract the path from the URL by removing query parameters and domain
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
  
    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }
  
    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }
  
    // Extract the entity ID from the path
    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  // Tries to set the ACL policy for the object entity and return the normalized path.
  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  // Checks if the user can access the object entity.
  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

/** GCS names the operations differently from the HTTP methods the callers pass. */
const SIGNED_ACTIONS = { GET: "read", PUT: "write", DELETE: "delete", HEAD: "read" } as const;

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  /*
   * Off Replit, sign it ourselves. V4 signing needs a private key, which is
   * exactly what the service-account mode has — so this is the same URL the
   * sidecar would have handed back, produced locally and without a round trip.
   *
   * Default credentials (a workload identity on Google's own infrastructure)
   * have no private key to sign with; the client falls back to the IAM
   * signBlob API, which works when the service account has the
   * `iam.serviceAccountTokenCreator` role. If it doesn't, the error says so.
   */
  if (storageCredentialMode() !== "replit-sidecar") {
    const [url] = await getObjectStorageClient()
      .bucket(bucketName)
      .file(objectName)
      .getSignedUrl({ version: "v4", action: SIGNED_ACTIONS[method], expires: Date.now() + ttlSec * 1000 });
    return url;
  }

  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = await response.json();
  return signedURL;
}

