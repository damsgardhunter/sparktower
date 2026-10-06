/**
 * Putting the advert together: the plate underneath, the brand on top.
 *
 * This is the file that makes a generated clip into an advertisement, and it
 * exists because of the rule at the top of shared/ads.ts — the model never
 * draws the product, the logo, the price or a single word of text. All of that
 * is composited here, from the business's own files and their own brand kit,
 * with ffmpeg.
 *
 * ## Why the filtergraph is built as data
 *
 * `composeShot` returns the argument list and does not run anything.
 * `renderShot` runs it. That split is the whole reason this is testable: an
 * ffmpeg filtergraph is a long string with exact escaping, a wrong comma is a
 * silent no-op or a crash, and the only way to know what will be rendered is
 * to look at the arguments. So the arguments are the unit under test and
 * ffmpeg is not.
 *
 * ## Text is drawn, never generated
 *
 * `drawtext` with a font file we ship. That means the headline, the price, the
 * call to action and the captions are pixel-exact, spelled correctly, in the
 * brand's colour, every time — which is the single biggest difference between
 * this and asking a model for a frame with words in it.
 *
 * ffmpeg's `drawtext` takes its text through a parser with its own escaping
 * rules, and getting that wrong is how a colon in somebody's tagline becomes
 * a broken render. `escapeDrawText` below is the only place that knows about
 * it.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { AD_FORMATS, type AdFormatId } from "@shared/ads";
import { SAFE_AREAS, safeBox } from "@shared/ad-safe-areas";
import { brandFont, resolvedBrand, type BrandKitInput } from "@shared/ad-brand";
import { typeTreatment, type TypeStyleId } from "@shared/ad-type";

/** Where the bundled fonts live, in dev and in the built bundle. */
function fontPath(file: string): string {
  const candidates = [
    path.resolve(process.cwd(), "server/assets/fonts", file),
    path.resolve(process.cwd(), "dist/assets/fonts", file),
    path.resolve(import.meta.dirname ?? ".", "assets/fonts", file),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

/**
 * Whether this machine can render at all.
 *
 * ffmpeg is a system binary rather than a dependency we install, so it can be
 * absent — and a feature that needs it should say so rather than failing
 * inside a job. Render's native runtimes ship it; a container built from
 * scratch might not.
 */
export async function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = spawn("ffmpeg", ["-version"]);
    probe.on("error", () => resolve(false));
    probe.on("close", (code) => resolve(code === 0));
  });
}

/**
 * ffmpeg's `drawtext` escaping.
 *
 * Backslash, colon, apostrophe and the percent sign all mean something to the
 * filter parser. A business called "Mum's: Kitchen" is not an unusual name and
 * it would break the render in three different ways at once.
 */
