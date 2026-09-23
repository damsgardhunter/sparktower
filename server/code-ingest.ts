/**
 * Turns an uploaded zip or a GitHub repository into an in-memory file map.
 *
 * Everything here treats its input as hostile. A zip is user-supplied and can
 * be a bomb (a few kilobytes expanding to gigabytes), so entries are checked
 * against uncompressed size *before* being read, and the whole run is bounded
 * by total bytes and file count. Nothing is written to disk — the audit only
 * ever needs file contents in memory, which also sidesteps zip-slip entirely.
 */
import AdmZip from "adm-zip";

/** Total decompressed bytes we'll hold for one repository. */
export const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
/** Bytes of any single file. Bigger than this is generated or binary. */
export const MAX_FILE_BYTES = 512 * 1024;
/** Hard ceiling on how many files we'll consider. */
export const MAX_FILES = 4000;
/**
 * The archive itself, compressed.
 *
 * Generous, because people zip their project folder and that folder contains
 * node_modules — a 150MB archive of which 4MB is their own code is the normal
 * case, not an abuse. Entries are filtered by path from the central directory
 * before any of them is decompressed, so a large archive costs one buffer and
 * a directory scan rather than a large analysis.
 */
export const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024;

export interface RepoFile {
  /** Path relative to the repository root, forward slashes. */
  path: string;
  size: number;
  /** Absent for files we skipped reading (binary, too large, over budget). */
  content?: string;
}

export interface RepoSnapshot {
  files: RepoFile[];
  /** Where it came from, for the audit record. */
  source: string;
  /** Files present in the archive but deliberately not read. */
  skipped: number;
  /**
   * Of those, the ones that could have held an answer: source files.
   *
   * A skipped lockfile, PNG or font tells the audit nothing it was going to
   * grade, so counting them as "this read was partial" would make every audit
   * partial and no verdict of "missing" could ever survive — which is the
   * opposite failure from the one we are fixing. An unread *source* file is
   * different: it is a place the feature could have been.
   */
  unreadSource: number;
  truncated: boolean;
  totalBytes: number;
  /**
   * Provenance, for the audit's header (shared/audit-provenance.ts).
   *
   * An audit that grades code it could not see is the failure these exist to
   * make visible: a builder shown "62% built" has no way of knowing whether
   * the audit read today's tree or a zip from last Tuesday. Null means the
   * source genuinely cannot answer — an uploaded archive has no commit — and
   * saying so is the point; a guessed sha would be worse than none.
   */
  commit?: string | null;
  /** When this snapshot was taken (ISO). */
  capturedAt: string;
  /** Newest file timestamp in the archive, when the archive carries them. */
  contentAt?: string | null;
}

/**
 * Directories that are never the user's own work.
 *
 * Auditing "where the project is" means auditing what the builder wrote.
 * node_modules would swamp every signal and burn the entire byte budget on
 * dependencies. A lockfile's *contents* tell us nothing a manifest doesn't —
 * but whether one exists does (it pins installs), so lockfiles are recorded by
 * path and never read. They used to be dropped entirely, and the audit then
 * reported a repository with committed lockfiles as having none.
 */
const IGNORED_SEGMENTS = new Set([
  "node_modules", ".git", ".next", ".nuxt", "dist", "build", "out", "coverage",
  ".turbo", ".cache", "vendor", "__pycache__", ".venv", "venv", "env",
  "target", "bin", "obj", "Pods", ".gradle", ".idea", ".vscode", ".svelte-kit",
  "bower_components", "jspm_packages", ".yarn", ".pnpm-store", "site-packages",
  ".terraform", ".serverless", "tmp", "temp", ".DS_Store",
  // Replit and tooling scratch directories.
  ".upm", ".local", ".config", ".replit_cache", ".pythonlibs", ".nix-profile",
  "__MACOSX", ".parcel-cache", ".angular", ".dart_tool", ".expo", ".expo-shared",
]);

const IGNORED_FILES = new Set([".DS_Store"]);

/** Recorded by path (and size) so their presence is known; their contents are never read. */
export const LOCKFILES = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock",
  "composer.lock", "Gemfile.lock", "poetry.lock", "Cargo.lock", "go.sum", "uv.lock", "Pipfile.lock",
]);
const isLockfile = (path: string) => LOCKFILES.has(path.split("/").pop() || "");

