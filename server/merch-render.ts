/**
 * Turning a merch config into actual pixels.
 *
 * One renderer produces both things that matter, from the same code path:
 *
 *   - the **print file** Printful puts on the garment (4500×5400 transparent
 *     PNG), and
 *   - the **preview** the creator and the backer look at.
 *
 * They come from one function on purpose. A preview drawn by different code
 * than the print file is a preview that can lie, and the way you find out is a
 * box of two hundred wrong shirts.
 *
 * Text is converted to vector outlines with opentype.js before it ever reaches
 * the rasteriser, so nothing depends on which fonts happen to be installed on
 * the machine doing the rendering. That is the single most common way this
 * kind of pipeline goes wrong: it looks right in development and prints in a
 * fallback face in production.
 */
import fs from "node:fs";
import { safeFetch } from "./safe-fetch";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import opentype from "opentype.js";
import { BELIEVER_TAGLINE, CREATOR_TAGLINE, datestampLabel, type MerchConfig } from "@shared/backing";
import { ObjectStorageService } from "./replit_integrations/object_storage";

/** 15"×18" at 300dpi — Printful's standard DTG print area. */
export const PRINT_WIDTH = 4500;
export const PRINT_HEIGHT = 5400;

export type MerchFace = "front" | "back" | "creator";

/**
 * Where the committed font files live.
 *
 * Resolved from the working directory rather than the module's own path:
 * development runs from source under tsx (ESM), production runs from a single
 * bundled `dist/index.cjs`, and neither `import.meta.url` nor `__dirname`
 * survives both — `import.meta` is empty once esbuild emits CJS, which is the
 * kind of thing that works everywhere except production.
 *
 * The build copies the fonts alongside the bundle; see script/build.ts.
 */
function fontCandidates(file: string): string[] {
  const roots = [
    process.env.MERCH_FONT_DIR,
    "server/assets/fonts",   // dev, cwd = repo root
    "dist/assets/fonts",     // prod, cwd = repo root
    "assets/fonts",          // prod, cwd = dist
  ].filter(Boolean) as string[];
  return roots.map((r) => path.resolve(r, file));
}

function fontPath(file: string): string {
  const candidates = fontCandidates(file);
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error(`Merch font missing: ${file}. Looked in: ${candidates.join(", ")}`);
  return found;
}

/**
 * Checked at boot so a deploy that forgot the fonts says so immediately,
 * rather than at the moment someone's order needs a print file.
 */
export function checkMerchFonts(): boolean {
  try {
    bold();
    regular();
    return true;
  } catch (err) {
    console.error(`[merch] Fonts unavailable — merch cannot be rendered. ${(err as Error).message}`);
    return false;
  }
}

/**
 * Parsed once and held. `opentype.loadSync` is gone in opentype.js 2.x, and
 * its replacement wants the bytes — which suits us, since the font is a
 * committed asset rather than something fetched at runtime.
 */
