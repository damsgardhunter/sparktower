/**
 * Saving a picture Nova drew, on whatever the person is holding.
 *
 * Everything the product generates — a logo, a cover, the visuals drawn from
 * that logo, a storyboard scene, a badge — is paid for, and until now there was
 * no way to get any of it off the screen. The fix is one header in the one place
 * every image already passes through, rather than a download endpoint per
 * surface.
 *
 * Three things are worth holding to:
 *
 *  - **The name.** `Content-Disposition` is a latin-1 header and Node refuses to
 *    set one carrying anything else, answering 500. Project names are full of em
 *    dashes and apostrophes, and every file name here is built from one. The
 *    path export's download broke on exactly this.
 *  - **Header injection.** The client says what to call the file, so the name
 *    arrives in a query parameter and goes into a response header.
 *  - **The original, not a thumbnail.** The same route resizes images on `?w=`.
 *    Somebody saving a logo they paid for should get the file.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { downloadName, extensionFor } from "../../server/download-name";
import sharp from "sharp";
import { readSource } from "../helpers/source-parity";
import { ObjectStorageService } from "../../server/replit_integrations/object_storage";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ip = () => `198.51.150.${20 + (n++ % 200)}`;

describe("the file name a download arrives with", () => {
  it("survives the characters a project name actually has", () => {
    /* The one that broke the path export, plus the rest of a real title. */
    expect(downloadName("Quill & Co — Logo", "png")).toBe("quill-co-logo.png");
    expect(downloadName("Dana's Café ☕", "png")).toBe("danas-caf.png");
    expect(downloadName("日本語のなまえ", "png")).toBe("image.png");

    /* Every one of those is latin-1, which is the whole point. */
    for (const name of ["Quill & Co — Logo", "Dana's Café ☕", "日本語のなまえ"]) {
      const built = downloadName(name, "png");
      expect(() => Buffer.from(built, "latin1").toString("latin1") === built).not.toThrow();
      expect(/^[\w.-]+$/.test(built), `${built} is not header-safe`).toBe(true);
    }
  });

  it("cannot be used to inject a header", () => {
    /*
     * The name comes from a query parameter. A newline in a response header ends
     * the header and starts whatever the caller wants next.
     */
    for (const attack of [
      "a\r\nSet-Cookie: admin=1",
      'a"; filename="evil.exe',
      "a\nContent-Type: text/html",
      "../../etc/passwd",
    ]) {
      const built = downloadName(attack, "png");
      expect(built).not.toMatch(/[\r\n"';]/);
      expect(built).not.toContain("/");
      expect(built).not.toContain("..");
    }
  });

  it("falls back rather than naming a file after nothing", () => {
    expect(downloadName("", "png")).toBe("image.png");
    expect(downloadName("   ", "png")).toBe("image.png");
    expect(downloadName(null, "png")).toBe("image.png");
    expect(downloadName("!!!", "png", "logo")).toBe("logo.png");
  });

  it("takes the extension from the type and never guesses one", () => {
    expect(extensionFor("image/png")).toBe("png");
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("image/webp")).toBe("webp");
    /*
     * No extension beats a wrong one: a WebP saved as `.png` opens to "this file
     * is corrupt", which reads as the product having sold somebody a broken file.
     */
    expect(extensionFor("application/octet-stream")).toBe("");
    expect(extensionFor(null)).toBe("");
    expect(downloadName("logo", extensionFor("application/octet-stream"))).toBe("logo");
  });

  it("keeps the name short enough to be a file name", () => {
    expect(downloadName("x".repeat(400), "png").length).toBeLessThanOrEqual(64);
  });
});

describe("asking for a picture as a download", () => {
  /**
   * A real PNG in object storage, by the same call the generators use.
   *
   * 512 square and noisy rather than a one-pixel placeholder, because one of
   * these tests is about a download *not* being a thumbnail — and a 1×1 image
   * resized to 64 wide comes back byte-identical, so the comparison passed while
   * the resize was happening. It did not catch the mutation that served the
   * thumbnail until the picture was big enough to actually shrink.
   */
  async function storedPng(): Promise<{ path: string; bytes: number }> {
    const side = 512;
    const pixels = Buffer.alloc(side * side * 3);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7 + (i % 13) * 31) % 256;
    const png = await sharp(pixels, { raw: { width: side, height: side, channels: 3 } }).png().toBuffer();
    const path = await new ObjectStorageService().writeObjectBuffer(png, "image/png");
    return { path, bytes: png.length };
  }

  it("sends it inline by default, so every page still shows pictures", async () => {
    /*
     * The important half. Every `<img>` in the product reads this route, so an
     * attachment header on a plain GET would turn every avatar into a save
     * prompt.
     */
    const app = await getTestApp();
    const { path, bytes } = await storedPng();
    const res = await request(app).get(path).expect(200);
    expect(res.body.length, "a plain GET is the picture itself").toBe(bytes);
    expect(res.headers["content-disposition"]).toBeUndefined();
    expect(res.headers["content-type"]).toContain("image/png");
  });

  it("offers it as a file when asked, with the name it was given", async () => {
    const app = await getTestApp();
    const { path, bytes } = await storedPng();
    const res = await request(app)
      .get(`${path}?download=1&as=${encodeURIComponent("Quill & Co — Logo")}`)
      .expect(200);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="quill-co-logo.png"');
    /* And it is still the picture, not a description of one. */
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.body.length, "and the whole file, not a description of one").toBe(bytes);
  });

  it("names the file for itself when nothing says what to call it", async () => {
    const app = await getTestApp();
    const { path } = await storedPng();
    const res = await request(app).get(`${path}?download=1`).expect(200);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="image.png"');
  });

  it("sends the original file, byte for byte, even when a width is asked for", async () => {
    /*
     * The same route serves smaller copies on `?w=`. Somebody saving a logo they
     * paid for should get the file they paid for, so a download ignores the width.
     *
     * Asserted against the bytes that were stored rather than against a
     * thumbnail's size, which is what this test did first — and that version
     * passed even with the width honoured, because a derivative that cannot be
     * written falls back to the original by design ("a wrong-sized picture beats
     * a missing one"), and in a test environment with no bucket it never is. The
     * byte count is the claim, and it holds wherever this runs.
     */
    const app = await getTestApp();
    const { path, bytes } = await storedPng();
    for (const url of [`${path}?download=1&as=logo`, `${path}?w=96&download=1&as=logo`, `${path}?w=1280&download=1&as=logo`]) {
      const res = await request(app).get(url).expect(200);
      expect(res.headers["content-disposition"]).toBe('attachment; filename="logo.png"');
      expect(res.body.length, `${url} should be the original`).toBe(bytes);
    }
  });

  it("does not even look at the width when it is a download", () => {
    /*
     * The byte check above cannot tell "the width was ignored" from "the resize
     * silently failed", and in this environment it is the second. So the skip is
     * read from the source: the width is only worked out when the request is not
     * a download.
     */
    const route = readSource("server/replit_integrations/object_storage/routes.ts");
    expect(route).toMatch(/const width = wantsDownload \|\|[^;]*wantedWidth/);
  });

  it("cannot be talked into a header by the name it is given", async () => {
    const app = await getTestApp();
    const { path } = await storedPng();
    const res = await request(app)
      .get(`${path}?download=1&as=${encodeURIComponent('x"; filename="evil.exe')}`)
      .expect(200);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="x-filenameevilexe.png"');
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});