/** Extensions worth reading as text. Anything else is recorded by path only. */
const TEXT_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts",
  "py", "rb", "go", "rs", "java", "kt", "kts", "swift", "m", "mm",
  "c", "h", "cpp", "hpp", "cc", "cs", "php", "ex", "exs", "erl", "clj",
  "scala", "dart", "lua", "r", "jl", "sh", "bash", "zsh", "fish", "ps1",
  "sql", "prisma", "graphql", "gql", "proto",
  "json", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "properties",
  "html", "htm", "css", "scss", "sass", "less", "styl", "vue", "svelte", "astro",
  "md", "mdx", "txt", "rst", "adoc",
  "gitignore", "dockerignore", "editorconfig", "nvmrc", "npmrc",
]);

/** Filenames without a useful extension that we still want to read. */
const TEXT_FILENAMES = new Set([
  "Dockerfile", "Makefile", "Procfile", "Rakefile", "Gemfile", "Brewfile",
  "LICENSE", "README", "CHANGELOG", "CODEOWNERS", ".gitignore", ".env.example",
  ".env.sample", ".nvmrc", ".npmrc", ".editorconfig", "requirements.txt",
]);

function isIgnored(path: string): boolean {
  const parts = path.split("/");
  if (parts.some((p) => IGNORED_SEGMENTS.has(p))) return true;
  const name = parts[parts.length - 1];
  if (IGNORED_FILES.has(name)) return true;
  // Minified and map files carry no reviewable intent.
  if (/\.min\.(js|css)$/.test(name) || name.endsWith(".map")) return true;
  return false;
}

function isTextual(path: string): boolean {
  const name = path.split("/").pop() || "";
  if (TEXT_FILENAMES.has(name)) return true;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return TEXT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/**
 * Strips the single wrapper directory GitHub archives are packaged in.
 *
 * A zipball expands to `repo-main/…`, which would put that prefix on every
 * path and make the whole tree read as one nested folder.
 */
function stripCommonRoot(paths: string[]): (p: string) => string {
  if (!paths.length) return (p) => p;
  const firstSegments = new Set(paths.map((p) => p.split("/")[0]));
  if (firstSegments.size !== 1) return (p) => p;
  const root = `${[...firstSegments][0]}/`;
  return (p) => (p.startsWith(root) ? p.slice(root.length) : p);
}

/** True when a buffer looks like binary rather than source. */
function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 1024);
  for (const byte of sample) if (byte === 0) return true;
  return false;
}

/**
 * Reads a zip archive into a snapshot.
 *
 * Sizes come from the central directory, so an oversized entry is rejected
 * without ever being decompressed.
 */
/**
 * A snapshot from files an editor-side agent handed over.
 *
 * The third source, and the only one where the sender already read the disk.
 * Treated exactly as hostile as the other two: the same ignore list, the same
 * per-file and total budgets, and paths normalised and refused if they try to
 * climb out of the tree. A client that respects the limits sends nothing that
 * gets dropped here — but the limits are enforced here, because the client is
 * someone else's process on someone else's machine.
 */
