/**
 * The crop arithmetic, which fails in a way nobody notices until a face is gone.
 *
 * Every surface that shows a picture in a fixed shape used `object-cover` or
 * `bg-cover bg-center`: fill the shape from the middle, discard the rest. The
 * two photos that prompted this were a 978x673 landscape screenshot in a round
 * avatar, which lost both sides, and a 4032x3024 phone photo in a band the page
 * rendered nearer 8:1, which kept a strip through the middle and cut the top of
 * a head off. Neither is a crash and neither logs anything.
 *
 * So these tests are about the properties that make a cropper trustworthy, and
 * two of them are the bugs every hand-rolled one ships with: a crop that can be
 * dragged off the edge of its own image, and a drag that moves the wrong way.
 */
import { describe, it, expect } from "vitest";
import {
  CROP_PRESETS, MAX_ZOOM, clampTransform, clampZoom, cropRect, initialTransform,
  largestFittingRect, panBy, previewStyle, zoomTo,
} from "../../client/src/lib/image-crop";

/** The two photos this was written for. */
const SCREENSHOT = { w: 978, h: 673 };
const PHONE_PHOTO = { w: 4032, h: 3024 };

describe("the largest crop a shape can hold", () => {
  it("is limited by height on a wide photo and by width on a tall one", () => {
    /* A landscape photo cropped square: the square is as tall as the photo. */
    expect(largestFittingRect(978, 673, 1)).toEqual({ width: 673, height: 673 });
    /* A portrait photo cropped square: as wide as the photo. */
    expect(largestFittingRect(673, 978, 1)).toEqual({ width: 673, height: 673 });
  });

  it("never asks for more than the photo has", () => {
    for (const aspect of [1, 4, 0.5, 16 / 9]) {
      for (const [w, h] of [[978, 673], [4032, 3024], [100, 4000], [4000, 100]] as const) {
        const rect = largestFittingRect(w, h, aspect);
        expect(rect.width, `${w}x${h} @ ${aspect}`).toBeLessThanOrEqual(w + 1e-6);
        expect(rect.height, `${w}x${h} @ ${aspect}`).toBeLessThanOrEqual(h + 1e-6);
        expect(rect.width / rect.height).toBeCloseTo(aspect, 6);
      }
    }
  });

  /* A 4:1 band from a 4:3 photo keeps a quarter of its height — which is the
   * whole reason the person has to be asked which quarter. */
  it("shows how little of a phone photo a cover band can hold", () => {
    const rect = largestFittingRect(PHONE_PHOTO.w, PHONE_PHOTO.h, CROP_PRESETS.cover.aspect);
    expect(rect.width).toBe(4032);
    expect(rect.height).toBe(1008);
    expect(rect.height / PHONE_PHOTO.h).toBeCloseTo(0.333, 2);
  });
});

describe("the crop stays inside the photo", () => {
  /*
   * The bug this is here for. Pan hard in every direction at several zooms and
   * the crop must still be a rectangle of the image — a cropper that clamps a
   * pan offset instead of the centre drifts out the moment the zoom changes
   * while the pan stays put, and bakes a transparent or black margin into
   * somebody's avatar.
   */
  it("however hard it is dragged, at any zoom", () => {
    for (const { w, h } of [SCREENSHOT, PHONE_PHOTO, { w: 200, h: 4000 }]) {
      for (const aspect of [1, 4]) {
        for (const zoom of [1, 1.01, 2, 3.7, MAX_ZOOM]) {
          for (const [dx, dy] of [[1e6, 1e6], [-1e6, -1e6], [1e6, -1e6], [0, 0]] as const) {
            const t = panBy(w, h, aspect, { zoom, centerX: w / 2, centerY: h / 2 }, dx, dy, 400);
            const rect = cropRect(w, h, aspect, t);
            const where = `${w}x${h} a=${aspect} z=${zoom} d=${dx},${dy}`;
            expect(rect.x, where).toBeGreaterThanOrEqual(-1e-6);
            expect(rect.y, where).toBeGreaterThanOrEqual(-1e-6);
            expect(rect.x + rect.width, where).toBeLessThanOrEqual(w + 1e-6);
            expect(rect.y + rect.height, where).toBeLessThanOrEqual(h + 1e-6);
            expect(rect.width / rect.height, where).toBeCloseTo(aspect, 6);
          }
        }
      }
    }
  });

  /*
   * And the specific sequence that breaks an offset-based cropper: zoom in,
   * shove the crop into a corner, then zoom back out. The crop grows, and
   * whatever it was resting against is now too close.
   */
  it("after zooming in, panning to a corner, and zooming back out", () => {
    const { w, h } = PHONE_PHOTO;
    let t = initialTransform(w, h, 1);
    t = zoomTo(w, h, 1, t, 4);
    t = panBy(w, h, 1, t, 1e6, 1e6, 400);   // into a corner
    t = zoomTo(w, h, 1, t, 1);              // all the way back out
    const rect = cropRect(w, h, 1, t);
    expect(rect.x).toBeGreaterThanOrEqual(-1e-6);
    expect(rect.y).toBeGreaterThanOrEqual(-1e-6);
    expect(rect.x + rect.width).toBeLessThanOrEqual(w + 1e-6);
    expect(rect.y + rect.height).toBeLessThanOrEqual(h + 1e-6);
  });

  /* At zoom 1 the limiting axis has exactly one legal position, so panning along it does nothing. */
  it("cannot be panned along an axis it already fills", () => {
    const { w, h } = SCREENSHOT;
    const start = initialTransform(w, h, 1);
    const pushed = panBy(w, h, 1, start, 0, 500, 400);
    expect(pushed.centerY, "a square crop of a landscape photo already uses its full height")
      .toBeCloseTo(start.centerY, 6);
    const sideways = panBy(w, h, 1, start, 500, 0, 400);
    expect(sideways.centerX, "but it can still move sideways").not.toBeCloseTo(start.centerX, 6);
  });
});

