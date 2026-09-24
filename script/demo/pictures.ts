/**
 * Faces and cover art for people who do not exist, drawn rather than fetched.
 *
 * A populated site needs pictures, and every obvious way of getting them is a
 * bad trade here. A model costs real money on every press and this wants
 * hundreds. A stock-photo API means a network call per image, a key, a rate
 * limit, and a seed script that does nothing useful on a plane. Worst of all,
 * photographs of real people would be real faces attached to invented names
 * and invented companies, which is not a thing to put in a database.
 *
 * So they are drawn: deterministic SVG, generated from the name, stored as a
 * data URI in the column the real uploader writes to. No network, no key, no
 * cost, reproducible, and obviously not a photograph of anybody.
 *
 * The palette is the product's own — the Nova gradient's greens and purples —
 * so a grid of these reads as belonging to the page rather than as clip art.
 */

/** Nova's own colours, plus enough neighbours that a wall of them isn't samey. */
const PALETTE = [
  ["#4ade80", "#10b981"], ["#10b981", "#0ea5e9"], ["#a855f7", "#6366f1"],
  ["#f97316", "#f43f5e"], ["#06b6d4", "#3b82f6"], ["#eab308", "#f97316"],
  ["#ec4899", "#a855f7"], ["#14b8a6", "#4ade80"], ["#6366f1", "#8b5cf6"],
];

/** A small, stable hash: the same name always draws the same person. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const initialsOf = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

const dataUri = (svg: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\s+/g, " ").trim())}`;

/**
 * A portrait: a gradient field, a few soft shapes, and the initials.
 *
 * Deliberately not a cartoon face. An abstract tile with initials reads as "a
 * person we have no photograph of", which is true, where a generated face
 * reads as a person — and inventing faces for invented people is a line worth
 * not crossing even in seed data.
 */
export function avatarFor(name: string): string {
  const h = hash(name);
  const [from, to] = PALETTE[h % PALETTE.length];
  const angle = h % 360;
  const cx = 20 + (h >> 3) % 60;
  const cy = 20 + (h >> 7) % 60;
  const r = 18 + (h >> 11) % 22;
  return dataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <linearGradient id="g" gradientTransform="rotate(${angle} 0.5 0.5)">
          <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill="url(#g)"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" opacity="0.14"/>
      <circle cx="${100 - cx}" cy="${100 - cy}" r="${r * 0.6}" fill="#000" opacity="0.10"/>
      <text x="50" y="50" text-anchor="middle" dominant-baseline="central"
            font-family="Inter, system-ui, sans-serif" font-size="34" font-weight="600"
            fill="#fff" opacity="0.92">${initialsOf(name)}</text>
    </svg>`);
}

/**
 * A project's logo: the same idea, squarer, with room for a longer mark.
 *
 * Keyed off the title *and* a salt so a founder and their project don't draw
 * the same tile next to each other.
 */
export function logoFor(title: string): string {
  const h = hash(`logo:${title}`);
  const [from, to] = PALETTE[h % PALETTE.length];
  const bars = 3 + (h >> 5) % 3;
  const marks = Array.from({ length: bars }, (_, i) => {
    const w = 10 + ((h >> (i * 3 + 2)) % 30);
    const y = 24 + i * 18;
    return `<rect x="22" y="${y}" width="${w}" height="8" rx="4" fill="#fff" opacity="${0.25 + i * 0.16}"/>`;
  }).join("");
  return dataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
        </linearGradient>
      </defs>
      <rect width="120" height="120" rx="26" fill="url(#g)"/>
      ${marks}
    </svg>`);
}

/**
 * A wide image for a post or a project header.
 *
 * Softer than the logo — this sits behind or beside words, so it is mostly
 * field with a little structure, and never anything that reads as a photograph.
 */
export function coverFor(seed: string): string {
  const h = hash(`cover:${seed}`);
  const [from, to] = PALETTE[h % PALETTE.length];
  const blobs = Array.from({ length: 4 }, (_, i) => {
    const cx = ((h >> (i * 5)) % 160) + 20;
    const cy = ((h >> (i * 3 + 2)) % 80) + 10;
    const r = 24 + ((h >> (i * 7)) % 46);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" opacity="0.07"/>`;
  }).join("");
  return dataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
        </linearGradient>
      </defs>
      <rect width="200" height="100" fill="url(#g)"/>
      ${blobs}
    </svg>`);
}
