/**
 * The backer's certificate, drawn rather than generated.
 *
 * ## Why this is not a model call
 *
 * Every other picture in this product — badges, covers, logos — is drawn by an
 * image model, and a certificate must not be. It carries four things that have
 * to be exactly right: somebody's name, their believer number, the project's
 * name, and a date. Image models misspell names and invent digits, and the
 * failure lands on a thing somebody printed and pinned to a wall. So this is
 * SVG, composited by sharp, with every glyph converted to an outline — the same
 * pipeline the merch print files use, for the same reason.
 *
 * It also makes the reward free, which is what it is advertised as. A certificate
 * that cost a model call per download would be a reward with a bill attached.
 *
 * ## The ornament
 *
 * Generated, not drawn by hand and not an asset. The border is a guilloche — the
 * interference pattern you get by tracing a point on one circle rolling around
 * another, which is what banknotes and share certificates have used for two
 * centuries precisely because it cannot be redrawn by eye. The corner rosettes
 * and the seal are the same maths at different radii. All of it comes out of
 * `Math.sin`, so there is nothing to ship, nothing to licence, and it scales to
 * any print size without going soft.
 *
 * Each certificate's pattern is seeded from the project and the believer number,
 * so two backers of the same project have visibly different guilloche — and the
 * same backer's certificate is identical every time it is drawn, because the seed
 * is derived rather than random.
 *
 * ## The signature
 *
 * The creator's name, slanted, above a ruled line. This is an electronic
 * signature in the ordinary sense — their name, applied with intent, by the act
 * of running a campaign — and it is deliberately *not* dressed up as a captured
 * handwritten one. There is no script font in this repository and adding one to
 * imply a pen was involved would be a small forgery. If a creator ever uploads a
 * real signature image, `signatureImage` takes it and this falls back.
 */
import sharp, { type OverlayOptions } from "sharp";
import { BADGE_LEVELS, BELIEVER_TAGLINE, badgeLevelForAmount, formatBelieverNumber } from "@shared/backing";
import { bold, layout, measure, regular } from "./merch-render";

/**
 * US Letter, landscape, at 300dpi.
 *
 * Letter rather than A4 because the audience is American and a Letter file
 * prints on A4 with a hairline margin, where the reverse crops. 300dpi is the
 * floor at which type stops looking like a screenshot on paper.
 */
export const CERT_WIDTH = 3300;
export const CERT_HEIGHT = 2550;

export interface CertificateInput {
  backerName: string;
  projectTitle: string;
  believerNumber: number | null;
  /** Decides the metal the ornament is drawn in. */
  amountCents: number;
  /** When they backed it, for the date line. */
  backedAt: Date;
  /** The creator's name, for the signature. */
  creatorName: string;
  /** Transparent PNG, composited into the seal. */
  logo?: Buffer | null;
  /** A real signature, if one is ever uploaded. Overrides the typed name. */
  signatureImage?: Buffer | null;
  /** Said on the certificate when they asked not to be named. */
  anonymous?: boolean;
}

/** Paper, ink, and a rule — warm rather than white, because white paper photographs grey. */
const PAPER = "#fbf8f1";
const INK = "#1c1917";
const FAINT = "#9a8f7d";

/**
 * A small deterministic generator.
 *
 * The pattern has to differ between certificates and be identical across
 * redraws of the same one, so it is seeded from the content rather than from
 * `Math.random`. Mulberry32: short, and its only requirement is that it does not
 * repeat visibly within one drawing.
 */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hashOf = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * A point on the border's centre-line, by distance around it.
 *
 * The band is drawn by walking the rectangle's perimeter rather than by
 * clipping a circular spirograph to it — which is what this did first, and it
 * came out as scribble: a lattice that owes nothing to the shape it sits in
 * reads as damage to the paper, not as a border. Following the perimeter means
 * every strand runs parallel to the edge it is next to, which is what makes an
 * engraved border look deliberate.
 *
 * Returns the point and the outward normal, so a strand can be offset from the
 * line it is woven around.
 */