export function escapeDrawText(s: string): string {
  return s
    .replace(/\\/g, "\\\\\\\\")
    .replace(/'/g, "’")
    .replace(/:/g, "\\\\:")
    .replace(/%/g, "\\\\%");
}

/** `#RRGGBB` to the `0xRRGGBB` ffmpeg wants, with an alpha. */
export const ffColor = (hex: string, alpha = 1): string =>
  `${hex.replace("#", "0x")}@${alpha}`;

export interface ShotText {
  /** The line itself. Already written; this file never composes copy. */
  text: string;
  /** Where in the safe box, as a fraction of its height. */
  atHeight: number;
  /** Relative to the frame's shorter edge, so one value works for every format. */
  sizeRatio: number;
  bold?: boolean;
}

export interface ComposeShot {
  /** The generated plate. */
  input: string;
  /** Seconds into the plate this shot starts — a window of a longer move. */
  startSeconds: number;
  seconds: number;
  format: AdFormatId;
  brand: BrandKitInput | null;
  /** Lines to typeset. Usually one; two at most, or the frame is a poster. */
  lines?: ShotText[];
  /** The logo, as a local file path. Composited at a fixed corner. */
  logoFile?: string | null;
  /**
   * The business's own photograph of the thing they sell.
   *
   * This is the whole reason the model is never asked to draw the product.
   * Composited from their file, at a size and position we control, so it is
   * *their* product and not a model's impression of it.
   */
  product?: {
    file: string;
    /** Share of the frame's shorter edge. A product smaller than a fifth reads as a prop. */
    widthRatio?: number;
    /** Where it sits inside the safe box, as fractions of it. */
    at?: { x: number; y: number };
    /**
     * Which part of the product `at` refers to.
     *
     * `base` is almost always right and is the default. A product positioned
     * by its centre floats: the point you can see in the plate is the surface
     * it should stand on, and anchoring the middle of a bottle to a table top
     * puts half the bottle through the table and the other half in the air.
     * The first render of this got it wrong in exactly that way.
     */
    anchor?: "centre" | "base";
    /**
     * A soft shadow where it meets the surface.
     *
     * Without one a cut-out reads as a sticker however well it is placed —
     * the eye reads contact from the shadow, not from the position. Drawn as
     * a flattened dark ellipse under the base, which is cheap and convincing
     * at the sizes anything is watched at.
     */
    contactShadow?: boolean;
    /**
     * Whether the file already has a transparent background.
     *
     * A cut-out composites straight into the scene. A rectangular photograph
     * does not — pasted flat it looks like a screenshot stuck on a video — so
     * it is given a rounded card and a shadow, which is a deliberate-looking
     * treatment rather than a failed cut-out. Nothing here attempts to remove
     * a background: a bad automatic cut-out of somebody's product is worse
     * than an honest card.
     */
    cutOut?: boolean;
  } | null;
  /** Hold the brand colour as a bar along the bottom — a brand moment. */
  brandBar?: boolean;
  /** Bubble by default; `outline` and `plain` are for brands that need quieter. */
  typeStyle?: TypeStyleId;
  /** A pre-blurred shadow, made by `renderShot`. Kept out of `composeShot` so it stays pure. */
  shadowFile?: string | null;
  output: string;
}

/**
 * The ffmpeg arguments for one shot.
 *
 * Built rather than run, so a test can read exactly what will be rendered.
 *
 * The order of the chain matters and is deliberate: scale and crop first so
 * every later coordinate is in output pixels; then the brand bar; then the
 * logo; then the text last, because text must sit above everything else or
 * it is the thing that gets hidden.
 */
export function composeShot(shot: ComposeShot): string[] {
  const format = AD_FORMATS.find((f) => f.id === shot.format)!;
  const area = SAFE_AREAS[shot.format];
  const box = safeBox(format, area);
  const brand = resolvedBrand(shot.brand);
  const shortEdge = Math.min(format.width, format.height);

  const filters: string[] = [];

  /*
   * Fill the frame from whatever the plate's shape is: scale so the shorter
   * side covers, then crop the centre. `increase` rather than `decrease` so
   * there are never bars — a letterboxed advert looks like a mistake, and on
   * a vertical feed it looks like a landscape video somebody forgot to crop.
   */
  filters.push(
    `scale=${format.width}:${format.height}:force_original_aspect_ratio=increase`,
    `crop=${format.width}:${format.height}`,
    /* A fixed rate, so shots from different generations concat without a re-encode mismatch. */
    `fps=24`,
    `setsar=1`,
  );

  if (shot.brandBar) {
    /*
     * A band of the brand's colour along the bottom of the safe box. Not the
     * very bottom of the frame: that belongs to the platform's caption.
     */
    const barHeight = Math.round(shortEdge * 0.012);
    const y = box.y + box.height - barHeight;
    filters.push(
      `drawbox=x=${box.x}:y=${y}:w=${box.width}:h=${barHeight}:color=${ffColor(brand.primaryColor)}:t=fill`,
    );
  }

  const type = typeTreatment(
    { primaryColor: brand.primaryColor, backgroundColor: brand.backgroundColor, accentColor: brand.accentColor },
    shot.typeStyle ?? "bubble",
  );

  for (const line of shot.lines ?? []) {
    const size = Math.round(shortEdge * line.sizeRatio);
    const font = fontPath(line.bold === false ? brandFont(brand.font.id).regular : brand.font.file);
    const restY = Math.round(box.y + box.height * line.atHeight);
    /* Centred in the safe box, not the frame — the two differ by the platform's furniture. */
    const x = `${box.x}+(${box.width}-text_w)/2`;

    /*
     * The type arrives and leaves rather than being stamped on.
     *
     * A line that appears at full opacity on frame one and vanishes on the
     * last is the single clearest tell that it was added afterwards — nothing
     * else in the frame behaves that way. Easing it in over a third of a
     * second, with a small rise that settles, reads as something that belongs
     * to the shot it is in.
     *
     * `alpha`, `x` and `y` are the drawtext parameters evaluated per frame;
     * `fontsize` is not, which is why the movement is a rise rather than a
     * scale. Quoted because the expressions contain commas, and an unquoted
     * comma ends the filter.
     */
    const appear = Math.min(0.35, shot.seconds / 3);
    const leave = Math.min(0.25, shot.seconds / 4);
    const rise = Math.round(size * 0.22);
    const held = Math.max(0.01, shot.seconds - leave);

    /* 0 → 1 across the entrance, then 1. Used for both the fade and the rise. */
    const entering = `min(1\,t/${appear.toFixed(3)})`;
    const alpha = `'if(lt(t\,${appear.toFixed(3)})\,t/${appear.toFixed(3)}\,if(gt(t\,${held.toFixed(3)})\,max(0\,(${shot.seconds}-t)/${leave.toFixed(3)})\,1))'`;
    /* Eased: the square makes it decelerate into place rather than arriving at a constant speed. */
    const y = `'${restY}+${rise}*(1-pow(${entering}\,2))'`;

    /**
     * One `drawtext` per layer, widest first.
     *
     * ffmpeg draws a single outline per call, so bubble lettering is three
     * passes of the same string: the halo, then the outline, then the fill on
     * top. Painted in that order because each one covers the middle of the
     * last, which is what leaves an even band of each colour — and it is why
     * the halo has to be the *wider* of the two, not merely a second colour.
     *
     * The alternative, one call with a thick border, gives a single-colour
     * edge that reads as outlined text rather than as lettering sitting on
     * the video.
     */
    const layer = (color: string, borderWidth: number, shadow: boolean) =>
      [
        `drawtext=fontfile='${font}'`,
        `text='${escapeDrawText(line.text)}'`,
        `fontcolor=${ffColor(color)}`,
        `fontsize=${size}`,
        `x=${x}`,
        `y=${y}`,
        `alpha=${alpha}`,
        ...(borderWidth > 0 ? [`borderw=${borderWidth}`, `bordercolor=${ffColor(color)}`] : []),
        ...(shadow && type.shadowRatio > 0
          ? [
              `shadowx=${Math.max(1, Math.round(size * type.shadowRatio))}`,
              `shadowy=${Math.max(1, Math.round(size * type.shadowRatio))}`,
              `shadowcolor=${ffColor(type.shadow, 0.45)}`,
            ]
          : []),
      ].join(":");

    /* The shadow goes on the widest layer only, or it is drawn three times and muddies. */
    if (type.haloRatio > 0) filters.push(layer(type.halo, Math.round(size * type.haloRatio), true));
    if (type.outlineRatio > 0) {
      filters.push(layer(type.outline, Math.round(size * type.outlineRatio), type.haloRatio === 0));
    }
    filters.push(layer(type.fill, 0, type.haloRatio === 0 && type.outlineRatio === 0));
  }

  const args = [
    "-y",
    /*
     * Seek on the input (fast — ffmpeg skips to the plate's keyframe and
     * decodes forward), but take the duration on the *output*, after the
     * filters have run.
     *
     * `-t` in front of `-i` is an input option: it limits how much is read
     * from the demuxer, before `fps=24` has normalised anything, and what
     * comes out the other side is a few frames short. Across the seven shots
     * of a fifteen-second advert that lost a quarter of a second — a file of
     * 14.75 seconds sold as fifteen. Small, and exactly the kind of thing
     * nobody would ever look for.
     */
    "-ss", String(shot.startSeconds),
    "-i", shot.input,
  ];

  /*
   * Overlays, in the order they are layered.
   *
   * The product goes down before the logo and both go under the text, because
   * the text is the thing that must never be obscured. Each extra input is
   * another `-i`, and the filter_complex has to name them in the same order.
   */
  const overlays: {
    file: string;
    build: (label: string, inputIndex: number) => string[];
    /** Where it goes. Defaults to the top-left of the safe box, which is the logo's place. */
    position?: () => { x: string; y: string };
  }[] = [];

  /*
   * The contact shadow, as its own overlay rather than a filter on the plate.
   *
   * The first attempt drew a box and then ran `boxblur`, which blurs the
   * whole frame — the plate came out of focus and the bug was obvious only
   * once a frame was looked at. A shadow is a thing on top of the video, not
   * something done to the video.
   */
  if (shot.product?.contactShadow && shot.shadowFile) {
    const at = shot.product.at ?? { x: 0.5, y: 0.78 };
    const cx = Math.round(box.x + box.width * at.x);
    const cy = Math.round(box.y + box.height * at.y);
    overlays.push({
      file: shot.shadowFile,
      build: (label, i) => [`[${i}:v]null[${label}]`],
      position: () => ({ x: `${cx}-overlay_w/2`, y: `${cy}-overlay_h/2` }),
    });
  }

  if (shot.product) {
    const widthRatio = shot.product.widthRatio ?? 0.42;
    const productWidth = Math.round(shortEdge * widthRatio);
    const cutOut = shot.product.cutOut ?? false;
    const file = shot.product.file;
    const at = shot.product.at ?? { x: 0.5, y: 0.78 };
    const anchor = shot.product.anchor ?? "base";
    const px = Math.round(box.x + box.width * at.x);
    const py = Math.round(box.y + box.height * at.y);
    overlays.push({
      position: () => ({
        x: `${px}-overlay_w/2`,
        /* `base` puts the bottom of the product on the point; `centre` its middle. */
        y: anchor === "base" ? `${py}-overlay_h` : `${py}-overlay_h/2`,
      }),
      file,
      build: (label, i) => {
        const steps = [`[${i}:v]scale=${productWidth}:-1`];
        if (!cutOut) {
          /*
           * A card: pad a border of the brand's background around the photo
           * so it reads as a deliberate frame rather than a flat paste. The
           * shadow comes from a second, offset copy drawn underneath.
           */
          const pad = Math.round(productWidth * 0.035);
          steps.push(`pad=iw+${pad * 2}:ih+${pad * 2}:${pad}:${pad}:${brand.backgroundColor.replace("#", "0x")}`);
        }
        return [`${steps.join(",")}[${label}]`];
      },
    });
  }

  if (shot.logoFile) {
    /*
     * One corner, every shot, never moving — a logo that moves is a logo
     * somebody watches instead of the advert.
     *
     * Fitted into a box rather than scaled to a width. `scale=W:-1` bounds one
     * dimension and lets the other go where it likes, which gives every logo
     * the same *width* and wildly different presence: a wide wordmark comes
     * out the right size and a tall mark comes out as a sliver, because the
     * thing that is 150 pixels across is 400 pixels tall and the eye reads the
     * area. The first live render had a logo nobody could pick out against a
     * bookshelf for exactly this reason.
     *
     * So both edges are bounded and `decrease` keeps the aspect ratio: a tall
     * mark and a wide one end up with comparable weight in the corner, which
     * is what "the same size" means to somebody looking at it.
     */
    const logoBox = { w: Math.round(shortEdge * 0.2), h: Math.round(shortEdge * 0.2) };
    overlays.push({
      file: shot.logoFile,
      build: (label, i) => [
        `[${i}:v]scale=${logoBox.w}:${logoBox.h}:force_original_aspect_ratio=decrease[${label}]`,
      ],
    });
  }

  if (overlays.length === 0) {
    args.push("-vf", filters.join(","));
  } else {
    for (const o of overlays) args.push("-i", o.file);

    const parts: string[] = [`[0:v]${filters.join(",")}[base]`];
    let carry = "base";

    overlays.forEach((o, n) => {
      const inputIndex = n + 1;
      const label = `ov${n}`;
      parts.push(...o.build(label, inputIndex));
      const next = n === overlays.length - 1 ? "out" : `stage${n}`;

      const where = o.position?.() ?? { x: String(box.x), y: String(box.y) };
      parts.push(`[${carry}][${label}]overlay=x=${where.x}:y=${where.y}[${next}]`);
      carry = next;
    });

    args.push("-filter_complex", parts.join(";"), "-map", "[out]");
  }

  args.push(
    /* The exact length of this shot, trimmed after the filters rather than before. */
    "-t", String(shot.seconds),
    /* No audio from the plate: the model's audio is not the advert's audio. */
    "-an",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    /* `faststart` so a feed can begin playing before the file has finished arriving. */
    "-movflags", "+faststart",
    "-preset", "medium",
    "-crf", "20",
    shot.output,
  );

  return args;
}

/**
 * A soft contact shadow, as a file.
 *
 * Made with sharp rather than in the filtergraph, because blurring inside
 * ffmpeg means blurring a layer the size of the frame — and the first attempt
 * at that blurred the whole plate. A small blurred ellipse is a few
 * milliseconds and cannot affect anything it is not drawn over.
 */
async function shadowFile(widthPx: number): Promise<string> {
  const sharp = (await import("sharp")).default;
  const width = Math.max(32, widthPx);
  const height = Math.max(12, Math.round(width * 0.22));
  const file = path.join(os.tmpdir(), `ad-shadow-${width}x${height}.png`);
  if (existsSync(file)) return file;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2.2}" ry="${height / 2.4}" fill="black" opacity="0.38"/>` +
    `</svg>`;
  await sharp(Buffer.from(svg)).blur(Math.max(3, height / 4)).png().toFile(file);
  return file;
}

