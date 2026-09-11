/**
 * The two pure functions everything else trusts.
 *
 * `safeRelativePath` decides whether a model-written path may be written to at
 * all, and `collectTree` decides what a verification or an audit is allowed to
 * see. Both are the kind of thing that looks obviously correct and isn't: the
 * interesting cases are Windows separators, a climb hidden mid-path, and a
 * directory that should never have been read.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeRelativePath } from "../src/paths.js";
import { collectTree } from "../src/tree.js";

const LIMITS = { maxFiles: 100, maxFileBytes: 1024 * 64, maxTotalBytes: 1024 * 1024 };

describe("safeRelativePath", () => {
  it("accepts ordinary repository paths, normalising separators", () => {
    expect(safeRelativePath("server/routes.ts")).toBe("server/routes.ts");
    expect(safeRelativePath("./src/index.ts")).toBe("src/index.ts");
    expect(safeRelativePath("src\\components\\App.tsx")).toBe("src/components/App.tsx");
    expect(safeRelativePath("a//b///c.ts")).toBe("a/b/c.ts");
  });

  it("refuses anything that could land outside the workspace", () => {
    for (const bad of [
      "/etc/passwd",
      "~/.ssh/authorized_keys",
      "../secrets.env",
      "src/../../outside.ts",
      "..\\..\\windows\\system32",
      "C:/Windows/System32/drivers/etc/hosts",
      "//server/share/file.txt",
      "src/evil\0.ts",
      "",
      "   ",
      ".",
      "./",
    ]) {
      expect(safeRelativePath(bad), bad).toBeNull();
    }
  });

  it("allows a climb-looking name that isn't one", () => {
    // "..foo" is a legal file name; only a whole ".." segment climbs.
    expect(safeRelativePath("src/..foo/bar.ts")).toBe("src/..foo/bar.ts");
  });
});

describe("collectTree", () => {
  it("reads source, records the rest by path, and never opens a dependency", async () => {
    const root = await mkdtemp(join(tmpdir(), "nova-tree-"));
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "left-pad"), { recursive: true });
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "src", "index.ts"), "export const x = 1;\n");
    await writeFile(join(root, "package.json"), "{}\n");
    await writeFile(join(root, "package-lock.json"), "{}\n");
    await writeFile(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(join(root, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");
    await writeFile(join(root, "dist", "bundle.js"), "console.log(1);\n");

    const result = await collectTree(root, LIMITS);
    const paths = result.files.map((f) => f.path).sort();

    expect(paths).toEqual(["logo.png", "package.json", "src/index.ts"]);
    // A binary is in the tree so the map is complete, but it isn't read.
    expect(result.files.find((f) => f.path === "logo.png")!.content).toBeUndefined();
    expect(result.files.find((f) => f.path === "src/index.ts")!.content).toContain("export const x");
    expect(result.read).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("stops at the file limit and says so", async () => {
    const root = await mkdtemp(join(tmpdir(), "nova-tree-"));
    for (let i = 0; i < 12; i++) await writeFile(join(root, `f${i}.ts`), `export const n = ${i};\n`);

    const result = await collectTree(root, { ...LIMITS, maxFiles: 5 });
    expect(result.files.length).toBeLessThanOrEqual(5);
    // The caller has to be told: unread code reads as "not built" otherwise.
    expect(result.truncated).toBe(true);
  });

  it("doesn't follow a symlink out of the tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "nova-tree-"));
    const outside = await mkdtemp(join(tmpdir(), "nova-outside-"));
    await writeFile(join(outside, "secret.ts"), "export const secret = 'do not upload';\n");
    await writeFile(join(root, "app.ts"), "export const app = 1;\n");
    await symlink(outside, join(root, "linked"), "dir");

    const result = await collectTree(root, LIMITS);
    expect(result.files.map((f) => f.path)).toEqual(["app.ts"]);
    expect(JSON.stringify(result)).not.toContain("do not upload");
  });
});
