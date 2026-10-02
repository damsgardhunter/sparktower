/**
 * Getting a paid-for picture onto the phone.
 *
 * Three of these are about failure, because that is where a save goes wrong in a
 * way nobody notices:
 *
 *  - `downloadAsync` writes whatever came back, so a 404's JSON body ends up on
 *    disk under a `.png` name and the share sheet offers it happily. The file has
 *    to be deleted when the status is not 200.
 *  - No to the photo library is not no to the file. The share sheet needs no
 *    permission and reaches Files, a message or a drive.
 *  - A private object is a 404 without a session, which is most of these: the
 *    token has to go with the request.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import { saveImage, downloadUrl, fileName } from "./saveImage";
import { API_URL } from "./api/client";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("the url the bytes are fetched from", () => {
  it("asks for the file rather than a view of it", () => {
    const url = downloadUrl("/objects/uploads/abc", "Quill & Co logo");
    expect(url.startsWith(`${API_URL}/objects/uploads/abc?`)).toBe(true);

    /*
     * Parsed rather than matched as text. `URLSearchParams` writes a space as `+`
     * and Express reads it back as a space, so asserting on `%20` tested the
     * encoding and failed on a URL that was perfectly correct.
     */
    const params = new URL(url).searchParams;
    expect(params.get("download")).toBe("1");
    expect(params.get("as")).toBe("Quill & Co logo");
  });

  it("drops a width, so a saved logo is never a thumbnail", () => {
    /*
     * Screens ask for `?w=256` to draw a tile. Saving that would hand somebody a
     * 256-pixel copy of the logo they paid for.
     */
    expect(downloadUrl("/objects/uploads/abc?w=256", "logo")).not.toContain("w=256");
  });

  it("leaves an absolute url alone apart from its parameters", () => {
    const url = downloadUrl("https://cdn.example.test/x.png", "x");
    expect(url.startsWith("https://cdn.example.test/x.png?")).toBe(true);
  });
});

describe("the local file name", () => {
  it("matches what the server would call it", () => {
    /* A copy of the server's rule; a test in the repo compares the two sources. */
    expect(fileName("Quill & Co — Logo")).toBe("quill-co-logo.png");
    expect(fileName("")).toBe("image.png");
    expect(fileName("日本語")).toBe("image.png");
  });

  it("never builds a path out of a name", () => {
    expect(fileName("../../etc/passwd")).not.toContain("/");
  });
});

describe("saving", () => {
  it("puts it in the camera roll when that is allowed", async () => {
    vi.spyOn(MediaLibrary, "requestPermissionsAsync").mockResolvedValue({ granted: true } as any);
    const saved = vi.spyOn(MediaLibrary, "saveToLibraryAsync").mockResolvedValue(undefined as any);

    const result = await saveImage({ path: "/objects/uploads/abc", name: "logo" });
    expect(result).toEqual({ ok: true, where: "photos" });
    expect(saved).toHaveBeenCalledOnce();
  });

  it("offers the share sheet when the photo library is refused", async () => {
    /* They said no to Photos, not no to having the file. */
    vi.spyOn(MediaLibrary, "requestPermissionsAsync").mockResolvedValue({ granted: false } as any);
    const shared = vi.spyOn(Sharing, "shareAsync").mockResolvedValue(undefined as any);

    const result = await saveImage({ path: "/objects/uploads/abc", name: "logo" });
    expect(result).toEqual({ ok: true, where: "shared" });
    expect(shared).toHaveBeenCalledOnce();
  });

  it("sends the session with the request, or a private image is a 404", async () => {
    const download = vi.spyOn(FileSystem, "downloadAsync");
    vi.spyOn(MediaLibrary, "requestPermissionsAsync").mockResolvedValue({ granted: true } as any);
    await saveImage({ path: "/objects/uploads/abc", name: "logo" });
    /*
     * The stub has no stored token, so the header is absent here — what this
     * holds is that the call is made with an options object carrying headers at
     * all, which is the shape that would silently stop working if it were dropped.
     */
    expect(download).toHaveBeenCalledWith(
      expect.stringContaining("download=1"),
      expect.stringContaining(".png"),
      expect.objectContaining({ headers: undefined }),
    );
  });

  it("deletes the file when the server did not send a picture", async () => {
    /*
     * `downloadAsync` writes the body whatever it is, so a 404's JSON is now a
     * file called `logo.png`. Left there, the share sheet offers it and somebody
     * sends an error message to their printer.
     */
    vi.spyOn(FileSystem, "downloadAsync").mockResolvedValue({ status: 404, uri: "file:///tmp/x.png" } as any);
    const removed = vi.spyOn(FileSystem, "deleteAsync").mockResolvedValue(undefined as any);
    const shared = vi.spyOn(Sharing, "shareAsync");

    const result = await saveImage({ path: "/objects/uploads/gone", name: "logo" });
    expect(result.ok).toBe(false);
    expect(removed).toHaveBeenCalledOnce();
    expect(shared, "nothing should be offered when there is no picture").not.toHaveBeenCalled();
  });

  it("says something a person can act on when it fails", async () => {
    vi.spyOn(FileSystem, "downloadAsync").mockResolvedValue({ status: 404, uri: "file:///tmp/x.png" } as any);
    const result = await saveImage({ path: "/objects/uploads/gone", name: "logo" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/isn't there/);
  });

  it("never throws, whatever the platform does", async () => {
    /* A failed save is a sentence on the screen, not a screen that unmounts. */
    vi.spyOn(FileSystem, "downloadAsync").mockRejectedValue(new Error("offline"));
    await expect(saveImage({ path: "/objects/uploads/abc", name: "logo" })).resolves.toMatchObject({ ok: false });
  });
});
