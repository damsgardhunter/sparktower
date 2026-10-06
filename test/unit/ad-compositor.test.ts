/**
 * The compositor, and the rhythm it renders.
 *
 * `composeShot` returns ffmpeg's arguments and runs nothing, which is the
 * whole reason this is testable: a filtergraph is a long string with exact
 * escaping, a wrong comma is a silent no-op, and the only way to know what
 * will be rendered is to read the arguments. So the arguments are the unit
 * under test and ffmpeg is not.
 */
import { describe, it, expect } from "vitest";
import { AD_DURATIONS, AD_FORMATS, beatPlan } from "@shared/ads";
import { AD_STYLES, adStyle } from "@shared/ad-styles";
import { CHANNEL_PIECES, PLATE_SECONDS, SHOT_KINDS, generationsFor, planPlates, planShots } from "@shared/ad-shots";
import { SAFE_AREAS, YOUTUBE_OUTRO_RULE, safeBox } from "@shared/ad-safe-areas";
import { composeShot, composeConcat, escapeDrawText, ffColor , escapeDrawText } from "../../server/ad-compositor";

const BRAND = { primaryColor: "#1B9AAA", backgroundColor: "#0B2027", displayName: "ACME" };
const shot = (over: Partial<Parameters<typeof composeShot>[0]> = {}) => composeShot({
  input: "/tmp/plate.mp4", startSeconds: 0, seconds: 2, format: "vertical",
  brand: BRAND, output: "/tmp/out.mp4", ...over,
});

describe("the shot vocabulary", () => {
  it("offers the three lengths that read as professional", () => {
    expect(SHOT_KINDS.map((k) => k.id)).toEqual(["punch", "scene", "sweep"]);
    expect(SHOT_KINDS.find((k) => k.id === "punch")).toMatchObject({ minSeconds: 1, maxSeconds: 2 });
    expect(SHOT_KINDS.find((k) => k.id === "scene")).toMatchObject({ minSeconds: 3, maxSeconds: 5 });
    expect(SHOT_KINDS.find((k) => k.id === "sweep")).toMatchObject({ minSeconds: 5, maxSeconds: 10 });
  });

  it("never offers a still shot", () => {
    /*
     * A still frame on a feed is a frame somebody scrolls past. Where nothing
     * in the scene moves, the camera does — so every kind carries camera
     * moves and none of them is "static" or "locked off".
     */
    for (const k of SHOT_KINDS) {
      expect(k.camera.length, k.id).toBeGreaterThanOrEqual(3);
      for (const move of k.camera) {
        expect(move, `${k.id}: "${move}"`).not.toMatch(/\bstatic\b|\blocked off\b|\bstill\b|\bno movement\b/i);
      }
    }
  });
});

describe("the cut list", () => {
  it("fills the runtime exactly, for every style and length", () => {
    /*
     * The bug this catches was real: forcing each kind's minimum turned one
     * second of a remaining beat into a three-second scene, and a six-second
     * advert came out at nine. An overrun is either a late call to action or
     * an advert that stops mid-sentence.
     */
    for (const style of AD_STYLES) {
      for (const d of AD_DURATIONS) {
        const shots = planShots(beatPlan(d, style.beatWeights));
        const total = shots.reduce((sum, s) => sum + s.seconds, 0);
        expect(total, `${style.id} at ${d}s`).toBe(d);
      }
    }
  });

  it("never emits a shot shorter than its kind allows", () => {
    for (const style of AD_STYLES) {
      for (const d of AD_DURATIONS) {
        for (const s of planShots(beatPlan(d, style.beatWeights))) {
          const kind = SHOT_KINDS.find((k) => k.id === s.kind)!;
          /* A 0.4-second punch is a glitch, not a cut. */
          expect(s.seconds, `${style.id} ${d}s ${s.kind}`).toBeGreaterThanOrEqual(kind.minSeconds);
        }
      }
    }
  });

  it("keeps the brand recurring without being on every frame", () => {
    /*
     * The first shot and the last always carry it — the first because somebody
     * who leaves after two seconds should still know whose advert it was, the
     * last because that is the one they act on. A brand on every frame reads
     * as a screensaver and stops being seen.
     */
    const shots = planShots(beatPlan(30, adStyle("problem_solution")!.beatWeights));
    expect(shots[0].brandMoment).toBe(true);
    expect(shots[shots.length - 1].brandMoment).toBe(true);
    const branded = shots.filter((s) => s.brandMoment).length;
    expect(branded).toBeGreaterThan(1);
    expect(branded, "not every shot").toBeLessThan(shots.length);
  });
});