function loadFont(file: string): opentype.Font {
  const buf = fs.readFileSync(fontPath(file));
  // Node Buffers are views into a larger pool, so hand over just this slice.
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

let _bold: opentype.Font | null = null;
let _regular: opentype.Font | null = null;
/*
 * These four are exported for `certificate-render.ts`, and the export is where
 * this file's hard-won knowledge is shared rather than copied: opentype.js 2.0
 * serialises NaN coordinates once an x offset grows past a few hundred units,
 * which was found on a printed garment reading "s" instead of "since March
 * 2026". A second renderer laying its own text out would find that again, on
 * something somebody had framed.
 *
 * They were nearly moved to a module of their own, and should be one day:
 * importing this file drags in object storage and therefore the database, so a
 * renderer that needs nothing but a font file cannot be loaded without
 * `DATABASE_URL`. The move was attempted and abandoned — brace-matching through
 * `layout`'s template literals is not something to get wrong in the code path
 * that produces print files — so the coupling is recorded here instead of being
 * papered over.
 */
export const bold = () => (_bold ??= loadFont("SpaceGrotesk-Bold.ttf"));
export const regular = () => (_regular ??= loadFont("SpaceGrotesk-Regular.ttf"));

const INK: Record<MerchConfig["colorway"], string> = {
  black: "#fafaf9",
  white: "#18181b",
  heather: "#18181b",
};

/** Logo box on the back, in print-space. Fixed so the stack below it lands. */
const LOGO_SIZE = Math.round(PRINT_WIDTH * 0.30);
const LOGO_TOP = Math.round(PRINT_HEIGHT * 0.16);

/** The garment itself, for previews only. Print files are transparent. */
const GARMENT: Record<MerchConfig["colorway"], string> = {
  black: "#17171b",
  white: "#f7f7f6",
  heather: "#a1a1aa",
};

/**
 * Measures a string by accumulating glyph advances, guarding kerning.
 *
 * `font.getAdvanceWidth(string)` is avoided for the same reason
 * `font.getPath(string)` is — see `layout` below.
 */
export function measure(font: opentype.Font, glyphs: opentype.Glyph[], size: number): number {
  const scale = size / font.unitsPerEm;
  let w = 0;
  for (let i = 0; i < glyphs.length; i++) {
    w += (glyphs[i].advanceWidth ?? 0) * scale;
    if (i + 1 < glyphs.length) {
      const k = font.getKerningValue(glyphs[i], glyphs[i + 1]);
      if (Number.isFinite(k)) w += k * scale;
    }
  }
  return w;
}

/**
 * Serialises a glyph path from its own command objects.
 *
 * opentype.js 2.0's `Path.toPathData()` emits the literal text "NaN" for some
 * glyph and size combinations while the command objects it is reading hold
 * perfectly finite numbers — `Space Grotesk Bold` "e" at size 170 is one, "d" at
 * 104 is another, and 200 is fine again, so it is neither a threshold nor a
 * glyph. Printing the commands and the output side by side is what settles it:
 *
 *   commands: 35 | any non-finite coord: false
 *   toPathData(2): NaN   toPathData(0): NaN   toPathData(4): NaN
 *
 * The geometry is good and the formatter is not, so the formatter is the thing
 * to replace. This walks the commands and writes the numbers itself.
 *
 * The previous workaround — drawing every glyph at the origin and moving it with
 * a transform — is kept, because it removes a *second* fault in the same library
 * (the x accumulator corrupting past a few hundred units). It does not help with
 * this one: the garment renderer was only ever safe because the sizes it happens
 * to use are ones that serialise cleanly.
 */
function pathData(path: opentype.Path, places = 2): string {
  const out: string[] = [];
  const n = (value: number | undefined): string => {
    if (value === undefined || !Number.isFinite(value)) {
      throw new Error(`Glyph path carries a non-finite coordinate (${String(value)})`);
    }
    return value.toFixed(places);
  };
  for (const c of path.commands as any[]) {
    switch (c.type) {
      case "M": out.push(`M${n(c.x)} ${n(c.y)}`); break;
      case "L": out.push(`L${n(c.x)} ${n(c.y)}`); break;
      case "C": out.push(`C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`); break;
      case "Q": out.push(`Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`); break;
      case "Z": out.push("Z"); break;
      default: throw new Error(`Unknown glyph path command: ${String(c.type)}`);
    }
  }
  return out.join("");
}

/**
 * Lays out a string one glyph at a time.
 *
 * opentype.js 2.0's `font.getPath(string, x, …)` corrupts its own x
 * accumulator once the offset grows past a few hundred units: every glyph
 * after the first comes back with NaN coordinates. An SVG path containing NaN
 * doesn't fail — renderers just stop drawing at that point — so the symptom
 * was a shirt that said "s" instead of "since March 2026", and it would have
 * been discovered on a printed garment.
 *
 * Per-glyph `glyph.getPath()` is unaffected, so the advance and kerning maths
 * happens here where the values can be checked.
 */
export function layout(
  text: string,
  opts: { font: opentype.Font; size: number; maxWidth: number; centerX: number; baselineY: number; fill: string },
): { svg: string; width: number; height: number } {
  const { font, maxWidth, centerX, baselineY, fill } = opts;
  const glyphs = font.stringToGlyphs(text);

  const natural = measure(font, glyphs, opts.size);
  // Kept whole: a fractional size is one more input to opentype's shaky
  // coordinate maths, and nobody can see a half-unit on a 4500px canvas.
  const size = Math.round(
    natural > maxWidth && natural > 0 ? opts.size * (maxWidth / natural) : opts.size,
  );
  const width = measure(font, glyphs, size);
  const scale = size / font.unitsPerEm;

  /*
   * Every glyph is drawn at the origin and moved into place with an SVG
   * transform, rather than asking opentype to draw it at its final position.
   *
   * `glyph.getPath(x, y, …)` serialises to NaN for some glyph/offset
   * combinations once x grows into the thousands — the command objects hold
   * correct numbers, so it is the serialiser rather than the geometry — and
   * `Path.extend()` has the same problem. Drawing at 0,0 is the one input
   * that is reliably clean, and translation is something SVG does exactly.
   */
  const pieces: string[] = [];
  let x = centerX - width / 2;
  for (let i = 0; i < glyphs.length; i++) {
    const d = pathData(glyphs[i].getPath(0, 0, size));
    if (d) {
      if (d.includes("NaN") || d.includes("Infinity")) {
        throw new Error(
          `Glyph '${glyphs[i].name ?? "?"}' in ${JSON.stringify(text)} produced invalid geometry`,
        );
      }
      pieces.push(`<path d="${d}" transform="translate(${x.toFixed(2)} ${baselineY.toFixed(2)})"/>`);
    }
    x += (glyphs[i].advanceWidth ?? 0) * scale;
    if (i + 1 < glyphs.length) {
      const k = font.getKerningValue(glyphs[i], glyphs[i + 1]);
      if (Number.isFinite(k)) x += k * scale;
    }
  }

  return { svg: `<g fill="${fill}">${pieces.join("")}</g>`, width, height: size };
}

/** Blocks the obvious SSRF shapes before the server fetches a creator URL. */

const MAX_LOGO_BYTES = 12 * 1024 * 1024;

/**
 * Loads the logo, whether it's one of our uploads or an external link.
 *
 * Uploaded images arrive as `/objects/…` paths and are read straight out of
 * object storage rather than fetched back over HTTP. Going through the network
 * would mean the server calling itself — which the SSRF guard below correctly
 * refuses, and which wouldn't work in local development anyway.
 */
async function loadLogo(value: string): Promise<Buffer> {
  if (value.startsWith("/objects/")) {
    const { buffer } = await new ObjectStorageService().readObjectBuffer(value, MAX_LOGO_BYTES);
    return buffer;
  }
  return fetchLogo(value);
}

async function fetchLogo(rawUrl: string): Promise<Buffer> {
  /*
   * Through the shared guard (server/safe-fetch.ts). This used to check a
   * blocklist of hostnames and then fetch with `redirect: "follow"`, so a logo
   * URL that passed the check and answered "302 Location: http://127.0.0.1:5000/"
   * was followed without anybody looking at it — and a hostname that simply
   * resolved to a private address never had to redirect at all. The guard
   * resolves the name, checks the addresses, and re-checks every hop.
   *
   * http is still allowed here: these are addresses people pasted before
   * anyone asked them for https, and a logo is not a credential.
   */
  const res = await safeFetch(rawUrl, { maxBytes: MAX_LOGO_BYTES, timeoutMs: 15_000, allowHttp: true });
  if (!res.ok) throw new Error(`Logo fetch failed (${res.status})`);
  if (!/^image\//.test(res.contentType)) throw new Error(`Logo URL returned ${res.contentType || "no content type"}, not an image`);
  return res.body;
}


export interface RenderOptions {
  config: MerchConfig;
  projectName: string;
  startedAt: Date | string | null;
  face: MerchFace;
  /** Print files are transparent; previews get the garment colour behind them. */
  preview?: boolean;
  /** Output width. Defaults to full print resolution. */
  width?: number;
}

/**
 * Renders one face.
 *
 * Layout is expressed in print-space (4500×5400) and scaled at the end, so a
 * preview is the print file at a different size and cannot drift from it.
 */
export function buildFaceSvg(
  opts: Pick<RenderOptions, "config" | "projectName" | "startedAt" | "face">,
): string {
  const { config, projectName, startedAt, face } = opts;
  const ink = INK[config.colorway] ?? INK.black;
  const cx = PRINT_WIDTH / 2;
  const parts: string[] = [];

  if (face === "front" || face === "creator") {
    // One line, as large as the print area allows. This is the whole design.
    const text = face === "creator" ? CREATOR_TAGLINE : BELIEVER_TAGLINE;
    parts.push(layout(text, {
      font: bold(), size: 560, maxWidth: PRINT_WIDTH * 0.86,
      centerX: cx, baselineY: PRINT_HEIGHT * 0.52, fill: ink,
    }).svg);
  } else {
    // Back: logo, then name, then the datestamp, stacked and centred.
    const name = config.displayName || projectName;
    const stamp = config.showDatestamp ? datestampLabel(startedAt) : null;
    const showLogo = config.showLogo && !!config.logoUrl;

    /*
     * The stack starts under the logo when there is one and near the middle
     * when there isn't, so a name-only back doesn't sit in the top third of
     * the shirt with a hole above it.
     */
    let y = showLogo ? LOGO_TOP + LOGO_SIZE + 420 : PRINT_HEIGHT * 0.46;

    const STAMP_SIZE = 200;
    if (config.showName) {
      const l = layout(name, {
        font: bold(), size: 420, maxWidth: PRINT_WIDTH * 0.8,
        centerX: cx, baselineY: y, fill: ink,
      });
      parts.push(l.svg);
      /*
       * Advance by the name's descender plus a full stamp line. Deriving the
       * gap from the name's own (possibly shrunken) size collapsed it for
       * long names, and the datestamp printed straight through them.
       */
      y += l.height * 0.28 + STAMP_SIZE;
    }
    if (stamp) {
      parts.push(layout(stamp, {
        font: regular(), size: STAMP_SIZE, maxWidth: PRINT_WIDTH * 0.6,
        centerX: cx, baselineY: y, fill: ink,
      }).svg);
    }
    // The wordmark stays small and quiet — it's our credit, not the design.
    parts.push(layout("SPARKTOWER", {
      font: regular(), size: 110, maxWidth: PRINT_WIDTH * 0.4,
      centerX: cx, baselineY: PRINT_HEIGHT * 0.9, fill: ink,
    }).svg);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PRINT_WIDTH}" height="${PRINT_HEIGHT}" viewBox="0 0 ${PRINT_WIDTH} ${PRINT_HEIGHT}">${parts.join("")}</svg>`;
}

export async function renderMerchFace(opts: RenderOptions): Promise<Buffer> {
  const { config, face } = opts;
  const svg = buildFaceSvg(opts);

  const base = sharp({
    create: {
      width: PRINT_WIDTH, height: PRINT_HEIGHT, channels: 4,
      background: opts.preview
        ? GARMENT[config.colorway] ?? GARMENT.black
        : { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });

  const layers: OverlayOptions[] = [];

  // The logo sits above the text block on the back.
  if (face === "back" && config.showLogo && config.logoUrl) {
    try {
      const raw = await loadLogo(config.logoUrl);
      const logo = await sharp(raw)
        .resize(LOGO_SIZE, LOGO_SIZE, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      const meta = await sharp(logo).metadata();
      layers.push({
        input: logo,
        left: Math.max(0, Math.round((PRINT_WIDTH - (meta.width ?? LOGO_SIZE)) / 2)),
        top: LOGO_TOP,
      });
    } catch (err) {
      // A broken logo URL must not produce a blank print file silently.
      throw new Error(`Logo could not be used: ${(err as Error).message}`);
    }
  }

  /*
   * Rasterised to exact dimensions before compositing. sharp rejects an
   * overlay even one pixel larger than its base, and librsvg's idea of how
   * big an SVG is doesn't always survive the round trip through its width
   * attribute — so the size is stated rather than inferred.
   */
  const textLayer = await sharp(Buffer.from(svg))
    .resize(PRINT_WIDTH, PRINT_HEIGHT, { fit: "fill" })
    .png()
    .toBuffer();
  layers.push({ input: textLayer, top: 0, left: 0 });

  const full = await base.composite(layers).png().toBuffer();

  /*
   * Downscaled in a second pass, not by chaining .resize() onto the same
   * pipeline. sharp applies resize *before* composite regardless of call
   * order, so chaining shrinks the blank base and then tries to lay
   * full-resolution artwork on top of it.
   */
  if (opts.width && opts.width !== PRINT_WIDTH) {
    return sharp(full).resize(Math.round(opts.width)).png().toBuffer();
  }
  return full;
}
