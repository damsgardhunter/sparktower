/**
 * What an upload is called afterwards.
 *
 * The client is handed a presigned URL and an `objectPath`, PUTs the file to
 * the first and saves the second. So the second has to be something
 * `GET /objects/...` can serve, and for a long time — with a real bucket — it
 * was not: a Google signed URL returned its own pathname,
 * `/<bucket>/<prefix>/uploads/<id>`, and never reached the code that strips the
 * prefix.
 *
 * The résumé upload is the only one that checks the shape, so it answered
 * "that doesn't look like an uploaded file" and everything else — avatar,
 * cover, project logo, post image — silently stored a path nothing serves,
 * with the file sitting correctly in the bucket the whole time. The loud
 * failure was the lucky one, and it is the reason this file exists.
 *
 * Local development never saw it, because the disk fallback hands back an
 * `/internal-local-upload/<id>` URL that the other branch has always handled.
 * That is what let it survive until a bucket was configured.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ObjectStorageService } from "../../server/replit_integrations/object_storage/objectStorage";

const BUCKET = "sparktower-uploads";
const ID = "38423a1b-34bf-4f5e-b6a0-1450b40ae437";

describe("naming an upload after it is stored", () => {
  const original = { dir: process.env.PRIVATE_OBJECT_DIR, base: process.env.SERVER_BASE_URL };
  beforeEach(() => {
    process.env.PRIVATE_OBJECT_DIR = `/${BUCKET}/uploads`;
    process.env.SERVER_BASE_URL = "http://localhost:5001";
  });
  afterEach(() => {
    if (original.dir === undefined) delete process.env.PRIVATE_OBJECT_DIR; else process.env.PRIVATE_OBJECT_DIR = original.dir;
    if (original.base === undefined) delete process.env.SERVER_BASE_URL; else process.env.SERVER_BASE_URL = original.base;
  });
  const normalise = (raw: string) => new ObjectStorageService().normalizeObjectEntityPath(raw);

  /*
   * The bug, pinned. The signed URL's pathname carries the bucket and the
   * prefix; what gets stored must carry neither.
   */
  it("turns a Google signed URL into a path the app can serve", () => {
    const signed = `https://storage.googleapis.com/${BUCKET}/uploads/uploads/${ID}?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Expires=900`;
    expect(normalise(signed)).toBe(`/objects/uploads/${ID}`);
  });

  it("drops the query string with it", () => {
    const signed = `https://storage.googleapis.com/${BUCKET}/uploads/uploads/${ID}?X-Goog-Signature=abc`;
    expect(normalise(signed)).not.toContain("?");
    expect(normalise(signed)).not.toContain("X-Goog");
  });

  /* The local-dev path, which always worked and must keep working. */
  it("still handles the development upload endpoint", () => {
    expect(normalise(`http://localhost:5001/internal-local-upload/${ID}`)).toBe(`/objects/uploads/${ID}`);
  });

  /*
   * Normalising twice is the same as normalising once. Callers do it — the ACL
   * helper normalises and then hands the result to something that may normalise
   * again — and a second pass that mangled the first would be a bug nobody
   * could see from either call site.
   */
  it("leaves an already-normalised path alone", () => {
    expect(normalise(`/objects/uploads/${ID}`)).toBe(`/objects/uploads/${ID}`);
    expect(normalise(normalise(`https://storage.googleapis.com/${BUCKET}/uploads/uploads/${ID}`)))
      .toBe(`/objects/uploads/${ID}`);
  });

  /*
   * A bare path used to be handed to `new URL` with no base, which throws.
   * Nothing reached it, but it was one caller away from a 500 on an upload.
   */
  it("does not throw on a path that is not a URL", () => {
    expect(() => normalise("/some/other/path")).not.toThrow();
    expect(normalise("/some/other/path")).toBe("/some/other/path");
  });

  it("passes through something it does not recognise rather than inventing a path", () => {
    expect(normalise("not a url at all")).toBe("not a url at all");
    expect(normalise("https://example.test/elsewhere/file.png")).toBe("/elsewhere/file.png");
  });

  /*
   * The prefix is what gets stripped, so a different one has to work too —
   * this is read from the environment and a deployment may name it anything.
   */
  it("strips whatever prefix the environment names", () => {
    process.env.PRIVATE_OBJECT_DIR = `/${BUCKET}/some/deeper/prefix`;
    expect(normalise(`https://storage.googleapis.com/${BUCKET}/some/deeper/prefix/uploads/${ID}`))
      .toBe(`/objects/uploads/${ID}`);
  });

  /* With no bucket configured there is no prefix to remove, and nothing to invent. */
  it("returns the path unchanged when no object dir is set", () => {
    delete process.env.PRIVATE_OBJECT_DIR;
    expect(normalise(`https://storage.googleapis.com/${BUCKET}/uploads/uploads/${ID}`))
      .toBe(`/${BUCKET}/uploads/uploads/${ID}`);
  });
});