describe("plates: what the generations actually cost", () => {
  it("never asks for a length the model does not sell", () => {
    for (const style of AD_STYLES) {
      for (const d of AD_DURATIONS) {
        for (const p of planPlates(planShots(beatPlan(d, style.beatWeights)))) {
          expect(PLATE_SECONDS as readonly number[], `${style.id} ${d}s`).toContain(p.seconds);
        }
      }
    }
  });

  it("fits every shot inside the plate it was assigned", () => {
    /* A window running past the end of a clip renders black. */
    for (const style of AD_STYLES) {
      for (const d of AD_DURATIONS) {
        for (const p of planPlates(planShots(beatPlan(d, style.beatWeights)))) {
          const used = p.windows.reduce((sum, w) => sum + w.seconds, 0);
          expect(used, `${style.id} ${d}s`).toBeLessThanOrEqual(p.seconds);
          for (const w of p.windows) {
            expect(w.startSeconds + w.seconds, "window inside the plate").toBeLessThanOrEqual(p.seconds);
          }
        }
      }
    }
  });

  it("costs no more generations than there are shots, and usually fewer", () => {
    /*
     * The measured saving is one or two out of seven to ten — worth having
     * and not transformative. Asserted as a direction rather than a number,
     * because the number moves with the rhythm and a brittle figure here
     * would be edited to match rather than investigated.
     */
    let savedSomewhere = false;
    for (const style of AD_STYLES) {
      for (const d of AD_DURATIONS) {
        const shots = planShots(beatPlan(d, style.beatWeights));
        const plates = generationsFor(planPlates(shots));
        expect(plates, `${style.id} ${d}s`).toBeLessThanOrEqual(shots.length);
        if (plates < shots.length) savedSomewhere = true;
      }
    }
    expect(savedSomewhere, "packing should save something somewhere").toBe(true);
  });

  it("never cuts into a sweep", () => {
    /*
     * Its whole value is being unbroken.
     *
     * Worth knowing how this is actually guaranteed: a sweep is 5–10 seconds
     * and a plate is sized to hold it, so it fills its plate and nothing else
     * fits regardless of the branch that puts it there. Deleting that branch
     * does not break this property, which a mutation proved — so the branch is
     * explicitness rather than protection, and the test below checks the thing
     * it really does control.
     */
    for (const style of AD_STYLES) {
      const shots = planShots(beatPlan(30, style.beatWeights));
      for (const p of planPlates(shots)) {
        const kinds = p.windows.map((w) => shots[w.shotIndex].kind);
        if (kinds.includes("sweep")) expect(p.windows.length, "a sweep is alone on its plate").toBe(1);
      }
    }
  });

  it("buys the right length of clip for a sweep", () => {
    /*
     * What the sweep branch observably decides. A ten-second orbit asked for
     * as a five-second clip is a render that runs out halfway, and the window
     * past the end is black.
     */
    const long = planPlates([{ kind: "sweep", seconds: 8, beat: "product", camera: "orbit", brandMoment: false }]);
    expect(long[0].seconds, "an 8s sweep needs the 10s clip").toBe(10);
    const short = planPlates([{ kind: "sweep", seconds: 5, beat: "product", camera: "orbit", brandMoment: false }]);
    expect(short[0].seconds, "a 5s sweep fits the 5s clip").toBe(5);
  });
});

