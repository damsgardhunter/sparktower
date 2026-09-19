#!/usr/bin/env node
/**
 * Are the icons the stores will actually accept?
 *
 * Apple rejects an app icon with an alpha channel — the upload fails with
 * "Invalid large app icon", after the build, after the wait. Google wants the
 * adaptive icon's art inside a safe circle on a square canvas. Neither is
 * visible by looking at the file, and both cost a round trip to find out the
 * slow way.
 *
 * No dependencies on purpose: it reads the PNG IHDR header itself (13 bytes,
 * 8 bytes in) so it runs anywhere node does, including before `npm install`.
 *
 *   node scripts/check-store-assets.mjs
 *
 * Exits non-zero if anything is wrong, so CI can hold the gate.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

/** Width, height and whether the colour type carries alpha. */
function readPng(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  // IHDR: length(4) type(4) width(4) height(4) bitDepth(1) colourType(1)
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colourType = buf.readUInt8(25);
  // 4 = greyscale+alpha, 6 = truecolour+alpha. 3 (palette) can carry a tRNS
  // chunk, which Apple also counts as transparency.
  const hasAlpha = colourType === 4 || colourType === 6 || buf.includes(Buffer.from("tRNS"));
  return { width, height, hasAlpha };
}

const checks = [
  {
    file: "icon.png",
    what: "iOS app icon",
    test: ({ width, height, hasAlpha }) => [
      width === 1024 && height === 1024 || `must be 1024x1024, is ${width}x${height}`,
      !hasAlpha || "must have no alpha channel — App Store Connect rejects the upload outright",
      // Apple draws the rounded corners itself; a pre-rounded icon gets them twice.
    ],
  },
  {
    file: "android-icon-foreground.png",
    what: "Android adaptive icon foreground",
    test: ({ width, height }) => [
      width === height || `must be square, is ${width}x${height}`,
      width >= 432 || `should be at least 432x432 (1024 preferred), is ${width}x${height}`,
    ],
  },
  {
    file: "android-icon-background.png",
    what: "Android adaptive icon background",
    test: ({ width, height }) => [
      width === height || `must be square, is ${width}x${height}`,
      width >= 432 || `should be at least 432x432, is ${width}x${height}`,
    ],
  },
  {
    file: "android-icon-monochrome.png",
    what: "Android themed icon",
    test: ({ width, height }) => [
      width === height || `must be square, is ${width}x${height}`,
      width >= 432 || `should be at least 432x432, is ${width}x${height}`,
    ],
  },
  {
    file: "splash-icon.png",
    what: "splash image",
    test: ({ width, height }) => [
      width >= 512 && height >= 512 || `looks small at ${width}x${height}`,
    ],
  },
];

let failed = 0;
for (const { file, what, test } of checks) {
  let meta;
  try {
    meta = readPng(join(assets, file));
  } catch (e) {
    console.error(`FAIL  ${file} — ${e.message}`);
    failed++;
    continue;
  }
  const problems = test(meta).filter((r) => r !== true);
  if (problems.length === 0) {
    console.log(`ok    ${file.padEnd(30)} ${meta.width}x${meta.height}${meta.hasAlpha ? " (alpha)" : ""}  — ${what}`);
  } else {
    failed += problems.length;
    for (const p of problems) console.error(`FAIL  ${file.padEnd(30)} ${p}`);
  }
}

console.log(
  failed === 0
    ? "\nStore assets look right. This checks dimensions and alpha, not whether the art is any good."
    : `\n${failed} problem(s). Fix before spending a build on them.`,
);
process.exit(failed === 0 ? 0 : 1);
