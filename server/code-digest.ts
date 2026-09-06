/**
 * Compresses a repository into something an LLM can actually reason about.
 *
 * A codebase doesn't fit in a prompt, and naively sending "the biggest files"
 * produces an audit that talks about whatever happened to be long. So the
 * digest is built from the things that answer "what is actually built here":
 * the manifests (what it's made of), the routes and pages (what it exposes),
 * the data model (what it stores), the tests (what's verified), and a set of
 * short excerpts from the files that carry the most intent.
 *
 * Everything is deterministic and cheap — no model calls — so the same
 * repository always yields the same digest, and the audit's variance comes
 * from the reasoning rather than from which files got sampled.
 */
import type { RepoFile, RepoSnapshot } from "./code-ingest";

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** A framework/stack signal and the file that proves it. */
export interface StackSignal {
  name: string;
  evidence: string;
}

export interface RouteSignal {
  /** "GET /api/projects", "page: /dashboard", "handler: signup" */
  label: string;
  file: string;
}

export interface DigestSignals {
  fileCount: number;
  readCount: number;
  linesOfCode: number;
  languages: { name: string; files: number; lines: number }[];
  stack: StackSignal[];
  routes: RouteSignal[];
  dataModels: { name: string; file: string }[];
  testFiles: number;
  testFrameworks: string[];
  hasCi: boolean;
  hasDocker: boolean;
  hasReadme: boolean;
  hasEnvExample: boolean;
  envVarNames: string[];
  todoCount: number;
  consoleCount: number;
  /** Places that look like a committed credential. Reported, never echoed. */
  suspectedSecrets: { file: string; hint: string }[];
  authSignals: string[];
  dependencyCount: number;
  topLevelDirs: string[];
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  py: "Python", rb: "Ruby", go: "Go", rs: "Rust", java: "Java",
  kt: "Kotlin", swift: "Swift", cs: "C#", php: "PHP", ex: "Elixir",
  c: "C", h: "C", cpp: "C++", hpp: "C++", cc: "C++",
  vue: "Vue", svelte: "Svelte", astro: "Astro",
  css: "CSS", scss: "SCSS", html: "HTML", sql: "SQL",
  md: "Markdown", json: "JSON", yaml: "YAML", yml: "YAML",
};