describe("safe areas", () => {
  it("keeps out of the furniture on every format", () => {
    for (const f of AD_FORMATS) {
      const area = SAFE_AREAS[f.id];
      const box = safeBox(f, area);
      expect(box.x, f.id).toBeGreaterThan(0);
      expect(box.y, f.id).toBeGreaterThan(0);
      expect(box.x + box.width, f.id).toBeLessThan(f.width);
      expect(box.y + box.height, f.id).toBeLessThan(f.height);
      /* And says why, because an inset with no reason gets "optimised" away. */
      expect(area.why.length, f.id).toBeGreaterThan(50);
    }
  });

  it("reserves more of the bottom on vertical, where the caption lives", () => {
    expect(SAFE_AREAS.vertical.bottom).toBeGreaterThan(SAFE_AREAS.wide.bottom);
    /* And the right, where the buttons are. */
    expect(SAFE_AREAS.vertical.right).toBeGreaterThan(SAFE_AREAS.vertical.left);
  });

  it("puts a YouTube outro's brand where the end screens are not", () => {
    expect(YOUTUBE_OUTRO_RULE.brandCorner).toBe("bottom-left");
    /* The reserved region must actually exclude the bottom-left corner. */
    const r = YOUTUBE_OUTRO_RULE.reserved;
    expect(r.x, "the left edge is free").toBeGreaterThan(0);
    expect(r.y + r.height, "the bottom edge is free").toBeLessThan(1);
  });
});

describe("the ffmpeg arguments", () => {
  it("fills the frame rather than letterboxing it", () => {
    /* Bars on an advert look like a mistake; on a vertical feed they look
     * like a landscape video nobody cropped. */
    const args = shot().join(" ");
    expect(args).toContain("force_original_aspect_ratio=increase");
    expect(args).toContain("crop=1080:1920");
  });

  it("takes only the window it was given", () => {
    const args = shot({ startSeconds: 3, seconds: 2 });
    expect(args[args.indexOf("-ss") + 1]).toBe("3");
    expect(args[args.indexOf("-t") + 1]).toBe("2");
  });

  it("renders text with a font we ship, in the brand's colour", () => {
    const args = shot({ lines: [{ text: "Order now", atHeight: 0.5, sizeRatio: 0.06 }] }).join(" ");
    expect(args).toMatch(/fontfile='[^']*SpaceGrotesk/);
    expect(args).toContain(ffColor(BRAND.primaryColor));
  });

  it("builds bubble lettering as three passes, widest first", () => {
    /*
     * ffmpeg draws one outline per `drawtext`, so lettering that sits on the
     * video is the same string painted three times: halo, outline, fill. Each
     * covers the middle of the last, which is what leaves an even band of
     * each colour — and it is why the halo must be the wider of the two.
     *
     * This replaced a box behind the text, which worked by hiding the footage
     * and looked like a subtitle. An earlier version of this test asserted
     * `box=1` and stayed green until the design changed under it.
     */
    const args = shot({ lines: [{ text: "Order now", atHeight: 0.5, sizeRatio: 0.06 }] }).join(" ");
    const borders = [...args.matchAll(/borderw=(\d+)/g)].map((m) => Number(m[1]));
    expect(borders.length, "a halo and an outline").toBe(2);
    expect(borders[0], "the halo is drawn first and wider").toBeGreaterThan(borders[1]);
    expect((args.match(/drawtext=/g) ?? []).length, "three passes of the same line").toBe(3);
  });

  it("puts the shadow on one layer only", () => {
    /* Drawn under all three it is three shadows, which muddies rather than lifts. */
    const args = shot({ lines: [{ text: "Hi", atHeight: 0.5, sizeRatio: 0.06 }] }).join(" ");
    expect((args.match(/shadowcolor=/g) ?? []).length).toBe(1);
  });

  it("drops to a single outline when the brand wants quieter", () => {
    const args = shot({ typeStyle: "outline", lines: [{ text: "Hi", atHeight: 0.5, sizeRatio: 0.06 }] }).join(" ");
    expect([...args.matchAll(/borderw=/g)].length).toBe(1);
  });

  it("drops the plate's audio", () => {
    /* The model's audio is not the advert's audio. */
    expect(shot()).toContain("-an");
  });

  it("locks the frame rate and pixel format, so shots concat without a re-encode", () => {
    const args = shot().join(" ");
    expect(args).toContain("fps=24");
    expect(args).toContain("setsar=1");
    expect(args).toContain("yuv420p");
  });

  it("puts text above the logo and the bar, not under them", () => {
    /* Order in the chain is what decides which thing is hidden. */
    const args = shot({ brandBar: true, lines: [{ text: "Hi", atHeight: 0.5, sizeRatio: 0.06 }] }).join(" ");
    expect(args.indexOf("drawbox")).toBeLessThan(args.indexOf("drawtext"));
  });

  it("composites the logo from a file, never asks a model for one", () => {
    const args = shot({ logoFile: "/tmp/logo.png" });
    expect(args).toContain("/tmp/logo.png");
    expect(args.join(" ")).toContain("overlay=");
    /* Two inputs: the plate and the logo. */
    expect(args.filter((a) => a === "-i")).toHaveLength(2);
  });

  it("starts the file so a feed can play it before it has all arrived", () => {
    expect(shot().join(" ")).toContain("+faststart");
  });
});