describe("dragging", () => {
  /* The other classic: a cropper that fights the mouse. Dragging the photo
   * right must bring what was off to its left into view, which means the crop
   * moves left. */
  it("moves the photo with the pointer, not against it", () => {
    const { w, h } = PHONE_PHOTO;
    const start = zoomTo(w, h, 1, initialTransform(w, h, 1), 2);
    expect(panBy(w, h, 1, start, 50, 0, 400).centerX).toBeLessThan(start.centerX);
    expect(panBy(w, h, 1, start, -50, 0, 400).centerX).toBeGreaterThan(start.centerX);
    expect(panBy(w, h, 1, start, 0, 50, 400).centerY).toBeLessThan(start.centerY);
  });

  it("moves further per pixel when zoomed out than when zoomed in", () => {
    const { w, h } = PHONE_PHOTO;
    const out = zoomTo(w, h, 1, initialTransform(w, h, 1), 1.2);
    const inn = zoomTo(w, h, 1, initialTransform(w, h, 1), 4);
    const movedOut = Math.abs(panBy(w, h, 1, out, 20, 0, 400).centerX - out.centerX);
    const movedIn = Math.abs(panBy(w, h, 1, inn, 20, 0, 400).centerX - inn.centerX);
    expect(movedIn, "zoomed in, the same drag covers less of the photo").toBeLessThan(movedOut);
  });
});

describe("the zoom", () => {
  it("never goes below 1, because below 1 would letterbox", () => {
    expect(clampZoom(0)).toBe(1);
    expect(clampZoom(-4)).toBe(1);
    expect(clampZoom(0.99)).toBe(1);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(1e9)).toBe(MAX_ZOOM);
  });

  it("makes the crop smaller, which is what zooming in means", () => {
    const { w, h } = PHONE_PHOTO;
    const one = cropRect(w, h, 1, initialTransform(w, h, 1));
    const three = cropRect(w, h, 1, zoomTo(w, h, 1, initialTransform(w, h, 1), 3));
    expect(three.width).toBeCloseTo(one.width / 3, 6);
  });
});

describe("where it opens", () => {
  it("centred, holding as much of the photo as the shape allows", () => {
    const { w, h } = SCREENSHOT;
    const t = initialTransform(w, h, 1);
    expect(t.zoom).toBe(1);
    expect(t.centerX).toBeCloseTo(w / 2, 6);
    expect(t.centerY).toBeCloseTo(h / 2, 6);
    /* Which is the old behaviour — so opening the dialog and pressing straight
     * through gives exactly what the page used to do unasked. */
    const rect = cropRect(w, h, 1, t);
    expect(rect.height).toBe(h);
    expect(rect.x).toBeCloseTo((w - h) / 2, 6);
  });

  it("survives a degenerate image rather than producing NaN", () => {
    for (const [w, h] of [[0, 0], [1, 0], [0, 1], [Number.NaN, 10]] as const) {
      const t = clampTransform(w, h, 1, { zoom: 1, centerX: Number.NaN, centerY: Number.NaN });
      expect(Number.isFinite(t.zoom), `${w}x${h}`).toBe(true);
      expect(Number.isFinite(t.centerX), `${w}x${h}`).toBe(true);
      expect(Number.isFinite(t.centerY), `${w}x${h}`).toBe(true);
    }
  });
});

describe("the preview on screen", () => {
  /*
   * The preview is a scaled `<img>` rather than a canvas, so these two have to
   * agree by arithmetic: whatever the frame shows is what `renderCrop` will
   * draw. If they disagree the dialog is a lie again, just a prettier one.
   */
  it("scales and offsets the photo so the frame shows exactly the crop", () => {
    const { w, h } = PHONE_PHOTO;
    const frame = 480;
    const t = zoomTo(w, h, CROP_PRESETS.cover.aspect, initialTransform(w, h, CROP_PRESETS.cover.aspect), 1.8);
    const rect = cropRect(w, h, CROP_PRESETS.cover.aspect, t);
    const style = previewStyle(w, h, CROP_PRESETS.cover.aspect, t, frame);

    const scale = style.width / w;
    expect(rect.width * scale, "the crop fills the frame's width").toBeCloseTo(frame, 4);
    expect(-style.left / scale, "and starts where the crop starts").toBeCloseTo(rect.x, 4);
    expect(-style.top / scale).toBeCloseTo(rect.y, 4);
  });
});

describe("the shapes the app actually shows", () => {
  /* The aspects are measurements of real layout, not taste — the avatar is a
   * circle and the profile cover band is `aspect-[4/1]`. A frame that does not
   * match where the picture lands is the bug being fixed. */
  it("are a square avatar and a 4:1 cover, stored big enough for a retina header", () => {
    expect(CROP_PRESETS.avatar.aspect).toBe(1);
    expect(CROP_PRESETS.avatar.outWidth).toBe(CROP_PRESETS.avatar.outHeight);
    expect(CROP_PRESETS.cover.aspect).toBe(4);
    expect(CROP_PRESETS.cover.outWidth / CROP_PRESETS.cover.outHeight).toBe(4);
    for (const preset of Object.values(CROP_PRESETS)) {
      expect(preset.outWidth).toBeGreaterThanOrEqual(512);
    }
  });
});
