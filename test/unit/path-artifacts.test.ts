/** The growth loop's pure rules: what an artifact holds, what a publish needs, and how its page previews. */
import { describe, it, expect } from "vitest";
import { artifactFromStep, validatePublish, normalizeTag, artifactIdFromPath, injectPageMeta, ARTIFACT_MAX_TAGS, afterOnboardingPath, afterPendingCreatePath, parsePendingPath } from "@shared/path-artifacts";

describe("artifactFromStep", () => {
  it("uses the step's answer, and a build's summary, check and files — never file contents", () => {
    expect(artifactFromStep({ title: "Product statement", answer: "Plan a week of dinners." }, null))
      .toMatchObject({ title: "Product statement", body: "Plan a week of dinners.", summary: "Plan a week of dinners.", files: [] });
    const built = artifactFromStep({ title: "Landing page", answer: "ignored" }, {
      kind: "build", payload: { summary: "A landing page.", verify: "Open /.", files: [{ path: "src/landing.tsx", purpose: "the page", content: "SECRET" }, { path: "" }] },
    });
    expect(built.body).toBe("A landing page.\n\nHow it's verified: Open /.");
    expect(built.files).toEqual([{ path: "src/landing.tsx", purpose: "the page" }]);
    expect(JSON.stringify(built)).not.toContain("SECRET");
  });
  it("keeps a plan's sections", () => {
    const a = artifactFromStep({ title: "Pricing", answer: "" }, { kind: "plan", payload: { summary: "Two tiers.", sections: [{ heading: "Free", body: "Up to 3." }] } });
    expect(a.body).toBe("Two tiers.\n\n## Free\nUp to 3.");
    expect(a.summary).toBe("Two tiers. Up to 3.");
  });
});

describe("publishing", () => {
  it("needs a real title and at most a few clean tags", () => {
    expect(validatePublish({ title: "Hi" })).toMatchObject({ field: "title" });
    expect(validatePublish({ title: "  Our   pricing page ", tags: ["#Pricing", "Landing Page", "pricing", "x"] }))
      .toEqual({ title: "Our pricing page", tags: ["pricing", "landing-page"] });
    expect(validatePublish({ title: "Our pricing page", tags: Array.from({ length: ARTIFACT_MAX_TAGS + 1 }, (_, i) => `tag${i}`) })).toMatchObject({ field: "tags" });
    expect(normalizeTag("  B2B SaaS! ")).toBe("b2b-saas");
  });
  it("reads an artifact id only off an artifact's own path", () => {
    expect(artifactIdFromPath("/a/123e4567-e89b-12d3-a456-426614174000?utm_source=x")).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(artifactIdFromPath("/about")).toBeNull();
    expect(artifactIdFromPath("/a/short")).toBeNull();
    expect(artifactIdFromPath(null)).toBeNull();
  });
  it("puts an escaped title and preview tags in the head, replacing the old title", () => {
    const html = injectPageMeta("<html><head><title>Old</title></head><body></body></html>", { title: 'A "quoted" <step>', description: "What it did", url: "https://x.test/a/1" });
    expect(html).not.toContain("<title>Old</title>");
    expect(html).toContain("<title>A &quot;quoted&quot; &lt;step&gt;</title>");
    expect(html).toContain('<meta property="og:url" content="https://x.test/a/1" />');
    expect(html.indexOf("og:title")).toBeLessThan(html.indexOf("</head>"));
  });
});

describe("the page a crawler receives", () => {
  const html = `<!doctype html><html><head><title>SparkTower</title></head><body><div id="root"></div></body></html>`;
  const meta = {
    title: "Our product statement", description: "Weeknight dinners from what's in the fridge.", url: "https://sparktower.example/a/abc",
    article: {
      heading: "Our product statement",
      summary: "Weeknight dinners from what's in the fridge.",
      body: "## The problem\n\nPeople throw food away.\n\nSo we plan the week from what they already have.",
      projectTitle: "Weeknight Recipes", projectPath: "/projects/p1", publishedAt: "2026-09-15T10:00:00.000Z",
    },
  };

  it("carries the words of the page, not just its title, for anything that doesn't run JavaScript", () => {
    const out = injectPageMeta(html, meta);
    expect(out).toContain("<noscript>");
    expect(out).toContain("<h1>Our product statement</h1>");
    expect(out).toContain("<h3>The problem</h3>");
    expect(out).toContain("<p>People throw food away.</p>");
    // The backlink to the project the step belongs to.
    expect(out).toContain('<a href="/projects/p1">Weeknight Recipes</a>');
    expect(out).toContain('<time datetime="2026-09-15T10:00:00.000Z">2026-09-15</time>');
    // Still a working document: one title, the canonical, and the app's own root untouched.
    expect(out.match(/<title>/g)).toHaveLength(1);
    expect(out).toContain('<link rel="canonical" href="https://sparktower.example/a/abc" />');
    expect(out).toContain('<div id="root"></div>');
  });

  it("escapes the builder's text — it's user content, in a page", () => {
    const out = injectPageMeta(html, {
      ...meta,
      article: { ...meta.article, heading: '</noscript><script>alert(1)</script>', body: "<img src=x onerror=alert(1)>" },
    });
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;/noscript&gt;&lt;script&gt;");
  });

  it("leaves a page with no article exactly as it was, apart from its tags", () => {
    const out = injectPageMeta(html, { title: "SparkTower", description: "Build in public.", url: "https://sparktower.example/" });
    expect(out).not.toContain("<noscript>");
  });
});

describe("a stranger's choice on an artifact page, through signup", () => {
  const id = "0f8c2a4e-1111-4222-8333-444455556666";
  it("reads only a well-formed stored choice", () => {
    expect(parsePendingPath(JSON.stringify({ goal: "ship_mvp", fromArtifact: id, intent: "start" }))).toMatchObject({ goal: "ship_mvp", intent: "start" });
    for (const bad of [null, "", "not json", "null", "[]", JSON.stringify({ goal: 3, fromArtifact: id }), JSON.stringify({ goal: "ship_mvp" })]) {
      expect(parsePendingPath(bad), String(bad)).toBeNull();
    }
  });

  it("sends onboarding to that project to explore, straight into create on the goal to start, or to the intro with no choice", () => {
    expect(afterOnboardingPath({ goal: "ship_mvp", fromArtifact: id, intent: "explore", projectId: id })).toBe(`/projects/${id}`);
    expect(afterOnboardingPath({ goal: "ship_mvp", fromArtifact: id, intent: "start" })).toBe("/projects/new/create?step=setup");
    // Explore with no usable project id still starts their own.
    expect(afterOnboardingPath({ goal: "raise_capital", fromArtifact: id, intent: "explore", projectId: "../x" })).toBe("/projects/new/create?step=setup");
    expect(afterOnboardingPath(null)).toBe("/projects/new");
  });

  it("lands the project it made on its path, on the goal's section", () => {
    expect(afterPendingCreatePath(id, "ship_mvp")).toBe(`/projects/${id}/manage?section=ship_mvp`);
  });
});
