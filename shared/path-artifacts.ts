/**
 * The growth loop: publish a path artifact.
 *
 *   Finish a path step → it becomes an artifact → publish it: a public page
 *   (/a/:id) with a title and tags, a feed post, a link back to the project and
 *   its path → a stranger lands on it → starts their own path → finishes a step
 *   and publishes theirs.
 *
 * The rules here are pure: what an artifact holds, what a publish needs, and
 * the tags that make the page preview properly when the link is shared.
 */

export const ARTIFACT_TITLE_MIN = 5;
export const ARTIFACT_TITLE_MAX = 120;
export const ARTIFACT_MAX_TAGS = 5;
export const ARTIFACT_SUMMARY_MAX = 220;

export interface StepWork {
  kind: string;
  payload: any;
}

export interface AssembledArtifact {
  title: string;
  summary: string;
  body: string;
  files: { path: string; purpose?: string }[];
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * What a finished step produced, as something worth reading on its own. The
 * step's written answer is the body; a build step lists the files it made
 * (paths and purposes, never contents — code belongs in the repository); a
 * plan keeps its sections. No model call: this is the builder's own work.
 */
export function artifactFromStep(step: { title: string; answer: string | null | undefined }, work: StepWork | null): AssembledArtifact {
  const answer = (step.answer ?? "").trim();
  const p = work?.payload ?? {};
  let body = answer;
  let files: AssembledArtifact["files"] = [];
  if (work?.kind === "build") {
    files = (Array.isArray(p.files) ? p.files : []).slice(0, 20)
      .map((f: any) => ({ path: String(f?.path ?? "").slice(0, 200), ...(f?.purpose ? { purpose: String(f.purpose).slice(0, 200) } : {}) }))
      .filter((f: { path: string }) => f.path);
    // The answer for a build ends with its file list; the files are shown on their own.
    body = String(p.summary ?? answer).trim();
    if (p.verify) body += `\n\nHow it's verified: ${String(p.verify).trim()}`;
  } else if (work?.kind === "plan" && Array.isArray(p.sections) && p.sections.length) {
    body = [p.summary ? String(p.summary).trim() : "", ...p.sections.map((s: any) => `## ${String(s?.heading ?? "").trim()}\n${String(s?.body ?? "").trim()}`)].filter(Boolean).join("\n\n");
  }
  body = body.slice(0, 20_000);
  const summarySource = oneLine(body.replace(/^#+\s.*$/gm, "")) || oneLine(step.title);
  return { title: clip(oneLine(step.title), ARTIFACT_TITLE_MAX), summary: clip(summarySource, ARTIFACT_SUMMARY_MAX), body, files };
}

/** A tag as it's stored: lowercase words joined by hyphens. */
export const normalizeTag = (t: unknown) => String(t ?? "").toLowerCase().trim().replace(/^#/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);

/** The title and tags a publish carries, cleaned, or the reason it can't go out. */
export function validatePublish(raw: { title?: unknown; tags?: unknown }): { title: string; tags: string[] } | { error: string; field: string } {
  const title = oneLine(String(raw.title ?? ""));
  if (title.length < ARTIFACT_TITLE_MIN) return { error: "Give it a title people would click — a few words at least.", field: "title" };
  if (title.length > ARTIFACT_TITLE_MAX) return { error: `Keep the title under ${ARTIFACT_TITLE_MAX} characters.`, field: "title" };
  if (raw.tags != null && !Array.isArray(raw.tags)) return { error: "Tags are a list.", field: "tags" };
  const tags = [...new Set((raw.tags as unknown[] ?? []).map(normalizeTag).filter((t) => t.length >= 2))];
  if (tags.length > ARTIFACT_MAX_TAGS) return { error: `Up to ${ARTIFACT_MAX_TAGS} tags.`, field: "tags" };
  return { title, tags };
}

/** Where a visitor's "start my own path" choice waits through signup and onboarding, until project create reads it. */
export const PENDING_PATH_KEY = "st_pending_path";
export interface PendingPath {
  goal: string;
  fromArtifact: string;
  /** "start": open project create on this goal. "explore": see the artifact's project first. */
  intent?: "start" | "explore";
  projectId?: string;
}

/** Where a new account goes once onboarding is done, given what it chose on an artifact page. */
export function afterOnboardingPath(pending: PendingPath | null): string {
  if (pending?.intent === "explore" && pending.projectId && /^[A-Za-z0-9-]{8,64}$/.test(pending.projectId)) return `/projects/${pending.projectId}`;
  return "/projects/new";
}

/** The public URL of an artifact, relative to the site. */
export const artifactPath = (id: string) => `/a/${id}`;

/** The id in an artifact's public path, if a path is one ("/a/abc" or "/a/abc?x=1"). */
export function artifactIdFromPath(path: string | null | undefined): string | null {
  const m = /^\/a\/([A-Za-z0-9-]{8,64})(?:[/?#]|$)/.exec(path ?? "");
  return m ? m[1] : null;
}

export interface PageMeta { title: string; description: string; url: string; siteName?: string }

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The page's title, description and preview tags, put into index.html's head —
 * so a link pasted into a message, a post or a search result says what's on
 * the other end. Replaces an existing <title> if there is one.
 */
export function injectPageMeta(html: string, meta: PageMeta): string {
  const title = escapeHtml(meta.title), description = escapeHtml(meta.description), url = escapeHtml(meta.url);
  const site = escapeHtml(meta.siteName ?? "SparkTower");
  const tags = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="${site}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
  ].join("\n    ");
  const withoutTitle = html.replace(/<title>[\s\S]*?<\/title>\s*/i, "");
  return withoutTitle.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}