/** Run one shot. Resolves to the output path, or throws with ffmpeg's own last words. */
export async function renderShot(shot: ComposeShot): Promise<string> {
  let prepared = shot;
  if (shot.product?.contactShadow && !shot.shadowFile) {
    const format = AD_FORMATS.find((f) => f.id === shot.format)!;
    const shortEdge = Math.min(format.width, format.height);
    const width = Math.round(shortEdge * (shot.product.widthRatio ?? 0.42) * 0.95);
    prepared = { ...shot, shadowFile: await shadowFile(width) };
  }
  await run("ffmpeg", composeShot(prepared));
  return shot.output;
}

/**
 * Join rendered shots into one file.
 *
 * The concat *demuxer* rather than the filter, because every shot has already
 * been encoded to the same size, rate and pixel format — so this is a copy
 * rather than a second encode, which is both faster and avoids the
 * generation loss of encoding twice.
 */
/**
 * How long one shot dissolves into the next.
 *
 * Short. A long dissolve is a slideshow and a hard cut between two
 * independently generated clips is a jolt — the camera is in a different place
 * and the light has moved, so the eye reads it as a mistake rather than an
 * edit. A fifth of a second is enough for the two frames to agree with each
 * other and too fast to be noticed as a transition.
 */
export const CROSSFADE_SECONDS = 0.2;