export function snapshotFromFiles(
  input: { path?: unknown; content?: unknown }[],
  source: string,
): RepoSnapshot {
  const files: RepoFile[] = [];
  const seen = new Set<string>();
  let totalBytes = 0, skipped = 0, unreadSource = 0, truncated = false;

  for (const raw of input) {
    if (files.length >= MAX_FILES) { truncated = true; break; }

    const path = String(raw?.path ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").trim();
    // No absolute paths, no climbing, no duplicates. None of these can be a
    // legitimate repository-relative path, so they are dropped rather than
    // sanitised into something that was never sent.
    if (!path || path.endsWith("/") || path.split("/").includes("..") || seen.has(path)) continue;
    seen.add(path);
    if (isIgnored(path)) continue;

    const content = typeof raw?.content === "string" ? raw.content : undefined;
    const size = content ? Buffer.byteLength(content, "utf8") : 0;

    if (isLockfile(path)) { files.push({ path, size }); continue; }
    if (content === undefined || !isTextual(path) || size > MAX_FILE_BYTES) {
      files.push({ path, size });
      skipped++;
      /*
       * A source file the audit did not see, either way round: one the editor
       * listed without contents, or one too big to read. Both are places the
       * feature could have been.
       */
      if (isTextual(path)) unreadSource++;
      continue;
    }
    if (totalBytes + size > MAX_TOTAL_BYTES) {
      files.push({ path, size });
      skipped++;
      unreadSource++;
      truncated = true;
      continue;
    }
    totalBytes += size;
    files.push({ path, size, content });
  }

  // The editor bridge reads the disk as it is now, so the snapshot is the tree
  // as it stands — uncommitted work included, which is why it carries no sha.
  return { files, source, skipped, unreadSource, truncated, totalBytes, capturedAt: new Date().toISOString(), commit: null, contentAt: null };
}

export function snapshotFromZip(archive: Buffer, source: string): RepoSnapshot {
  if (archive.length > MAX_ARCHIVE_BYTES) {
    throw new Error(
      `That archive is ${(archive.length / 1024 / 1024).toFixed(0)}MB, over the ` +
      `${MAX_ARCHIVE_BYTES / 1024 / 1024}MB limit. Zip it again without node_modules, ` +
      `build output or vendored dependencies — the audit ignores those anyway.`,
    );
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(archive);
  } catch {
    throw new Error("That file isn't a readable zip archive.");
  }

  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const rebase = stripCommonRoot(entries.map((e) => e.entryName.replace(/\\/g, "/")));

  const files: RepoFile[] = [];
  let totalBytes = 0;
  let skipped = 0;
  let unreadSource = 0;
  let truncated = false;

  for (const entry of entries) {
    if (files.length >= MAX_FILES) { truncated = true; break; }

    const path = rebase(entry.entryName.replace(/\\/g, "/"));
    if (!path || path.endsWith("/")) continue;
    if (isIgnored(path)) continue;

    const declared = entry.header.size;

    if (isLockfile(path)) { files.push({ path, size: declared }); continue; }
    if (!isTextual(path) || declared > MAX_FILE_BYTES) {
      // Recorded so the tree is complete, but not read.
      files.push({ path, size: declared });
      skipped++;
      if (isTextual(path) && declared > MAX_FILE_BYTES) unreadSource++;
      continue;
    }
    if (totalBytes + declared > MAX_TOTAL_BYTES) {
      files.push({ path, size: declared });
      skipped++;
      unreadSource++;
      truncated = true;
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = entry.getData();
    } catch {
      files.push({ path, size: declared });
      skipped++;
      // Unreadable, and it is a source file by extension: the audit is blind to it.
      unreadSource++;
      continue;
    }

    if (looksBinary(buffer)) {
      files.push({ path, size: buffer.length });
      skipped++;
      continue;
    }

    totalBytes += buffer.length;
    files.push({ path, size: buffer.length, content: buffer.toString("utf8") });
  }

  if (!files.length) {
    throw new Error("That archive has no readable source files in it.");
  }

  /*
   * How old the code in the archive is, as opposed to how recently it was
   * uploaded. Zip entries carry the mtime of the file they were made from, so
   * the newest of them is the closest honest answer to "when was this code" —
   * and it is exactly what a builder needs to see when an audit of a stale
   * upload tells them a feature they shipped on Friday doesn't exist.
   */
  const newest = entries.reduce((max, e) => {
    const t = e.header?.time instanceof Date ? e.header.time.getTime() : 0;
    return t > max ? t : max;
  }, 0);

  return {
    files, source, skipped, unreadSource, truncated, totalBytes,
    capturedAt: new Date().toISOString(),
    contentAt: newest > 0 ? new Date(newest).toISOString() : null,
    commit: null,
  };
}

export interface GithubRef {
  owner: string;
  repo: string;
  ref?: string;
}

/**
 * Parses the GitHub URL forms people actually paste.
 *
 * Accepts the web URL, the clone URL, an `owner/repo` shorthand, and a URL
 * with a branch already in it (`/tree/main`), because all four turn up when
 * you ask someone for "your repo link".
 */
export function parseGithubUrl(input: string): GithubRef | null {
  const raw = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  if (!raw) return null;

  const shorthand = raw.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shorthand) return { owner: shorthand[1], repo: shorthand[2] };

  const normalized = raw
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^git\+/, "");

  let url: URL;
  try {
    url = new URL(normalized.startsWith("http") ? normalized : `https://${normalized}`);
  } catch {
    return null;
  }
  if (!/(^|\.)github\.com$/.test(url.hostname)) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const [owner, repo, ...rest] = parts;
  // /tree/<ref> and /blob/<ref> both name a branch or tag.
  const refIndex = rest.findIndex((p) => p === "tree" || p === "blob");
  const ref = refIndex >= 0 ? rest.slice(refIndex + 1).join("/") || undefined : undefined;

  return { owner, repo, ref };
}

