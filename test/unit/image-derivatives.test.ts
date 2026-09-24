/**
 * Pictures served at the size they are looked at.
 *
 * Nothing resized anything: a photo off a phone is three to five megabytes,
 * and that is what was stored and what was sent — to a 68-pixel circle on a
 * phone and a 40-pixel avatar in a comment thread. The bytes were paid for
 * twice, out of the bucket and over somebody's mobile data, and a third time
 * in the second it takes to decode.
 *
 * These are the rules of the copy that gets made, and the cases where making
 * one is the wrong answer.
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { randomBytes } from "crypto";
import { ALLOWED_WIDTHS, buildDerivative, derivativePathFor, isResizable, wantedWidth } from "../../server/image-derivatives";

/**
 * A photograph-ish image.
 *
 * Genuinely random pixels, not a pattern: a repeating one compresses to almost
 * nothing, and a 1200x900 "photo" that is 22kB makes every size comparison
 * here meaningless — the first version of this test had one, and the PNG case
 * failed because the resized copy was legitimately no smaller.
 */
async function photo(width: number, height = width, format: "jpeg" | "png" | "webp" = "jpeg"): Promise<Buffer> {
  const pixels = randomBytes(width * height * 3);
  const image = sharp(pixels, { raw: { width, height, channels: 3 } });
  return format === "png" ? image.png().toBuffer() : format === "webp" ? image.webp().toBuffer() : image.jpeg().toBuffer();
}

describe("the width a request may ask for", () => {
  it("takes the sizes the product draws things at", () => {
    for (const w of ALLOWED_WIDTHS) expect(wantedWidth(String(w))).toBe(w);
  });

  it("ignores anything else, rather than refusing the picture", () => {
    // Any width would let one caller fill the bucket with near-identical copies.
    for (const bad of ["1", "97", "5000", "0", "-256", "abc", "", null, undefined, "256px"]) {
      expect(wantedWidth(bad), String(bad)).toBeNull();
    }
    // A repeated query parameter arrives as an array; the first one still counts.
    expect(wantedWidth(["256", "640"])).toBe(256);
  });
});

describe("where the copy is kept", () => {
  it("is beside the original, named for its width", () => {
    expect(derivativePathFor("/objects/uploads/abc123", 256)).toBe("/objects/derivatives/abc123/w256");
  });

  it("is refused for anything that isn't an upload path", () => {
    // Nothing else is ours to write copies of, and `..` is how that becomes a bug.
    for (const path of ["/objects/derivatives/abc/w96", "/objects/uploads/../secret", "/objects/", "/other/abc"]) {
      expect(derivativePathFor(path, 96), path).toBeNull();
    }
  });
});

describe("what gets resized", () => {
  it("resizes the three formats worth resizing", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/JPEG", "image/jpeg; charset=binary"]) {
      expect(isResizable(type), type).toBe(true);
    }
  });

  it("leaves alone the ones where it would be pointless or destructive", () => {
    // An SVG is already small; an animated GIF comes back as one still frame.
    for (const type of ["image/svg+xml", "image/gif", "application/pdf", "video/mp4", "", null, undefined]) {
      expect(isResizable(type), String(type)).toBe(false);
    }
  });
});

describe("the copy itself", () => {
  it("is the width asked for, and smaller than what it stands in for", async () => {
    const original = await photo(2000, 1500);
    const made = await buildDerivative(original, "image/jpeg", 256);
    expect(made).toBeTruthy();
    expect((await sharp(made!.buffer).metadata()).width).toBe(256);
    expect(made!.buffer.length).toBeLessThan(original.length);
    expect(made!.contentType).toBe("image/jpeg");
  }, 30_000);

  it("keeps the format, so what is served is what it says it is", async () => {
    const png = await photo(1200, 900, "png");
    expect((await buildDerivative(png, "image/png", 256))!.contentType).toBe("image/png");
    const webp = await photo(1200, 900, "webp");
    expect((await buildDerivative(webp, "image/webp", 256))!.contentType).toBe("image/webp");
  }, 30_000);

  it("declines to blow up a picture that is already smaller", async () => {
    // A 64-pixel logo asked for at 256 is not an error, and a blown-up copy
    // costs bytes to make it worse.
    expect(await buildDerivative(await photo(64), "image/jpeg", 256)).toBeNull();
  }, 30_000);

  it("declines when the copy would be no smaller", async () => {
    /*
     * It happens: a small PNG, or a photograph already compressed hard. A
     * derivative bigger than the original means paying to serve more bytes
     * than before, which is the opposite of the point.
     */
    // A 300px photo already squeezed to quality 20: re-encoding it at 256 and
    // quality 82 costs more bytes than it saves.
    const squeezed = await sharp(randomBytes(300 * 300 * 3), { raw: { width: 300, height: 300, channels: 3 } })
      .jpeg({ quality: 20 }).toBuffer();
    expect(await buildDerivative(squeezed, "image/jpeg", 256)).toBeNull();
  }, 30_000);

  it("says no to what it shouldn't touch", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="99" height="99"/></svg>');
    expect(await buildDerivative(svg, "image/svg+xml", 96)).toBeNull();
    expect(await buildDerivative(Buffer.from("not an image at all"), "image/jpeg", 96)).toBeNull();
  }, 30_000);

  it("turns a photograph the right way up", async () => {
    /*
     * A picture taken in portrait on a phone is stored landscape with an EXIF
     * tag saying which way is up — and resizing discards metadata, so without
     * an explicit rotate every one of them comes back on its side.
     */
    const sideways = await sharp(await photo(1200, 800))
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const made = await buildDerivative(sideways, "image/jpeg", 256);
    const meta = await sharp(made!.buffer).metadata();
    expect(meta.width, "the long side is now the short one").toBeLessThan(meta.height!);
  }, 30_000);
});
