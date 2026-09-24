/**
 * The mobile app restates a few shared constants by hand — it builds from its
 * own tsconfig and doesn't import `@shared` — and a restatement drifts. That
 * isn't cosmetic here: a reason code the server doesn't know is a 400 the
 * reviewer sees as "couldn't undo that", on the screen where they're trying to
 * take back a mistake. This reads both sides and fails when they disagree.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { MODERATION_REASON_CODES, UNDO_REASON_CODES, UNDOABLE_ACTIONS } from "@shared/moderation";

const source = readFileSync(join(__dirname, "..", "..", "mobile", "app", "admin", "reports.tsx"), "utf8");

/** The `id: "…"` values inside one `const NAME = [ … ] as const;` block. */
function idsIn(name: string): string[] {
  const block = new RegExp(String.raw`const ${name} = \[([\s\S]*?)\n\] as const;`).exec(source);
  expect(block, `${name} should be declared in the mobile screen`).toBeTruthy();
  return [...block![1].matchAll(/id:\s*"([\w_]+)"/g)].map((m) => m[1]).sort();
}

/** The keys of one `const NAME: Record<string, string> = { … };` block. */
function keysIn(name: string): string[] {
  const block = new RegExp(String.raw`const ${name}: Record<string, string> = \{([\s\S]*?)\n\};`).exec(source);
  expect(block, `${name} should be declared in the mobile screen`).toBeTruthy();
  return [...block![1].matchAll(/(\w+):\s*"/g)].map((m) => m[1]).sort();
}

describe("what the mobile review screen restates", () => {
  it("uses the reason codes the server accepts, for decisions and for undoing them", () => {
    expect(idsIn("REASON_CODES")).toEqual(MODERATION_REASON_CODES.map((r) => r.id).sort());
    expect(idsIn("UNDO_REASON_CODES")).toEqual(UNDO_REASON_CODES.map((r) => r.id).sort());
  });

  it("offers undo on exactly the decisions the server can undo", () => {
    expect(keysIn("UNDOABLE_ACTIONS")).toEqual(Object.keys(UNDOABLE_ACTIONS).sort());
  });

  it("has a word for every action it can show, including the new ones", () => {
    const words = keysIn("ACTION_WORDS");
    const missing = [...Object.keys(UNDOABLE_ACTIONS), ...Object.values(UNDOABLE_ACTIONS)].filter((a) => !words.includes(a));
    expect(missing, "actions the history would print as a raw identifier").toEqual([]);
  });
});

/**
 * Photos come from the phone's photos.
 *
 * Every image upload in the app used the document picker filtered to image
 * types, on the belief that iOS would offer Photos behind it. It offers Files:
 * iCloud Drive, and a Recents list of PDFs. Somebody adding a picture to a
 * post was being asked to export it first, and the picture they had just taken
 * was not there at all.
 *
 * This reads the app's source rather than trusting that, because the mistake
 * is one line in a new file and nothing else would notice: a document picker
 * asking for image types is a photo picker that opens the wrong app.
 */
describe("where the app gets a picture from", () => {
  const root = join(__dirname, "..", "..");
  const mobileSrc = join(root, "mobile", "src");
  const sources = (dir: string): { path: string; text: string }[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return sources(p);
      return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [{ path: p, text: readFileSync(p, "utf8") }] : [];
    });

  it("never asks the document picker for an image, outside the fallback", () => {
    /*
     * photos.ts is the exception and the reason the rule exists: when the
     * build has no photo library in it, Files filtered to images is better
     * than a button that throws. Everywhere else, asking Files for a picture
     * is the bug this guards.
     */
    const offenders = sources(mobileSrc)
      .filter((f) => /getDocumentAsync\([^)]*image\//s.test(f.text))
      .map((f) => f.path.slice(join(__dirname, "..", "..").length + 1))
      .filter((p) => p !== "mobile/src/photos.ts");
    expect(offenders, "these ask Files for a photo; mobile/src/photos.ts is what opens Photos").toEqual([]);
  });

  it("keeps the document picker for the things that really are files", () => {
    // The guard above must not be satisfied by deleting the document picker:
    // a CV, a project's documents and a zipped codebase all belong in Files.
    const withDocs = sources(mobileSrc).filter((f) => f.text.includes("getDocumentAsync"));
    expect(withDocs.length, "documents still come from Files").toBeGreaterThan(0);
  });

  it("asks for photo access with a sentence that says what for", () => {
    const app = JSON.parse(readFileSync(join(root, "mobile", "app.json"), "utf8"));
    const plugin = app.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === "expo-image-picker");
    expect(plugin, "the plugin carries the permission string into the build").toBeTruthy();
    /*
     * Not a decoration: iOS shows this exact sentence in the dialog, and a
     * vague one gets refused by people and rejected at review.
     */
    expect(plugin[1].photosPermission).toMatch(/photos/i);
    expect(plugin[1].photosPermission.length).toBeGreaterThan(40);
  });
});

/**
 * A picture on the phone has to be an absolute address.
 *
 * The server returns `/objects/uploads/<id>` for every image it stores. The
 * web resolves that against the page; React Native resolves it against
 * nothing and draws blank space, with no error and no broken-image icon —
 * which is exactly what the app did, everywhere, for as long as nobody
 * happened to compare it against the website. `assetUri` is the one thing
 * that makes those paths fetchable, so an `<Image>` that skips it is a
 * picture that will not appear.
 */
describe("pictures on the phone", () => {
  const appRoot = join(__dirname, "..", "..", "mobile");
  const files = (dir: string): { path: string; text: string }[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return e.name === "node_modules" ? [] : files(p);
      return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [{ path: p, text: readFileSync(p, "utf8") }] : [];
    });

  it("every Image is given an absolute address", () => {
    const offenders: string[] = [];
    for (const f of [...files(join(appRoot, "src")), ...files(join(appRoot, "app"))]) {
      // Comments come out first: a comment showing the wrong way (assetUri.ts
      // explains the bug it exists for) is not the wrong way being done.
      const code = f.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
      for (const m of code.matchAll(/source=\{\{\s*uri:?([^}]*)\}\}/g)) {
        const expr = m[1];
        // Already absolute (built from API_URL or a literal http) or passed through assetUri.
        if (/assetUri|API_URL|https?:\/\//.test(expr)) continue;
        offenders.push(`${f.path.slice(appRoot.length + 1)}: ${m[0].slice(0, 60)}`);
      }
    }
    expect(offenders, "these render nothing on a phone — wrap the value in assetUri()").toEqual([]);
  });
});

describe("the sizes a picture is asked for", () => {
  it("is the same list on the phone, in the web's shared module, and on the server", async () => {
    /*
     * Three copies by necessity — Metro can't resolve @shared, and the server
     * builds what the clients ask for. A width nobody builds is not an error
     * anywhere: the server quietly serves the original, so the only sign is
     * the bill and a slow phone.
     */
    const { IMAGE_WIDTHS } = await import("@shared/image-size");
    const { ALLOWED_WIDTHS } = await import("../../server/image-derivatives");
    expect([...ALLOWED_WIDTHS]).toEqual([...IMAGE_WIDTHS]);

    const phone = readFileSync(join(__dirname, "..", "..", "mobile", "src", "assetUri.ts"), "utf8");
    const restated = /export const IMAGE_WIDTHS = \[([^\]]*)\]/.exec(phone);
    expect(restated, "the phone should restate the widths").toBeTruthy();
    expect(restated![1].match(/\d+/g)!.map(Number)).toEqual([...IMAGE_WIDTHS]);
  });
});