const ext = (path: string) => {
  const name = path.split("/").pop() || "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

const isTest = (path: string) =>
  /(^|\/)(tests?|__tests__|spec|e2e|cypress|playwright)(\/|$)/i.test(path) ||
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
  /_test\.(go|py|rb)$/.test(path) ||
  /^test_.*\.py$/.test(path.split("/").pop() || "");

/** Dependency name → the stack it implies. Only well-known, load-bearing ones. */
const DEPENDENCY_STACK: Record<string, string> = {
  react: "React", "react-native": "React Native", next: "Next.js",
  vue: "Vue", nuxt: "Nuxt", svelte: "Svelte", "@sveltejs/kit": "SvelteKit",
  "@angular/core": "Angular", solid_js: "Solid", astro: "Astro", expo: "Expo",
  express: "Express", fastify: "Fastify", koa: "Koa", "@nestjs/core": "NestJS",
  hono: "Hono", "socket.io": "WebSockets (socket.io)", ws: "WebSockets",
  "drizzle-orm": "Drizzle ORM", prisma: "Prisma", "@prisma/client": "Prisma",
  typeorm: "TypeORM", sequelize: "Sequelize", mongoose: "MongoDB (Mongoose)",
  pg: "PostgreSQL", mysql2: "MySQL", sqlite3: "SQLite", redis: "Redis",
  "@supabase/supabase-js": "Supabase", "firebase": "Firebase",
  stripe: "Stripe", "@stripe/stripe-js": "Stripe",
  openai: "OpenAI", "@anthropic-ai/sdk": "Anthropic",
  passport: "Passport auth", "next-auth": "NextAuth", "@clerk/nextjs": "Clerk",
  "jsonwebtoken": "JWT auth", bcrypt: "Password hashing", bcryptjs: "Password hashing",
  jest: "Jest", vitest: "Vitest", mocha: "Mocha", "@playwright/test": "Playwright",
  cypress: "Cypress", "@testing-library/react": "React Testing Library",
  tailwindcss: "Tailwind CSS", "styled-components": "styled-components",
  vite: "Vite", webpack: "Webpack", esbuild: "esbuild",
  "@tanstack/react-query": "React Query", redux: "Redux", zustand: "Zustand",
  graphql: "GraphQL", trpc: "tRPC", "@trpc/server": "tRPC",
};

const TEST_FRAMEWORKS = ["jest", "vitest", "mocha", "@playwright/test", "cypress", "ava", "jasmine", "pytest", "rspec"];

function findFile(files: RepoFile[], predicate: (p: string) => boolean): RepoFile | undefined {
  // Shallowest match wins: a root package.json beats one in a sub-package.
  return files
    .filter((f) => f.content && predicate(f.path))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
}

/** Extracts routes from the shapes web frameworks actually use. */
function detectRoutes(files: RepoFile[]): RouteSignal[] {
  const routes: RouteSignal[] = [];
  const seen = new Set<string>();
  /*
   * Deduped by label, not by label+file. A route declared once and exercised
   * in three fixtures was listed three times, which crowded out real routes
   * and made a library's test server look like the application's API.
   */
  const push = (label: string, file: string) => {
    if (seen.has(label) || routes.length >= 120) return;
    seen.add(label);
    routes.push({ label, file });
  };

  for (const file of files) {
    if (!file.content) continue;
    // Routes defined in tests are fixtures, not the product's surface.
    if (isTest(file.path)) continue;
    const path = file.path;

    // Express / Fastify / Koa style: app.get("/x"), router.post('/y')
    for (const m of file.content.matchAll(
      /\b(?:app|router|server|api|fastify)\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*[`'"]([^`'"]{1,120})[`'"]/gi,
    )) {
      push(`${m[1].toUpperCase()} ${m[2]}`, path);
    }

    // Next.js / Nuxt / SvelteKit file-based routing
    const nextMatch = path.match(/^(?:src\/)?(?:app|pages)\/(.+)\.(tsx?|jsx?|vue|svelte)$/);
    if (nextMatch) {
      const routePath = "/" + nextMatch[1]
        .replace(/\/(page|route|index|\+page|\+server)$/, "")
        .replace(/\[\.\.\.(\w+)\]/g, ":$1*")
        .replace(/\[(\w+)\]/g, ":$1");
      push(`${path.includes("/api/") ? "api" : "page"}: ${routePath || "/"}`, path);
    }

    // Python: FastAPI/Flask decorators
    for (const m of file.content.matchAll(
      /@(?:app|router|blueprint|bp)\.(get|post|put|patch|delete|route)\s*\(\s*[`'"]([^`'"]{1,120})[`'"]/gi,
    )) {
      push(`${m[1].toUpperCase()} ${m[2]}`, path);
    }

    // Go: http.HandleFunc / chi / gin
    for (const m of file.content.matchAll(
      /\.(?:HandleFunc|GET|POST|PUT|PATCH|DELETE)\s*\(\s*[`'"]([^`'"]{1,120})[`'"]/g,
    )) {
      push(`route ${m[1]}`, path);
    }

    // Rails-style routes file
    if (/config\/routes\.rb$/.test(path)) {
      for (const m of file.content.matchAll(/^\s*(get|post|put|patch|delete|resources)\s+[:'"]([\w\/-]{1,80})/gim)) {
        push(`${m[1].toUpperCase()} ${m[2]}`, path);
      }
    }
  }
  return routes;
}

/** Extracts persisted entities from the common schema formats. */
function detectDataModels(files: RepoFile[]): { name: string; file: string }[] {
  const models: { name: string; file: string }[] = [];
  const seen = new Set<string>();
  const push = (name: string, file: string) => {
    if (!name || seen.has(name) || models.length >= 100) return;
    seen.add(name);
    models.push({ name, file });
  };

  for (const file of files) {
    if (!file.content) continue;
    const { path, content } = file;

    // Prisma
    if (path.endsWith(".prisma")) {
      for (const m of content.matchAll(/^\s*model\s+(\w+)\s*\{/gm)) push(m[1], path);
    }
    // Drizzle
    for (const m of content.matchAll(/\b(\w+)\s*=\s*(?:pg|mysql|sqlite)Table\s*\(\s*[`'"]([\w-]+)[`'"]/g)) {
      push(m[2], path);
    }
    // Mongoose
    for (const m of content.matchAll(/mongoose\.model\s*\(\s*[`'"](\w+)[`'"]/g)) push(m[1], path);
    for (const m of content.matchAll(/new\s+(?:mongoose\.)?Schema\s*\(/g)) {
      const near = content.slice(Math.max(0, (m.index ?? 0) - 120), m.index ?? 0);
      const nameMatch = near.match(/(?:const|let|var)\s+(\w+)Schema\s*=\s*$/);
      if (nameMatch) push(nameMatch[1], path);
    }
    // SQL migrations
    for (const m of content.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+[`"']?([\w.]+)[`"']?/gi)) {
      push(m[1], path);
    }
    // Django / SQLAlchemy
    for (const m of content.matchAll(/^class\s+(\w+)\s*\(\s*(?:models\.Model|Base)\s*\)/gm)) push(m[1], path);
    // TypeORM / Sequelize decorators
    for (const m of content.matchAll(/@Entity\s*\([^)]*\)\s*(?:export\s+)?class\s+(\w+)/g)) push(m[1], path);
  }
  return models;
}

function detectSecrets(files: RepoFile[]): { file: string; hint: string }[] {
  const found: { file: string; hint: string }[] = [];
  const patterns: [RegExp, string][] = [
    [/\bsk-[A-Za-z0-9]{20,}/, "an OpenAI-style secret key"],
    [/\bsk_live_[A-Za-z0-9]{10,}/, "a live Stripe secret key"],
    [/\bghp_[A-Za-z0-9]{20,}/, "a GitHub personal access token"],
    [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key id"],
    [/\bAIza[0-9A-Za-z_-]{30,}/, "a Google API key"],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "a private key"],
    [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "a Slack token"],
    [/\bpostgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/, "a database URL with a password in it"],
    [/\bmongodb(?:\+srv)?:\/\/[^\s:@]+:[^\s@]+@/, "a MongoDB URI with a password in it"],
  ];

  for (const file of files) {
    if (!file.content) continue;
    // A sample file is meant to hold placeholders.
    if (/\.(example|sample|template)$|\.env\.(example|sample)$/.test(file.path)) continue;
    for (const [pattern, hint] of patterns) {
      if (pattern.test(file.content)) {
        found.push({ file: file.path, hint });
        break;
      }
    }
    if (found.length >= 25) break;
  }
  return found;
}

function detectAuth(files: RepoFile[]): string[] {
  const signals = new Set<string>();
  for (const file of files) {
    if (!file.content) continue;
    const c = file.content;
    if (/\bpassport\.(?:use|authenticate)\b/.test(c)) signals.add("Passport strategies");
    if (/\bjwt\.(?:sign|verify)\b|jsonwebtoken/.test(c)) signals.add("JWT issuing/verification");
    if (/\bbcrypt(?:js)?\.(?:hash|compare)\b/.test(c)) signals.add("Password hashing");
    if (/\bisAuthenticated\b|\brequireAuth\b|\bwithAuth\b|\bauthMiddleware\b|\bensureLoggedIn\b/.test(c)) {
      signals.add("Auth middleware / route guards");
    }
    if (/getServerSession|useSession|clerkMiddleware|supabase\.auth/.test(c)) signals.add("Managed auth SDK");
    if (/\brole\s*[:=]\s*['"](?:admin|owner|member)['"]|hasRole|checkPermission/.test(c)) {
      signals.add("Role or permission checks");
    }
  }
  return [...signals];
}

/**
 * Scores a file by how much it reveals about the project's intent.
 *
 * Excerpts are the expensive part of the digest, so they go to the files a
 * reviewer would open first — entry points, routes, schema, config — rather
 * than to whatever is longest.
 */
function intentScore(file: RepoFile): number {
  const p = file.path.toLowerCase();
  const depth = p.split("/").length;
  let score = 0;

  if (/(^|\/)(index|main|app|server|routes?|api)\.[cm]?[jt]sx?$/.test(p)) score += 60;
  if (/(^|\/)(schema|models?|db|database|migrations?)\b/.test(p)) score += 55;
  if (/(^|\/)(routes?|api|controllers?|handlers?|endpoints?)\//.test(p)) score += 45;
  if (/(^|\/)(pages?|app|screens?|views?)\//.test(p)) score += 30;
  if (/(^|\/)(services?|lib|core|domain|usecases?)\//.test(p)) score += 30;
  if (/(^|\/)(components?|ui|widgets?)\//.test(p)) score += 12;
  if (/(^|\/)(hooks?|utils?|helpers?)\//.test(p)) score += 8;
  if (/(^|\/)(config|middleware|auth)\b/.test(p)) score += 35;
  if (isTest(file.path)) score += 5;

  // Prefer files near the root, and substantial-but-not-enormous ones.
  score -= depth * 3;
  const lines = (file.content?.match(/\n/g)?.length ?? 0) + 1;
  if (lines > 40) score += 10;
  if (lines > 200) score += 6;
  if (lines > 2000) score -= 25;

  return score;
}

/** Trims a file to its most informative opening, dropping import noise. */
function excerpt(file: RepoFile, maxLines: number): string {
  const lines = (file.content || "").split("\n");
  const meaningful: string[] = [];
  for (const line of lines) {
    if (meaningful.length >= maxLines) break;
    // Skip a long import prologue; keep everything after.
    if (meaningful.length === 0 && /^\s*(import\s|from\s+['"]|const\s+\w+\s*=\s*require\()/.test(line)) continue;
    meaningful.push(line.length > 200 ? `${line.slice(0, 200)}…` : line);
  }
  return meaningful.join("\n");
}

export interface CodeDigest {
  signals: DigestSignals;
  /** The prompt-ready text. */
  prompt: string;
}

export function buildCodeDigest(snapshot: RepoSnapshot): CodeDigest {
  const files = snapshot.files;
  const read = files.filter((f) => f.content);

  // --- languages and size -------------------------------------------------
  const langTally = new Map<string, { files: number; lines: number }>();
  let linesOfCode = 0;
  for (const file of read) {
    const language = LANGUAGE_BY_EXT[ext(file.path)];
    const lines = (file.content!.match(/\n/g)?.length ?? 0) + 1;
    if (!/^(Markdown|JSON|YAML)$/.test(language || "")) linesOfCode += lines;
    if (!language) continue;
    const entry = langTally.get(language) || { files: 0, lines: 0 };
    entry.files++;
    entry.lines += lines;
    langTally.set(language, entry);
  }
  const languages = [...langTally.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 10);

  // --- manifests and stack ------------------------------------------------
  const stack: StackSignal[] = [];
  const testFrameworks = new Set<string>();
  let dependencyCount = 0;

  const pkg = findFile(files, (p) => /(^|\/)package\.json$/.test(p));
  let packageScripts: Record<string, string> = {};
  let packageName = "";
  if (pkg?.content) {
    try {
      const parsed = JSON.parse(pkg.content);
      packageName = text(parsed.name, 80);
      packageScripts = parsed.scripts || {};
      const deps = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
      dependencyCount = Object.keys(deps).length;
      for (const dep of Object.keys(deps)) {
        const label = DEPENDENCY_STACK[dep];
        if (label) stack.push({ name: label, evidence: pkg.path });
        if (TEST_FRAMEWORKS.includes(dep)) testFrameworks.add(dep);
      }
    } catch { /* a malformed manifest is itself a finding, surfaced below */ }
  }

  for (const [pattern, label] of [
    [/(^|\/)requirements\.txt$/, "Python (requirements.txt)"],
    [/(^|\/)pyproject\.toml$/, "Python (pyproject)"],
    [/(^|\/)go\.mod$/, "Go modules"],
    [/(^|\/)Cargo\.toml$/, "Rust (Cargo)"],
    [/(^|\/)Gemfile$/, "Ruby (Bundler)"],
    [/(^|\/)pom\.xml$/, "Java (Maven)"],
    [/(^|\/)build\.gradle(\.kts)?$/, "Gradle"],
    [/(^|\/)composer\.json$/, "PHP (Composer)"],
    [/(^|\/)Package\.swift$/, "Swift Package Manager"],
    [/(^|\/)pubspec\.yaml$/, "Dart/Flutter"],
  ] as [RegExp, string][]) {
    const found = files.find((f) => pattern.test(f.path));
    if (found) stack.push({ name: label, evidence: found.path });
  }

  const hasDocker = files.some((f) => /(^|\/)(Dockerfile|docker-compose\.ya?ml)$/.test(f.path));
  const hasCi = files.some((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f.path) || /(^|\/)(\.gitlab-ci\.yml|\.circleci\/config\.yml|azure-pipelines\.yml|Jenkinsfile)$/.test(f.path));
  const readme = findFile(files, (p) => /^readme(\.md|\.rst|\.txt)?$/i.test(p.split("/").pop() || ""));
  const envExample = findFile(files, (p) => /\.env\.(example|sample|template)$/.test(p));

  // --- environment variables (names only — never values) ------------------
  const envVarNames = new Set<string>();
  for (const file of read) {
    for (const m of file.content!.matchAll(/process\.env\.([A-Z0-9_]{3,})/g)) envVarNames.add(m[1]);
    for (const m of file.content!.matchAll(/os\.(?:environ\.get|getenv)\(\s*['"]([A-Z0-9_]{3,})['"]/g)) envVarNames.add(m[1]);
  }
  if (envExample?.content) {
    for (const line of envExample.content.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]{3,})\s*=/);
      if (m) envVarNames.add(m[1]);
    }
  }

  // --- counts -------------------------------------------------------------
  let todoCount = 0;
  let consoleCount = 0;
  for (const file of read) {
    todoCount += (file.content!.match(/\b(?:TODO|FIXME|HACK|XXX)\b/g) || []).length;
    consoleCount += (file.content!.match(/console\.(?:log|debug)\s*\(/g) || []).length;
  }

  const testFileList = files.filter((f) => isTest(f.path));
  const routes = detectRoutes(read);
  const dataModels = detectDataModels(read);
  const suspectedSecrets = detectSecrets(read);
  const authSignals = detectAuth(read);

  const topLevelDirs = [...new Set(
    files.map((f) => (f.path.includes("/") ? f.path.split("/")[0] : "(root files)")),
  )].sort().slice(0, 40);

  const signals: DigestSignals = {
    fileCount: files.length,
    readCount: read.length,
    linesOfCode,
    languages,
    stack: dedupeStack(stack),
    routes,
    dataModels,
    testFiles: testFileList.length,
    testFrameworks: [...testFrameworks],
    hasCi, hasDocker,
    hasReadme: !!readme,
    hasEnvExample: !!envExample,
    envVarNames: [...envVarNames].sort().slice(0, 60),
    todoCount, consoleCount,
    suspectedSecrets,
    authSignals,
    dependencyCount,
    topLevelDirs,
  };

  // --- excerpts -----------------------------------------------------------
  const ranked = read
    .filter((f) => !/\.(md|json|lock)$/.test(f.path) || /package\.json$/.test(f.path))
    .map((f) => ({ file: f, score: intentScore(f) }))
    .sort((a, b) => b.score - a.score);

  const excerptBudget = 26;
  const excerpts = ranked.slice(0, excerptBudget).map(({ file }) => ({
    path: file.path,
    lines: (file.content!.match(/\n/g)?.length ?? 0) + 1,
    body: excerpt(file, 45),
  }));

  // --- the prompt ---------------------------------------------------------
  const section = (title: string, body: string) => `## ${title}\n${body}`;

  const prompt = [
    `# REPOSITORY: ${packageName || snapshot.source}`,
    snapshot.truncated
      ? `> Note: the archive was larger than the analysis budget, so this is a partial view (${signals.readCount} of ${signals.fileCount} files read).`
      : "",
    section("SIZE", [
      `${signals.fileCount} files (${signals.readCount} read), roughly ${signals.linesOfCode.toLocaleString()} lines of code`,
      `Languages: ${languages.map((l) => `${l.name} (${l.files} files, ${l.lines} lines)`).join(", ") || "none detected"}`,
      `Top-level layout: ${topLevelDirs.join(", ")}`,
    ].join("\n")),
    section("STACK DETECTED FROM MANIFESTS", signals.stack.length
      ? signals.stack.map((s) => `- ${s.name}  [${s.evidence}]`).join("\n")
      : "- nothing recognisable"),
    Object.keys(packageScripts).length
      ? section("SCRIPTS", Object.entries(packageScripts).slice(0, 20).map(([k, v]) => `- ${k}: ${text(v, 160)}`).join("\n"))
      : "",
    section(`ROUTES AND PAGES FOUND IN CODE (${routes.length})`, routes.length
      ? routes.slice(0, 90).map((r) => `- ${r.label}  [${r.file}]`).join("\n")
      : "- none detected. Either this isn't a web app, or nothing is wired up yet."),
    section(`PERSISTED DATA MODELS (${dataModels.length})`, dataModels.length
      ? dataModels.slice(0, 60).map((m) => `- ${m.name}  [${m.file}]`).join("\n")
      : "- none detected. There is no schema, or it isn't in a recognised format."),
    section("AUTH", authSignals.length ? authSignals.map((a) => `- ${a}`).join("\n") : "- no authentication code detected"),
    section("ENGINEERING SIGNALS", [
      `Tests: ${signals.testFiles} test files${signals.testFrameworks.length ? ` (${signals.testFrameworks.join(", ")})` : " — no test framework in the manifest"}`,
      `CI: ${hasCi ? "configured" : "none"}`,
      `Docker: ${hasDocker ? "present" : "none"}`,
      `README: ${signals.hasReadme ? "present" : "MISSING"}`,
      `.env example: ${signals.hasEnvExample ? "present" : "missing"}`,
      `Dependencies: ${dependencyCount}`,
      `TODO/FIXME markers: ${todoCount}`,
      `console.log calls: ${consoleCount}`,
      `Environment variables referenced: ${signals.envVarNames.join(", ") || "none"}`,
      suspectedSecrets.length
        ? `POSSIBLE COMMITTED CREDENTIALS: ${suspectedSecrets.map((s) => `${s.file} (${s.hint})`).join("; ")}`
        : "No committed credentials detected.",
    ].join("\n")),
    section("FILE TREE", buildTree(files)),
    section("SOURCE EXCERPTS (opening lines of the most revealing files)",
      excerpts.map((e) => `### ${e.path} (${e.lines} lines)\n\`\`\`\n${e.body}\n\`\`\``).join("\n\n")),
    readme?.content ? section("README", text(readme.content, 3000)) : "",
  ].filter(Boolean).join("\n\n");

  return { signals, prompt };
}

function dedupeStack(stack: StackSignal[]): StackSignal[] {
  const seen = new Set<string>();
  return stack.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)));
}

/**
 * A compact directory listing.
 *
 * Grouped by folder with per-folder counts rather than one line per file: a
 * flat 4000-line list would crowd out the excerpts, and what matters is the
 * shape of the tree and which files exist in each part of it.
 */
function buildTree(files: RepoFile[], maxLines = 220): string {
  const byDir = new Map<string, string[]>();
  for (const file of files) {
    const idx = file.path.lastIndexOf("/");
    const dir = idx === -1 ? "." : file.path.slice(0, idx);
    const name = idx === -1 ? file.path : file.path.slice(idx + 1);
    const list = byDir.get(dir) || [];
    list.push(name);
    byDir.set(dir, list);
  }

  const dirs = [...byDir.keys()].sort();
  const lines: string[] = [];
  for (const dir of dirs) {
    if (lines.length >= maxLines) {
      lines.push(`… ${dirs.length - dirs.indexOf(dir)} more directories`);
      break;
    }
    const names = byDir.get(dir)!;
    const shown = names.slice(0, 14).join(", ");
    lines.push(`${dir}/  (${names.length}) — ${shown}${names.length > 14 ? `, …${names.length - 14} more` : ""}`);
  }
  return lines.join("\n");
}