function onPerimeter(t: number, x: number, y: number, w: number, h: number): { px: number; py: number; nx: number; ny: number } {
  const per = 2 * (w + h);
  let d = ((t % 1) + 1) % 1 * per;
  if (d < w) return { px: x + d, py: y, nx: 0, ny: -1 };
  d -= w;
  if (d < h) return { px: x + w, py: y + d, nx: 1, ny: 0 };
  d -= h;
  if (d < w) return { px: x + w - d, py: y + h, nx: 0, ny: 1 };
  d -= w;
  return { px: x, py: y + h - d, nx: -1, ny: 0 };
}

/**
 * One woven strand of the border.
 *
 * A sine wave riding the perimeter. Several of these at different frequencies
 * and phases cross each other the way a guilloche does — the interference is the
 * effect, and it is the reason banknotes and share certificates have used this
 * for two centuries: it cannot be redrawn by eye.
 */
function strand(
  x: number, y: number, w: number, h: number,
  amplitude: number, frequency: number, phase: number,
  stroke: string, width: number, opacity: number,
): string {
  const steps = 2400;
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const { px, py, nx, ny } = onPerimeter(t, x, y, w, h);
    const off = Math.sin(t * Math.PI * 2 * frequency + phase) * amplitude;
    points.push(`${(px + nx * off).toFixed(1)},${(py + ny * off).toFixed(1)}`);
  }
  return `<polyline points="${points.join(" ")}" fill="none" stroke="${stroke}" `
    + `stroke-width="${width}" stroke-opacity="${opacity}" stroke-linejoin="round" stroke-linecap="round"/>`;
}

/** A rosette: the same maths at a small radius, for the corners and the seal. */
function rosette(cx: number, cy: number, r: number, petals: number, stroke: string, width: number, opacity: number): string {
  const steps = 720;
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const rr = r * (0.72 + 0.28 * Math.cos(petals * t));
    points.push(`${(cx + rr * Math.cos(t)).toFixed(1)},${(cy + rr * Math.sin(t)).toFixed(1)}`);
  }
  return `<polyline points="${points.join(" ")}" fill="none" stroke="${stroke}" `
    + `stroke-width="${width}" stroke-opacity="${opacity}"/>`;
}

/** Text as outlines, centred, clamped to a width so a long name shrinks rather than overflowing. */
function text(
  value: string,
  opts: { weight?: "bold" | "regular"; size: number; maxWidth: number; centerX: number; baselineY: number; fill: string; letterSpacing?: number },
): string {
  const font = opts.weight === "regular" ? regular() : bold();
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  /*
   * Letter-spacing is done by laying each character out separately, because
   * `layout` kerns — and a spaced-out small-caps line wants the kerning gone.
   */
  if (opts.letterSpacing) {
    const chars = [...clean];
    const widths = chars.map((c) => measure(font, font.stringToGlyphs(c), opts.size));
    const total = widths.reduce((a, b) => a + b, 0) + opts.letterSpacing * (chars.length - 1);
    const scale = total > opts.maxWidth ? opts.maxWidth / total : 1;
    let x = opts.centerX - (total * scale) / 2;
    const pieces: string[] = [];
    for (let i = 0; i < chars.length; i++) {
      const w = widths[i] * scale;
      pieces.push(layout(chars[i], {
        font, size: Math.round(opts.size * scale), maxWidth: opts.maxWidth,
        centerX: x + w / 2, baselineY: opts.baselineY, fill: opts.fill,
      }).svg);
      x += w + opts.letterSpacing * scale;
    }
    return pieces.join("");
  }
  return layout(clean, { font, size: opts.size, maxWidth: opts.maxWidth, centerX: opts.centerX, baselineY: opts.baselineY, fill: opts.fill }).svg;
}

