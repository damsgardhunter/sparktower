/**
 * Reading the working tree, here rather than in the model.
 *
 * A repository can't travel through a tool call an agent composes by hand, and
 * it shouldn't have to: reading the disk is the editor side's job, and doing
 * it here keeps a source tree out of the conversation entirely. So the tools
 * that need files advertise `root`, and this fills `files` behind them.
 *
 * The ignore list is deliberately a copy of the server's rather than an import
 * of it — the package ships standalone. The server enforces its own limits on
 * whatever arrives, so a drift between the two lists costs a wasted upload,
 * never a wrong audit.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", "dist", "build", "out", "coverage",
  ".turbo", ".cache", "vendor", "__pycache__", ".venv", "venv", "env",
  "target", "bin", "obj", "Pods", ".gradle", ".idea", ".vscode", ".svelte-kit",
  "bower_components", "jspm_packages", ".yarn", ".pnpm-store", "site-packages",
  ".terraform", ".serverless", "tmp", "temp", ".parcel-cache", ".angular",
  ".dart_tool", ".expo", ".expo-shared", ".upm", ".replit_cache", ".pythonlibs",
]);

const IGNORED_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
  "composer.lock", "Gemfile.lock", "poetry.lock", "Cargo.lock", "go.sum", ".DS_Store",
]);

const TEXT_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts",
  "py", "rb", "go", "rs", "java", "kt", "kts", "swift", "m", "mm",
  "c", "h", "cpp", "hpp", "cc", "cs", "php", "ex", "exs", "erl", "clj",
  "scala", "dart", "lua", "r", "jl", "sh", "bash", "zsh", "fish", "ps1",
  "sql", "prisma", "graphql", "gql", "proto",
  "json", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "properties",
  "html", "htm", "css", "scss", "sass", "less", "styl", "vue", "svelte", "astro",
  "md", "mdx", "txt", "rst", "adoc",
]);

const TEXT_FILENAMES = new Set([
  "Dockerfile", "Makefile", "Procfile", "Rakefile", "Gemfile", "Brewfile",
  "LICENSE", "README", "CHANGELOG", "CODEOWNERS", ".gitignore", ".env.example",
  ".nvmrc", ".npmrc", ".editorconfig", "requirements.txt",
]);

const isTextual = (name: string): boolean => {
  if (TEXT_FILENAMES.has(name)) return true;
  const dot = name.lastIndexOf(".");
  return dot > 0 && TEXT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
};

export interface CollectedFile { path: string; content?: string }
export interface Collected {
  files: CollectedFile[];
  read: number;
  /** Hit a limit before the tree ran out. Reported so a partial audit says it's partial. */
  truncated: boolean;
  bytes: number;
}

export interface Limits { maxFiles: number; maxFileBytes: number; maxTotalBytes: number }

/**
 * Walks the tree breadth-first.
 *
 * Breadth-first because when a limit is hit, what's left unread should be the
 * deepest corners of the repository rather than everything after whichever
 * directory happened to sort first — a truncated snapshot that still contains
 * the top-level source is worth far more than one that stopped inside
 * `assets/`.
 */
export async function collectTree(root: string, limits: Limits): Promise<Collected> {
  const files: CollectedFile[] = [];
  const queue: string[] = [root];
  let bytes = 0, read = 0, truncated = false;

  while (queue.length) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // Unreadable directory: skipped, never fatal.
    }

    for (const entry of entries) {
      if (files.length >= limits.maxFiles) { truncated = true; break; }
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) queue.push(full);
        continue;
      }
      // Symlinks are not followed: a link out of the tree would upload
      // something the user never meant to send.
      if (!entry.isFile()) continue;
      if (IGNORED_FILES.has(entry.name)) continue;
      if (/\.min\.(js|css)$/.test(entry.name) || entry.name.endsWith(".map")) continue;

      const rel = relative(root, full).split(sep).join("/");
      let size = 0;
      try { size = (await stat(full)).size; } catch { continue; }

      if (!isTextual(entry.name) || size > limits.maxFileBytes || bytes + size > limits.maxTotalBytes) {
        // Recorded by path so the tree Nova sees is complete, but not read.
        files.push({ path: rel });
        if (bytes + size > limits.maxTotalBytes) truncated = true;
        continue;
      }
      try {
        const content = await readFile(full, "utf8");
        files.push({ path: rel, content });
        bytes += size;
        read++;
      } catch {
        files.push({ path: rel });
      }
    }
    if (files.length >= limits.maxFiles) { truncated = true; break; }
  }

  return { files, read, truncated, bytes };
}
