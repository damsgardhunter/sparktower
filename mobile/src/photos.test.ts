/**
 * Picking a photo: what it asks for, what it hands back, and what it says
 * when it can't.
 *
 * The permission is the part worth testing. It is the most likely outcome
 * after "cancelled", it can be refused in two different ways, and the
 * difference matters: one of them can be asked about again and the other can
 * only be changed in Settings, so an app that says "allow access when we ask"
 * to somebody who has already said never is telling them to wait for a dialog
 * that will not come.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { pickPhoto, PhotoAccessError } from "./photos";

const picker = () => (globalThis as any).__picker;
const platform = () => (globalThis as any).__rnPlatform;

beforeEach(() => {
  (globalThis as any).__picker = { permission: { granted: true, canAskAgain: true }, result: { canceled: true }, launched: [] };
  (globalThis as any).__documentPicker = { result: { canceled: true }, asked: [] };
  platform().OS = "ios";
});

describe("pickPhoto", () => {
  it("returns nothing when they back out, without complaining", async () => {
    await expect(pickPhoto()).resolves.toBeNull();
  });

  it("asks for photos only, and full quality", async () => {
    await pickPhoto();
    expect(picker().launched[0].mediaTypes).toEqual(["images"]);
    expect(picker().launched[0].quality, "a screenshot re-compressed twice looks it").toBe(1);
    expect(picker().launched[0].allowsMultipleSelection).toBe(false);
  });

  it("takes videos too where the surface allows them", async () => {
    await pickPhoto({ videos: true });
    expect(picker().launched[0].mediaTypes).toEqual(["images", "videos"]);
  });

  it("hands back what an upload needs", async () => {
    picker().result = {
      canceled: false,
      assets: [{ uri: "file:///tmp/IMG_0042.HEIC", fileName: "IMG_0042.HEIC", mimeType: "image/heic", fileSize: 2_400_000 }],
    };
    await expect(pickPhoto()).resolves.toEqual({
      uri: "file:///tmp/IMG_0042.HEIC", name: "IMG_0042.HEIC", mimeType: "image/heic", size: 2_400_000,
    });
  });

  it("names a photo that arrived without one, after what is actually being sent", async () => {
    /*
     * iOS gives no `fileName` for some assets — one pasted in, or shared from
     * another app — and the upload needs something to call it. The extension
     * has to match the type, or the object is stored under a name that lies.
     */
    picker().result = { canceled: false, assets: [{ uri: "file:///tmp/x", mimeType: "image/png" }] };
    const file = await pickPhoto();
    expect(file!.name).toMatch(/^photo-\d+\.png$/);

    picker().result = { canceled: false, assets: [{ uri: "file:///tmp/y", mimeType: "image/jpeg" }] };
    expect((await pickPhoto())!.name, "jpeg is spelled jpg on a filename").toMatch(/\.jpg$/);

    picker().result = { canceled: false, assets: [{ uri: "file:///tmp/z" }] };
    const guessed = await pickPhoto();
    expect(guessed!.mimeType, "something has to be assumed, and a photo is a jpeg").toBe("image/jpeg");
    expect(guessed!.name).toMatch(/\.jpg$/);
  });

  it("calls a video a video when the library doesn't say", async () => {
    picker().result = { canceled: false, assets: [{ uri: "file:///tmp/clip", type: "video" }] };
    expect((await pickPhoto({ videos: true }))!.mimeType).toBe("video/mp4");
  });

  describe("when photos are refused", () => {
    it("says what it needs, while the dialog can still be shown", async () => {
      picker().permission = { granted: false, canAskAgain: true };
      const err = await pickPhoto().catch((e) => e);
      expect(err).toBeInstanceOf(PhotoAccessError);
      expect(err.settings, "asking again is still possible, so don't send them to Settings").toBe(false);
      expect(err.message).toMatch(/needs access to your photos/);
    });

    it("sends them to the right place once the dialog is spent, per platform", async () => {
      picker().permission = { granted: false, canAskAgain: false };
      const onIphone = await pickPhoto().catch((e) => e);
      expect(onIphone.settings).toBe(true);
      expect(onIphone.message, "the path a person can actually follow").toContain("Settings › SparkTower › Photos");

      platform().OS = "android";
      const onAndroid = await pickPhoto().catch((e) => e);
      expect(onAndroid.message).toContain("Permissions");
    });

    it("never opens the library after a refusal", async () => {
      picker().permission = { granted: false, canAskAgain: true };
      await pickPhoto().catch(() => {});
      expect(picker().launched).toHaveLength(0);
    });
  });
});

/**
 * A build made before the photo library existed.
 *
 * The picker is a native module: install the package and a phone running
 * yesterday's binary still has the JavaScript half and not the native one, so
 * the first call throws. Only a rebuild fixes that, and somebody on the older
 * build should not lose the ability to add a picture in the meantime.
 */
describe("when the build has no photo library in it", () => {
  const withoutNative = async (run: () => Promise<any>) => {
    (globalThis as any).__picker.native = false;
    try { return await run(); } finally { (globalThis as any).__picker.native = true; }
  };

  it("falls back to Files rather than throwing", async () => {
    (globalThis as any).__documentPicker.result = {
      canceled: false,
      assets: [{ uri: "file:///tmp/from-files.png", name: "from-files.png", mimeType: "image/png", size: 4242 }],
    };
    const file = await withoutNative(() => pickPhoto());
    expect(file).toEqual({ uri: "file:///tmp/from-files.png", name: "from-files.png", mimeType: "image/png", size: 4242 });
    expect(picker().launched, "the native picker was never asked").toHaveLength(0);
    expect((globalThis as any).__documentPicker.asked[0].type).toEqual(["image/*"]);
  });

  it("asks for videos too where the surface takes them", async () => {
    await withoutNative(() => pickPhoto({ videos: true }));
    expect((globalThis as any).__documentPicker.asked[0].type).toContain("video/mp4");
  });

  it("still returns nothing when they back out", async () => {
    await expect(withoutNative(() => pickPhoto())).resolves.toBeNull();
  });
});