/**
 * The dissolve for an advert whose clips were drawn from one another.
 *
 * Twice as long, because it can be. Independently generated clips share
 * nothing, so a long dissolve between them is two unrelated images visibly
 * mixed; chained keyframes mean consecutive clips are the same place in the
 * same light, and a longer overlap reads as the camera carrying on rather than
 * as a transition. The short one was leaving the cuts abrupt.
 */
export const CROSSFADE_SECONDS_CONTINUOUS = 0.4;

/**
 * Join shots with a dissolve between each pair.
 *
 * `composeConcat` is still the right thing for footage that was continuous to
 * begin with, and this is for footage that was not. Every clip here is a
 * separate generation: shot two does not begin where shot one ended, however
 * well the keyframes were chained, and cutting straight between them is the
 * choppiness somebody watching described. `xfade` overlaps them so each cut
 * lands on two frames that are already dissolving into one another.
 *
 * The cost is a re-encode — `xfade` is a filter, so `-c copy` is not available
 * — and a small amount of runtime, since each dissolve consumes its own
 * length from the shot it starts. Both are accounted for by the caller, which
 * knows the shot lengths and the total the advert was sold at.
 */
export function composeDissolve(
  files: string[],
  seconds: number[],
  output: string,
  /**
   * How long each join lasts, one per gap, when they are not all the same.
   *
   * They are not all the same whenever a shot could not be rendered longer
   * than its window — a window that ends where its plate ends has nothing to
   * extend into, so that shot cannot pay for its own dissolve. Using the full
   * length there anyway is where a thirty-second advert came out at 29.2:
   * every join that could not be paid for was taken out of the runtime
   * instead. Matching the dissolve to the room that actually existed keeps the
   * total exact.
   */
  joins?: number[],
  /** Overridden for footage that was drawn from a shared first frame. */
  crossfade: number = CROSSFADE_SECONDS,
): string[] {
  if (files.length === 1) return ["-y", "-i", files[0], "-c", "copy", "-movflags", "+faststart", output];

  const args = ["-y"];
  for (const f of files) args.push("-i", f);

  /*
   * Each dissolve starts `CROSSFADE_SECONDS` before the running total, and the
   * total itself shrinks by that much per join — which is why the offset is
   * accumulated rather than summed from the original lengths. Getting this
   * wrong does not error, it silently freezes the last frame of a shot for the
   * length of the drift.
   */
  const steps: string[] = [];
  let carry = "0:v";
  let offset = 0;
  for (let i = 1; i < files.length; i++) {
    /*
     * One value, used for both the filter and the arithmetic.
     *
     * They were two: the offset was advanced by the requested join while the
     * filter was given a clamped minimum, so every join where the two differed
     * put the next offset past the end of the stream it was cutting into.
     * `xfade` does not complain, it truncates — and across eight joins a
     * thirty-second advert came out at eight seconds. A join of zero is still
     * a single frame, because xfade with a duration of zero is invalid.
     */
    const join = Math.max(1 / 24, joins?.[i - 1] ?? crossfade);
    offset += seconds[i - 1] - join;
    const label = i === files.length - 1 ? "out" : `x${i}`;
    steps.push(`[${carry}][${i}:v]xfade=transition=fade:duration=${join.toFixed(3)}:offset=${offset.toFixed(3)}[${label}]`);
    carry = label;
  }

  args.push(
    "-filter_complex", steps.join(";"),
    "-map", "[out]",
    "-an",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-preset", "medium", "-crf", "20",
    output,
  );
  return args;
}

export function composeConcat(listFile: string, output: string): string[] {
  return [
    "-y",
    "-f", "concat",
    /* The list holds paths we wrote; without this ffmpeg refuses relative ones. */
    "-safe", "0",
    "-i", listFile,
    "-c", "copy",
    "-movflags", "+faststart",
    output,
  ];
}

/**
 * Run ffmpeg with arguments somebody else built.
 *
 * Exported so `server/ad-render.ts` can run `composeConcat` and generate a
 * stand-in plate without a second copy of the spawn-and-read-stderr dance.
 * Takes the arguments rather than a command: this process has no business
 * running anything but ffmpeg on behalf of a render.
 */
export const runFfmpeg = (args: string[]): Promise<void> => run("ffmpeg", args);

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let err = "";
    child.stderr.on("data", (d) => { err += String(d); });
    child.on("error", (e) => reject(new Error(`${bin} could not be started: ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      /*
       * ffmpeg's useful message is the last few lines, not the first — the
       * head of its output is the build configuration.
       */
      const tail = err.trim().split("\n").slice(-4).join(" | ");
      reject(new Error(`ffmpeg exited ${code}: ${tail}`));
    });
  });
}
