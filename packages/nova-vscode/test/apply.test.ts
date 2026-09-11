/**
 * The apply flow: what gets offered, and what gets written.
 *
 * This is the part of the extension with the most to lose. A wrong answer here
 * is somebody's file overwritten, or a model-written path landing outside the
 * repository — neither of which is visible by reading the code, and both of
 * which are one comparison away.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Uri, applied, reset, setApplyEditResult, terminals } from "./vscode-stub.js";
import { classify, resolveTarget, applyFiles, stageRunSteps, stageRunGroup, describeRisk, defaultPicked } from "../src/apply.js";

const file = (path: string, content: string, purpose?: string) => ({ path, language: "ts", content, purpose });

beforeEach(reset);

describe("resolveTarget", () => {
  it("lands a relative path under the workspace", () => {
    const root = Uri.file("/work/repo") as any;
    expect(resolveTarget(root, "src/app.ts")?.fsPath).toBe("/work/repo/src/app.ts");
  });

  it("refuses anything that would escape it", () => {
    const root = Uri.file("/work/repo") as any;
    for (const bad of ["../outside.ts", "/etc/passwd", "src/../../escape.ts", "~/.zshrc", "C:/Windows/x.txt"]) {
      expect(resolveTarget(root, bad), bad).toBeNull();
    }
  });

  it("refuses a sibling directory with a prefix name", () => {
    // "/work/repo-evil" starts with "/work/repo" as a string but is a
    // different directory; the check has to be on the segment boundary.
    const root = Uri.file("/work/repo") as any;
    expect(resolveTarget(root, "../repo-evil/x.ts")).toBeNull();
  });
});

describe("classify", () => {
  it("tells new, changed and identical apart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-apply-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "same.ts"), "export const a = 1;\n");
    await writeFile(join(dir, "src", "different.ts"), "export const a = 1;\n");
    const root = Uri.file(dir) as any;

    const result = await classify(root, [
      file("src/same.ts", "export const a = 1;\n"),
      file("src/different.ts", "export const a = 2;\n"),
      file("src/brand-new.ts", "export const b = 3;\n"),
      file("../escape.ts", "nope"),
    ]);

    expect(result.map((r) => r.state)).toEqual(["identical", "changed", "new", "new"]);
    // The one that escapes gets no target at all, so it can never be written.
    expect(result[3].target).toBeNull();
    expect(result[3].reason).toMatch(/outside the workspace/);
  });
});

describe("applyFiles", () => {
  it("writes everything chosen as one edit, so one undo puts it back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-apply-"));
    const root = Uri.file(dir) as any;
    const entries = await classify(root, [file("a.ts", "A"), file("b.ts", "B")]);

    const result = await applyFiles(entries);

    expect(result.written).toEqual(["a.ts", "b.ts"]);
    expect(applied).toHaveLength(1);
    expect(applied[0].edits.map((e) => e.contents)).toEqual(["A", "B"]);
    expect(applied[0].edits.every((e) => e.overwrite)).toBe(true);
  });

  it("skips an entry with no target rather than guessing one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-apply-"));
    const root = Uri.file(dir) as any;
    const entries = await classify(root, [file("../escape.ts", "nope"), file("ok.ts", "yes")]);

    const result = await applyFiles(entries);
    expect(result.written).toEqual(["ok.ts"]);
    expect(applied[0].edits).toHaveLength(1);
  });

  it("reports a refused edit as written nothing, not as a partial success", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-apply-"));
    const root = Uri.file(dir) as any;
    const entries = await classify(root, [file("a.ts", "A")]);
    setApplyEditResult(false);

    const result = await applyFiles(entries);
    expect(result.written).toEqual([]);
    expect(result.failed).toEqual(["a.ts"]);
  });
});

describe("run steps", () => {
  it("types the first command into a terminal and runs nothing", async () => {
    const payload = {
      kind: "build" as const, summary: "", files: [], verify: "", assumptions: [],
      runSteps: ["npm install", "npm run dev"],
    };
    stageRunSteps(payload, Uri.file("/work/repo") as any);

    expect(terminals).toHaveLength(1);
    // One entry, no newline, nothing executed: a model wrote these commands.
    expect(terminals[0].sent).toEqual(["npm install"]);
  });
});

describe("a rewrite that would delete code", () => {
  /** A module other files import from, at a size where a wholesale rewrite means something. */
  const MODULE = [
    "export const attachVisitor = () => {};",
    "export async function recordActivity() {}",
    "export function registerAnalyticsIngest() {}",
    ...Array.from({ length: 20 }, (_, i) => `const detail${i} = ${i};`),
  ].join("\n") + "\n";

  it("is flagged with the names it deletes, and starts unticked", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-risk-"));
    await mkdir(join(dir, "server"), { recursive: true });
    await writeFile(join(dir, "server", "analytics.ts"), MODULE);

    const [entry] = await classify(Uri.file(dir) as any, [file("server/analytics.ts", "export const track = () => {};\n")]);

    expect(entry.state).toBe("changed");
    expect(entry.risk?.destructive).toBe(true);
    expect(entry.risk?.lostExports).toEqual(["attachVisitor", "recordActivity", "registerAnalyticsIngest"]);
    expect(describeRisk(entry.risk!)).toBe("deletes 3 exports: attachVisitor, recordActivity, registerAnalyticsIngest");
    // The default is what a hurried apply writes. This one has to be chosen.
    expect(defaultPicked(entry)).toBe(false);
  });

  it("leaves an additive edit ticked", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-risk-"));
    await mkdir(join(dir, "server"), { recursive: true });
    await writeFile(join(dir, "server", "analytics.ts"), MODULE);

    const [entry] = await classify(Uri.file(dir) as any, [file("server/analytics.ts", `${MODULE}export function trackExplore() {}\n`)]);

    expect(entry.risk?.destructive).toBe(false);
    expect(defaultPicked(entry)).toBe(true);
  });

  it("has nothing to say about a brand-new file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-risk-"));
    const [entry] = await classify(Uri.file(dir) as any, [file("shared/explore-events.ts", "export const EVENTS = [];\n")]);
    expect(entry.risk).toBeUndefined();
    expect(defaultPicked(entry)).toBe(true);
  });
});

describe("a run block into a terminal", () => {
  const block = (extra: Record<string, unknown>) => ({ where: "terminal", label: "", commands: ["npm install", "npm run dev"], copy: "", ...extra }) as any;

  it("types the whole block as one line, joined so it stops at the first failure — and runs nothing", () => {
    stageRunGroup(block({}), Uri.file("/work/repo") as any);
    expect(terminals).toHaveLength(1);
    expect(terminals[0].sent).toEqual(["npm install && npm run dev"]);
  });

  it("gives a new-tab block a terminal of its own, in its folder", () => {
    stageRunGroup(block({ where: "new-terminal", cwd: "client", commands: ["npm run build"] }), Uri.file("/work/repo") as any);
    expect(terminals[0].name).toBe("Nova · 2");
    expect((terminals[0].cwd as any).fsPath).toBe("/work/repo/client");
  });

  it("refuses a folder outside the workspace and stays at the root", () => {
    stageRunGroup(block({ cwd: "../../etc" }), Uri.file("/work/repo") as any);
    expect((terminals[0].cwd as any).fsPath).toBe("/work/repo");
  });
});
