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
  /** Hold the brand colour as a bar along the bottom — a brand moment. */
  brandBar?: boolean;
  /** Bubble by default; `outline` and `plain` are for brands that need quieter. */
  typeStyle?: TypeStyleId;
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
    const y = Math.round(box.y + box.height * line.atHeight);
    /* Centred in the safe box, not the frame — the two differ by the platform's furniture. */
    const x = `${box.x}+(${box.width}-text_w)/2`;

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
    "-ss", String(shot.startSeconds),
    "-t", String(shot.seconds),
    "-i", shot.input,
  ];

  if (shot.logoFile) {
    /*
     * The logo as a second input, scaled to a fixed share of the frame and
     * placed inside the safe box. One corner, every shot, never moving — a
     * logo that moves is a logo somebody watches instead of the advert.
     */
    const logoWidth = Math.round(shortEdge * 0.14);
    args.push("-i", shot.logoFile);
    const chain = filters.join(",");
    args.push(
      "-filter_complex",
      `[0:v]${chain}[base];` +
      `[1:v]scale=${logoWidth}:-1[logo];` +
      `[base][logo]overlay=x=${box.x}:y=${box.y}[out]`,
      "-map", "[out]",
    );
  } else {
    args.push("-vf", filters.join(","));
  }

  args.push(
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

/** Run one shot. Resolves to the output path, or throws with ffmpeg's own last words. */
export async function renderShot(shot: ComposeShot): Promise<string> {
  const args = composeShot(shot);
  await run("ffmpeg", args);
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