const GITHUB_HEADERS = (token?: string) => ({
  Accept: "application/vnd.github+json",
  "User-Agent": "SparkTower-Audit",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

/**
 * Commit messages since a moment, newest first — the builder's own record of
 * what they did, which is often the only one. Fails soft: an audit without
 * commits is still an audit.
 */
export async function fetchCommitsSince(
  fullName: string, branch: string, since: Date, token?: string,
): Promise<{ sha: string; message: string; at: string }[]> {
  try {
    const url = `https://api.github.com/repos/${fullName}/commits?sha=${encodeURIComponent(branch)}&since=${encodeURIComponent(since.toISOString())}&per_page=100`;
    const res = await fetch(url, { headers: GITHUB_HEADERS(token), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const rows = (await res.json()) as any[];
    return (Array.isArray(rows) ? rows : []).map((c) => ({
      sha: String(c?.sha ?? "").slice(0, 7),
      message: String(c?.commit?.message ?? "").split("\n")[0].slice(0, 160),
      at: String(c?.commit?.author?.date ?? ""),
    })).filter((c) => c.message);
  } catch {
    return [];
  }
}

export interface RepoMeta {
  fullName: string;
  defaultBranch: string;
  description: string | null;
  language: string | null;
  isPrivate: boolean;
  pushedAt: string | null;
  stars: number;
  openIssues: number;
}

/** Repository metadata, which also validates access before a big download. */
export async function fetchRepoMeta(ref: GithubRef, token?: string): Promise<RepoMeta> {
  const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, {
    headers: GITHUB_HEADERS(token),
  });

  if (res.status === 404) {
    throw new Error(
      token
        ? "GitHub says that repository doesn't exist, or the token can't see it."
        : "That repository doesn't exist or is private. Private repositories need a token.",
    );
  }
  if (res.status === 401 || res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      throw new Error("GitHub's rate limit is exhausted for this server. Try again shortly, or supply a token.");
    }
    throw new Error("GitHub refused that request. If the repository is private, supply a token that can read it.");
  }
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for that repository.`);

  const body = await res.json() as any;
  return {
    fullName: body.full_name,
    defaultBranch: body.default_branch || "main",
    description: body.description ?? null,
    language: body.language ?? null,
    isPrivate: !!body.private,
    pushedAt: body.pushed_at ?? null,
    stars: body.stargazers_count ?? 0,
    openIssues: body.open_issues_count ?? 0,
  };
}

/** Downloads a repository as a zip and reads it into a snapshot. */
/** `attachment; filename=owner-repo-0a1b2c3.zip` → `0a1b2c3`. */
export function archiveCommit(contentDisposition: string | null | undefined): string | null {
  const name = String(contentDisposition ?? "").match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
  const sha = name?.match(/-([0-9a-f]{7,40})(?:\.zip)?$/i)?.[1];
  return sha ? sha.slice(0, 10) : null;
}

export async function snapshotFromGithub(
  ref: GithubRef,
  token?: string,
): Promise<{ snapshot: RepoSnapshot; meta: RepoMeta }> {
  const meta = await fetchRepoMeta(ref, token);
  const branch = ref.ref || meta.defaultBranch;

  const res = await fetch(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/zipball/${encodeURIComponent(branch)}`,
    { headers: GITHUB_HEADERS(token), redirect: "follow" },
  );
  if (!res.ok) {
    throw new Error(`Couldn't download ${meta.fullName}@${branch} from GitHub (${res.status}).`);
  }

  const declaredLength = Number(res.headers.get("content-length") || 0);
  if (declaredLength && declaredLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`That repository is ${(declaredLength / 1024 / 1024).toFixed(0)}MB compressed, over the ${MAX_ARCHIVE_BYTES / 1024 / 1024}MB limit.`);
  }

  const archive = Buffer.from(await res.arrayBuffer());
  const snapshot = snapshotFromZip(archive, `github:${meta.fullName}@${branch}`);
  /*
   * The commit, free: GitHub names its zipballs `owner-repo-<sha>.zip` in the
   * content-disposition header, so the exact tree this audit read is knowable
   * without a second API call. When the header isn't there we leave it null
   * rather than reporting the branch name as if it were a commit — an audit
   * that says "at main" has told the reader nothing they can check.
   */
  snapshot.commit = archiveCommit(res.headers.get("content-disposition"));
  return { snapshot, meta };
}
