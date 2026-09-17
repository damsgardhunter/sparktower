/**
 * Two gaps that only show up by reading the clients: a published page nobody
 * can take down, and an admin page nothing links to. Both are invisible to the
 * server tests, because the server has the route either way.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const webPublish = read("client/src/components/continue-path-card.tsx");
const mobilePublish = read("mobile/src/components/manage/path/ShareSheets.tsx");
const app = read("client/src/App.tsx");
const sidebar = read("client/src/components/app-sidebar.tsx");
const safety = read("client/src/pages/admin-safety.tsx");

describe("taking a published artifact down", () => {
  it("offers it on both clients, wherever the published page is shown", () => {
    for (const [name, src] of [["web", webPublish], ["mobile", mobilePublish]] as const) {
      expect(src, `${name} never calls the unpublish route`).toContain("/unpublish");
      expect(src, `${name} publishes but the take-down control is missing`).toContain("button-unpublish-artifact");
    }
  });

  it("asks first, and says what taking it down does", () => {
    for (const [name, src] of [["web", webPublish], ["mobile", mobilePublish]] as const) {
      expect(src, `${name} takes the page down without confirming`).toContain("Take this page down?");
      expect(src, `${name} doesn't say the link stops working`).toContain("stops being reachable");
    }
  });

  it("reopens on the published page, so a page that went out earlier can still come down", () => {
    for (const [name, src] of [["web", webPublish], ["mobile", mobilePublish]] as const) {
      expect(src, `${name} only knows a page is live in the session that published it`).toContain('visibility === "public"');
    }
  });
});

describe("admin pages", () => {
  const routes = [...app.matchAll(/path="(\/admin\/[a-z]+)"/g)].map((m) => m[1]);

  it("are reachable without typing the URL", () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const linked = sidebar.includes(`href="${route}"`) || safety.includes(`href="${route}"`);
      expect(linked, `${route} is routed but nothing links to it`).toBe(true);
    }
  });

  it("keeps the promotions console behind the admin role the endpoint enforces", () => {
    for (const [name, src] of [["sidebar", sidebar], ["safety page", safety]] as const) {
      const link = src.slice(0, src.indexOf('href="/admin/promotions"'));
      expect(link, `${name} shows Featured tools to reviewers`).toContain('platformRole === "admin"');
    }
  });
});
