/**
 * What writing a proposed file over an existing one would throw away.
 *
 * A build packet carries whole files, written from a summary of the project
 * rather than from the files themselves. For a new file that's fine. For an
 * existing one it means the model is rewriting code it has never seen, and the
 * failure is specific and quiet: it keeps what the summary mentioned and drops
 * everything else. The first real packet to hit this rewrote a 261-line
 * analytics module into 128 lines and deleted the six exports the server boots
 * from — the diff showed it, as a red block nobody reads to the end.
 *
 * So the comparison that matters is the one a person can act on in a second:
 * which exported names disappear. A deleted export is something else in the
 * codebase importing it and breaking. Line counts back that up for files that
 * export little.
 */
export interface RewriteRisk {
  /** Exported names the current file has and the proposed one doesn't. */
  lostExports: string[];
  /** Non-blank lines of the current file that don't survive anywhere in the proposed one. */
  removedLines: number;
  /** Non-blank lines in the current file. */
  totalLines: number;
  /** Worth stopping for: it deletes exports, or most of a file of any size. */
  destructive: boolean;
}

// `export default function x` is deliberately not a named export: turning a
// named export into a default one breaks every `import { x }`, and that is
// exactly how one of these rewrites broke a route registration.
const NAMED = /^export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|abstract\s+class|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
const LISTED = /^export\s+(?:type\s+)?\{([^}]*)\}/gm;

/** Every name a module exports, as far as its source text says. `default` stands for a default export. */
export function exportedNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(NAMED)) names.add(match[1]);
  for (const match of source.matchAll(LISTED)) {
    for (const part of match[1].split(",")) {
      // Word by word rather than `\s+as\s+`, which backtracks badly on long runs of spaces.
      const words = part.trim().split(/\s+/).filter(Boolean);
      const at = words.lastIndexOf("as");
      const exported = at >= 0 ? words[at + 1] : words.filter((w) => w !== "type").pop();
      if (exported) names.add(exported);
    }
  }
  if (/^export\s+default\b/m.test(source)) names.add("default");
  return names;
}

/** Below this, a wholesale rewrite is usually a small file being redone on purpose. */
const SMALL_FILE_LINES = 20;

export function rewriteRisk(current: string, proposed: string): RewriteRisk {
  const before = exportedNames(current);
  const after = exportedNames(proposed);
  const lostExports = [...before].filter((name) => !after.has(name)).sort();

  const surviving = new Set(proposed.split("\n").map((line) => line.trim()).filter(Boolean));
  const meaningful = current.split("\n").map((line) => line.trim()).filter(Boolean);
  const removedLines = meaningful.filter((line) => !surviving.has(line)).length;

  const destructive = lostExports.length > 0
    || (meaningful.length >= SMALL_FILE_LINES && removedLines / meaningful.length > 0.5);

  return { lostExports, removedLines, totalLines: meaningful.length, destructive };
}
