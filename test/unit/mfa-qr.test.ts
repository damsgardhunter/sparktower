/**
 * The enrolment QR draws, and keeps drawing when the PNG encoder won't.
 *
 * Somebody with admin access opened the 2FA page and got "Couldn't draw the QR
 * code this time" — on a host where PNG encoding fails, while the same call
 * worked in development and in the tests. A picture nobody can produce is a
 * thirty-two character key typed by hand into a phone.
 */
import { describe, it, expect, vi } from "vitest";
import QRCode from "qrcode";
import { drawQr } from "../../server/mfa";

const url = "otpauth://totp/SparkTower%3Aa%40b.test?secret=EK65MQKBWLONU45GRTU4BINBMUDACHEN&issuer=SparkTower&algorithm=SHA1&digits=6&period=30";

describe("drawing the enrolment QR", () => {
  it("draws a PNG when it can", async () => {
    const { dataUrl, drawnAs } = await drawQr(url);
    expect(drawnAs).toBe("png");
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("falls back to SVG when PNG encoding fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // What the broken host does: zlib/pixel-buffer path throws, the string path doesn't.
    const png = vi.spyOn(QRCode, "toDataURL").mockRejectedValue(new Error("zlib unavailable") as never);
    try {
      const { dataUrl, drawnAs } = await drawQr(url);
      expect(drawnAs).toBe("svg");
      expect(dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
      // Still an image the page renders in an <img>, never markup it injects.
      const svg = Buffer.from(dataUrl!.split(",")[1], "base64").toString("utf8");
      expect(svg).toContain("<svg");
      expect(svg).not.toContain("<script");
    } finally { png.mockRestore(); vi.restoreAllMocks(); }
  });

  it("gives up honestly rather than failing the whole setup", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const png = vi.spyOn(QRCode, "toDataURL").mockRejectedValue(new Error("no") as never);
    const svg = vi.spyOn(QRCode, "toString").mockRejectedValue(new Error("also no") as never);
    try {
      expect(await drawQr(url)).toEqual({ dataUrl: null, drawnAs: null });
    } finally { png.mockRestore(); svg.mockRestore(); vi.restoreAllMocks(); }
  });
});