/**
 * "9 March 2026" — spelled out, because 09/03/26 on a certificate reads as a
 * receipt, and because it is ambiguous between two continents.
 *
 * Forced to UTC. Without it this formats in the server's local zone, and a
 * backing stored at midnight UTC renders as the day before anywhere west of
 * Greenwich — which is how a certificate came out dated 8 March for a pledge
 * made on the 9th. Nobody would have questioned it; it is simply the wrong date
 * on a document somebody keeps.
 */
export function certificateDate(at: Date): string {
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * The whole certificate as one SVG string.
 *
 * Exported so it can be tested without rasterising: every fact that has to be
 * right is a substring of this, and asserting on it is faster and more precise
 * than reading pixels back out of a PNG.
 */
export function buildCertificateSvg(input: CertificateInput): string {
  const level = badgeLevelForAmount(input.amountCents);
  const metal = level.hex;

  const cx = CERT_WIDTH / 2;
  const name = input.anonymous ? "An anonymous believer" : (input.backerName || "A believer");

  /* Seeded from the content, so the pattern is this certificate's and is stable. */
  const rand = seeded(hashOf(`${input.projectTitle}:${input.believerNumber ?? 0}:${level.key}`));
  const jitter = (spread: number) => (rand() - 0.5) * spread;

  const margin = 110;
  const inner = 40;
  const pieces: string[] = [];

  /* Paper. */
  pieces.push(`<rect width="${CERT_WIDTH}" height="${CERT_HEIGHT}" fill="${PAPER}"/>`);

  /*
   * The woven band, between the two rules. Five strands at frequencies that do
   * not divide evenly, so the crossings never settle into a repeat — and seeded,
   * so this certificate's weave is its own and is the same every time it is
   * drawn.
   */
  const bandX = margin + inner / 2;
  const bandY = margin + inner / 2;
  const bandW = CERT_WIDTH - (margin + inner / 2) * 2;
  const bandH = CERT_HEIGHT - (margin + inner / 2) * 2;
  for (let i = 0; i < 5; i++) {
    pieces.push(strand(
      bandX, bandY, bandW, bandH,
      inner * 0.42,
      38 + i * 11 + Math.round(jitter(5)),
      rand() * Math.PI * 2,
      i % 2 === 0 ? metal : INK,
      1.8,
      i % 2 === 0 ? 0.85 : 0.3,
    ));
  }

  /* Two rules: the outer frame and a hairline inside it, which is what makes a border read as engraved. */
  pieces.push(`<rect x="${margin}" y="${margin}" width="${CERT_WIDTH - margin * 2}" height="${CERT_HEIGHT - margin * 2}" `
    + `fill="none" stroke="${INK}" stroke-width="7"/>`);
  pieces.push(`<rect x="${margin + inner}" y="${margin + inner}" width="${CERT_WIDTH - (margin + inner) * 2}" height="${CERT_HEIGHT - (margin + inner) * 2}" `
    + `fill="none" stroke="${metal}" stroke-width="3" stroke-opacity="0.9"/>`);

  /* A rosette in each corner, sitting over the join where two rules meet. */
  for (const [x, y] of [
    [margin + inner, margin + inner],
    [CERT_WIDTH - margin - inner, margin + inner],
    [margin + inner, CERT_HEIGHT - margin - inner],
    [CERT_WIDTH - margin - inner, CERT_HEIGHT - margin - inner],
  ] as const) {
    pieces.push(`<circle cx="${x}" cy="${y}" r="46" fill="${PAPER}" stroke="${INK}" stroke-width="4"/>`);
    pieces.push(rosette(x, y, 38, 8, metal, 2.2, 0.95));
    pieces.push(rosette(x, y, 22, 6, INK, 1.6, 0.55));
    pieces.push(`<circle cx="${x}" cy="${y}" r="7" fill="${metal}"/>`);
  }

  // ── The words ────────────────────────────────────────────────────────────
  const safe = CERT_WIDTH - (margin + inner) * 2 - 260;

  pieces.push(text("CERTIFICATE OF BELIEF", {
    size: 86, maxWidth: safe, centerX: cx, baselineY: 520, fill: INK, letterSpacing: 26,
  }));
  pieces.push(`<line x1="${cx - 300}" y1="575" x2="${cx + 300}" y2="575" stroke="${metal}" stroke-width="4"/>`);

  pieces.push(text("This certifies that", {
    weight: "regular", size: 56, maxWidth: safe, centerX: cx, baselineY: 730, fill: FAINT,
  }));

  /* The name, the largest thing on the page — it is what the certificate is about. */
  pieces.push(text(name, { size: 170, maxWidth: safe, centerX: cx, baselineY: 930, fill: INK }));
  pieces.push(`<line x1="${cx - 560}" y1="985" x2="${cx + 560}" y2="985" stroke="${FAINT}" stroke-width="2" stroke-opacity="0.6"/>`);

  const standing = input.believerNumber != null
    ? `is believer ${formatBelieverNumber(input.believerNumber)} of`
    : "backed the building of";
  pieces.push(text(standing, {
    weight: "regular", size: 56, maxWidth: safe, centerX: cx, baselineY: 1100, fill: FAINT,
  }));

  pieces.push(text(input.projectTitle, { size: 104, maxWidth: safe, centerX: cx, baselineY: 1250, fill: INK }));

  pieces.push(text(BELIEVER_TAGLINE, {
    weight: "regular", size: 46, maxWidth: safe - 200, centerX: cx, baselineY: 1400, fill: FAINT,
  }));

  // ── The seal ─────────────────────────────────────────────────────────────
  /*
   * Bottom-centre, where a wax seal goes, struck in the metal of the level they
   * reached — so a platinum certificate is visibly a different object from a
   * bronze one without a word saying so.
   *
   * Drawn darker than it first was. The pale metals, platinum especially, came
   * out as a grey smudge at print size: a seal has to read as pressed into the
   * page, and that needs a hard outer ring and ink in the engine-turning rather
   * than metal alone.
   */
  const sealX = cx;
  const sealY = 1740;
  const sealR = 230;
  pieces.push(`<circle cx="${sealX}" cy="${sealY}" r="${sealR}" fill="${PAPER}" stroke="${INK}" stroke-width="5"/>`);
  pieces.push(`<circle cx="${sealX}" cy="${sealY}" r="${sealR - 9}" fill="none" stroke="${metal}" stroke-width="7"/>`);
  pieces.push(rosette(sealX, sealY, sealR - 30, 16, INK, 2.4, 0.55));
  pieces.push(rosette(sealX, sealY, sealR - 62, 12, metal, 2.6, 1));
  pieces.push(`<circle cx="${sealX}" cy="${sealY}" r="${sealR - 96}" fill="none" stroke="${INK}" stroke-width="2.5" stroke-opacity="0.5"/>`);
  /* Radiating ticks — the detail that makes a seal read as struck rather than printed. */
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const r0 = sealR - 14;
    const r1 = sealR - (i % 6 === 0 ? 34 : 24);
    pieces.push(`<line x1="${(sealX + r0 * Math.cos(a)).toFixed(1)}" y1="${(sealY + r0 * Math.sin(a)).toFixed(1)}" `
      + `x2="${(sealX + r1 * Math.cos(a)).toFixed(1)}" y2="${(sealY + r1 * Math.sin(a)).toFixed(1)}" `
      + `stroke="${INK}" stroke-width="2" stroke-opacity="0.45"/>`);
  }

  /*
   * The level goes *beneath* the seal, on clear paper. Set around the inside of
   * the ring it collided with the engine-turning and could not be read at all,
   * which is the one word on the seal that has to be.
   */
  pieces.push(text(level.label.toUpperCase(), {
    size: 46, maxWidth: 900, centerX: sealX, baselineY: sealY + sealR + 78, fill: metal, letterSpacing: 18,
  }));
  pieces.push(`<line x1="${sealX - 150}" y1="${sealY + sealR + 108}" x2="${sealX + 150}" y2="${sealY + sealR + 108}" `
    + `stroke="${metal}" stroke-width="2.5"/>`);

  // ── The signature ────────────────────────────────────────────────────────
  const sigX = CERT_WIDTH - margin - inner - 520;
  const sigBase = 2090;
  if (!input.signatureImage) {
    /*
     * Slanted, which is as far as this goes. A script font would imply a pen;
     * this is a name applied electronically and should look like one.
     */
    pieces.push(`<g transform="translate(${sigX} ${sigBase}) skewX(-12) translate(${-sigX} ${-sigBase})">`);
    pieces.push(text(input.creatorName || "The founder", {
      size: 78, maxWidth: 900, centerX: sigX, baselineY: sigBase, fill: INK,
    }));
    pieces.push(`</g>`);
  }
  pieces.push(`<line x1="${sigX - 460}" y1="${sigBase + 40}" x2="${sigX + 460}" y2="${sigBase + 40}" stroke="${INK}" stroke-width="3"/>`);
  pieces.push(text("Founder", {
    weight: "regular", size: 38, maxWidth: 800, centerX: sigX, baselineY: sigBase + 108, fill: FAINT, letterSpacing: 8,
  }));

  /* The date, mirrored on the left, so the signature does not sit alone. */
  const dateX = margin + inner + 520;
  pieces.push(text(certificateDate(input.backedAt), {
    size: 64, maxWidth: 900, centerX: dateX, baselineY: sigBase, fill: INK,
  }));
  pieces.push(`<line x1="${dateX - 460}" y1="${sigBase + 40}" x2="${dateX + 460}" y2="${sigBase + 40}" stroke="${INK}" stroke-width="3"/>`);
  pieces.push(text("Backed on", {
    weight: "regular", size: 38, maxWidth: 800, centerX: dateX, baselineY: sigBase + 108, fill: FAINT, letterSpacing: 8,
  }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CERT_WIDTH}" height="${CERT_HEIGHT}" `
    + `viewBox="0 0 ${CERT_WIDTH} ${CERT_HEIGHT}">${pieces.join("")}</svg>`;
}

/**
 * The certificate as a PNG.
 *
 * The logo and any signature image are composited by sharp rather than embedded
 * as data URIs: an SVG carrying two base64 images is several megabytes of string
 * for the rasteriser to parse, and sharp will scale a real buffer better than a
 * renderer scales an embedded one.
 */
export async function renderCertificate(input: CertificateInput): Promise<Buffer> {
  const svg = buildCertificateSvg(input);
  const layers: OverlayOptions[] = [];

  if (input.logo) {
    /* Inside the seal, and well inside it — a logo touching the rosette looks like a mistake. */
    const box = 230;
    const logo = await sharp(input.logo).resize(box, box, { fit: "inside", withoutEnlargement: false }).png().toBuffer();
    const meta = await sharp(logo).metadata();
    layers.push({
      input: logo,
      left: Math.round(CERT_WIDTH / 2 - (meta.width ?? box) / 2),
      top: Math.round(1740 - (meta.height ?? box) / 2),
    });
  }

  if (input.signatureImage) {
    const box = { w: 820, h: 180 };
    const sig = await sharp(input.signatureImage).resize(box.w, box.h, { fit: "inside" }).png().toBuffer();
    const meta = await sharp(sig).metadata();
    layers.push({
      input: sig,
      left: Math.round(CERT_WIDTH - 110 - 40 - 520 - (meta.width ?? box.w) / 2),
      top: Math.round(2090 - (meta.height ?? box.h)),
    });
  }

  const base = sharp(Buffer.from(svg), { density: 72 }).png();
  return layers.length ? base.composite(layers).png().toBuffer() : base.toBuffer();
}

/** Every metal a certificate can be struck in, for anything that wants to show them all. */
export const CERTIFICATE_LEVELS = BADGE_LEVELS;