describe("drawtext escaping", () => {
  it("survives a business name with punctuation in it", () => {
    /*
     * "Mum's: Kitchen" is not an unusual name, and a colon, an apostrophe and
     * a percent sign each break the filter parser in a different way.
     */
    const escaped = escapeDrawText("Mum's: Kitchen 50% off");
    expect(escaped).not.toMatch(/(?<!\\)'/);
    /*
     * One backslash on the colon, and none on the percent.
     *
     * This test asserted two of each, and it passed for as long as the code
     * was wrong — because it checked the escaping against itself rather than
     * against ffmpeg. The double colon failed a render at composition after
     * four clips had been paid for, and the escaped percent drew a blank frame
     * while exiting zero. Both were settled by rendering a frame and looking
     * at it; `expansion=none` is what makes the bare percent safe.
     */
    expect(escaped).toBe("Mum’s\\: Kitchen 50% off");
  });

  it("produces arguments ffmpeg will accept for a punctuated line", () => {
    const args = shot({ lines: [{ text: "Mum's: 50% off", atHeight: 0.5, sizeRatio: 0.06 }] }).join(" ");
    /* The raw colon must not survive inside the drawtext value, and one backslash is what escapes it. */
    expect(args).toContain("text='Mum’s\\: 50% off'");
    expect(args, "a bare percent is only safe with expansion off").toContain("expansion=none");
  });

  it("turns a hex colour into what ffmpeg wants", () => {
    expect(ffColor("#1B9AAA")).toBe("0x1B9AAA@1");
    expect(ffColor("#1B9AAA", 0.8)).toBe("0x1B9AAA@0.8");
  });
});

describe("joining the shots", () => {
  it("copies rather than re-encodes", () => {
    /* Every shot is already the same size, rate and format, so a second
     * encode would cost time and a generation of quality for nothing. */
    const args = composeConcat("/tmp/list.txt", "/tmp/final.mp4");
    expect(args).toContain("-c");
    expect(args[args.indexOf("-c") + 1]).toBe("copy");
    expect(args.join(" ")).toContain("-f concat");
    /* Without `-safe 0` ffmpeg refuses the paths we wrote. */
    expect(args.join(" ")).toContain("-safe 0");
  });
});

describe("the two pieces a channel needs", () => {
  it("has an intro short enough to be the same every week", () => {
    const intro = CHANNEL_PIECES.find((p) => p.id === "intro")!;
    expect(intro.seconds).toBeLessThanOrEqual(5);
    expect(intro.shots.reduce((s, x) => s + x.seconds, 0)).toBe(intro.seconds);
  });

  it("has an outro long enough for YouTube's end screens", () => {
    /* They occupy the last twenty seconds; an outro shorter than that leaves
     * them drawn over whatever came before. */
    const outro = CHANNEL_PIECES.find((p) => p.id === "outro")!;
    expect(outro.seconds).toBeGreaterThanOrEqual(20);
    expect(outro.safeAreas).toMatch(/end.screen/i);
    expect(outro.brand).toMatch(/never centred|bottom-left/i);
  });
});

/**
 * The product, which is the whole reason the model is never asked to draw it.
 *
 * A business will not publish an advert where their own thing looks wrong, and
 * a video model distorts logos, garbles labels and changes a shape between
 * frames. So the product arrives as their photograph and is composited at a
 * size and position we control.
 */
describe("compositing the product", () => {
  const withProduct = (over: Record<string, unknown> = {}) =>
    shot({ product: { file: "/tmp/bottle.png", cutOut: true, ...over } as never });

  it("takes the photograph as an input", () => {
    const args = withProduct();
    expect(args).toContain("/tmp/bottle.png");
    expect(args.join(" ")).toContain("overlay=");
  });

  it("stands it on the point given, not through it", () => {
    /*
     * The bug this guards: a product positioned by its centre floats. The
     * point you can see in the plate is the surface it should stand on, and
     * anchoring the middle of a bottle to a table top puts half of it through
     * the table. The first render did exactly that.
     */
    const base = withProduct({ anchor: "base", at: { x: 0.5, y: 0.6 } }).join(" ");
    expect(base).toMatch(/y=\d+-overlay_h(?!\/)/);
    const centre = withProduct({ anchor: "centre", at: { x: 0.5, y: 0.6 } }).join(" ");
    expect(centre).toMatch(/y=\d+-overlay_h\/2/);
  });

  it("defaults to standing on it, because that is almost always right", () => {
    expect(withProduct().join(" ")).toMatch(/y=\d+-overlay_h(?!\/)/);
  });

  it("gives a rectangular photograph a card rather than pasting it flat", () => {
    /*
     * Nothing here removes a background: a bad automatic cut-out of somebody's
     * product is worse than an honest card. So a photo that is not already cut
     * out gets a border, which reads as deliberate.
     */
    const flat = withProduct({ cutOut: false }).join(" ");
    expect(flat).toContain("pad=");
    const cut = withProduct({ cutOut: true }).join(" ");
    expect(cut).not.toContain("pad=");
  });

  it("never blurs the plate to make a shadow", () => {
    /*
     * The regression this exists for. The first contact shadow was a drawbox
     * followed by `boxblur`, which blurs the whole frame — the plate came out
     * of focus and nothing failed, because nothing was looking at a frame. A
     * shadow is a thing on top of the video, not something done to the video.
     */
    const args = withProduct({ contactShadow: true, at: { x: 0.5, y: 0.6 } }).join(" ");
    expect(args, "boxblur applies to the whole layer it is in").not.toContain("boxblur");
  });

  it("draws the shadow under the product, as its own layer", () => {
    const args = withProduct({ contactShadow: true }, ).join(" ");
    /* Without a prepared file there is nothing to overlay — `renderShot` makes it. */
    const withFile = shot({
      product: { file: "/tmp/bottle.png", cutOut: true, contactShadow: true } as never,
      shadowFile: "/tmp/shadow.png",
    }).join(" ");
    expect(withFile).toContain("/tmp/shadow.png");
    expect(withFile.indexOf("/tmp/shadow.png"), "shadow input comes before the product")
      .toBeLessThan(withFile.indexOf("/tmp/bottle.png"));
    expect(args).toBeTruthy();
  });

  it("layers shadow, then product, then logo, then text", () => {
    /*
     * Order decides what is hidden. Text last and above everything, because it
     * is the one thing that must never be obscured.
     */
    const args = shot({
      product: { file: "/tmp/bottle.png", cutOut: true, contactShadow: true } as never,
      shadowFile: "/tmp/shadow.png",
      logoFile: "/tmp/logo.png",
      lines: [{ text: "Buy", atHeight: 0.5, sizeRatio: 0.06 }],
    }).join(" ");
    expect(args.indexOf("/tmp/shadow.png")).toBeLessThan(args.indexOf("/tmp/bottle.png"));
    expect(args.indexOf("/tmp/bottle.png")).toBeLessThan(args.indexOf("/tmp/logo.png"));
    /* Text is in the base chain, which is built before any overlay is applied. */
    expect(args).toContain("drawtext=");
  });

  it("adds one input per overlay and maps the final label", () => {
    const args = shot({
      product: { file: "/tmp/bottle.png", cutOut: true } as never,
      logoFile: "/tmp/logo.png",
    });
    /* The plate, the product, the logo. */
    expect(args.filter((a) => a === "-i")).toHaveLength(3);
    expect(args[args.indexOf("-map") + 1]).toBe("[out]");
  });
});

describe("the opening frame, held", () => {
  const base = {
    input: "plate.mp4", startSeconds: 0, seconds: 5, format: "vertical" as const,
    brand: null, output: "out.mp4",
  };

  it("clones the first frame for exactly as long as it was asked to", () => {
    const args = composeShot({ ...base, holdFirstFrame: 0.5 }).join(" ");
    expect(args).toContain("tpad=start_mode=clone:start_duration=0.50");
  });

  it("adds nothing when it was not asked, which is every shot but the first", () => {
    expect(composeShot(base).join(" ")).not.toContain("tpad");
    expect(composeShot({ ...base, holdFirstFrame: 0 }).join(" ")).not.toContain("tpad");
  });

  it("takes the freeze out of the shot rather than adding it on", () => {
    /*
     * The advert is as long as it was sold. `tpad` pads the start and the `-t`
     * on the output trims the end, so the freeze replaces the opening of the
     * move instead of delaying it.
     */
    const args = composeShot({ ...base, holdFirstFrame: 0.5 });
    const t = args[args.indexOf("-t") + 1];
    expect(Number(t), "the shot got longer to fit the freeze").toBe(5);
  });
});

describe("text that ffmpeg will actually draw", () => {
  const shot = (text: string) => composeShot({
    input: "plate.mp4", startSeconds: 0, seconds: 4, format: "vertical" as const,
    brand: null, output: "out.mp4",
    lines: [{ text, atHeight: 0.78, sizeRatio: 0.055, bold: true }],
  }).join(" ");

  it("escapes a colon with one backslash, not two", () => {
    /*
     * The POV format's first line is "POV: it's 2am", and two backslashes made
     * the parser read a literal backslash followed by a colon — which then
     * ended the option. It failed at composition, after all four clips had
     * been generated and paid for. Checked against ffmpeg rather than reasoned
     * about: the quoting rules here are not guessable.
     */
    expect(escapeDrawText("POV: 2am")).toBe("POV\\: 2am");
    expect(escapeDrawText("POV: 2am")).not.toContain("\\\\:");
  });

  it("replaces an apostrophe rather than escaping it, so the quotes hold", () => {
    expect(escapeDrawText("it's")).toBe("it’s");
    expect(escapeDrawText("it's")).not.toContain("'");
  });

  it("leaves a percent sign alone, because expansion is off", () => {
    /*
     * Every spelling of it failed while strftime expansion was on — "100%",
     * "100\%" and "100%%" all warned "Stray %" and drew nothing, with ffmpeg
     * exiting zero. Escaping harder was the wrong direction.
     */
    expect(escapeDrawText("100% done")).toBe("100% done");
  });

  it("turns expansion off on every line it draws", () => {
    const args = shot("100% done");
    const draws = (args.match(/drawtext=/g) ?? []).length;
    const offs = (args.match(/expansion=none/g) ?? []).length;
    expect(draws, "nothing was drawn").toBeGreaterThan(0);
    expect(offs, "a drawtext pass can still expand the text").toBe(draws);
  });

  it("passes a brace through, which only expansion=none makes safe", () => {
    expect(escapeDrawText("a {x} b")).toBe("a {x} b");
  });
});
