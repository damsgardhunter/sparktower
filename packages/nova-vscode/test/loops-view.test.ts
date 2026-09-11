/**
 * The Loops view: its own place, and a way to build.
 *
 * Two things this pins down. The first is placement — between the next step
 * and the path, visible whatever step the path is on. Loops once vanished the
 * moment the core-loop milestone was done, and the fixture here is that exact
 * situation: a project parked on "Empty, loading, error states" with its loops
 * behind it.
 *
 * The second is cost. Opening a step must never spend anything; building one
 * is an explicit press that makes exactly one request, and its packet lands in
 * the Next step panel with a way back. A click on a tree row is something
 * people do to look.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  registeredCommands, treeProviders, fakeContext, settings, messages, setNextChoice,
  webviewProviders, fakeWebviewView, env,
} from "./vscode-stub.js";
import { activate } from "../src/extension.js";

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"));

const LOOPS = [
  {
    taskId: "L1", title: "Explore: discover builders/projects and follow up",
    description: "Open Discover/feed → view matched builders/projects → follow/message/connect → return",
    status: "todo", state: "written", steps: [], done: 0, total: 0,
  },
  {
    taskId: "L2", title: "Build: publish a project progress post and get feedback",
    description: "Create a progress post → publish → get feedback", status: "done", state: "built",
    steps: [{ taskId: "S1", title: "Post form", description: "", status: "done", actor: "nova-builds" }], done: 1, total: 1,
  },
  {
    taskId: "L3", title: "Match: find a co-builder", description: "Search → view profile → connect",
    status: "todo", state: "building", done: 1, total: 2,
    steps: [
      { taskId: "S2", title: "Search results page", description: "List matched builders with filters.", status: "todo", actor: "nova-builds" },
      { taskId: "S3", title: "Profile card", description: "", status: "done", actor: "nova-builds" },
    ],
  },
];

const PACKET = {
  id: "w2", kind: "build", actor: "nova-builds", reused: false,
  payload: {
    kind: "build", model: "gpt-5.3-codex", summary: "Adds the search results page with filters.",
    files: [{ path: "client/src/pages/search.tsx", language: "tsx", content: "export default function Search() { return null; }\n", purpose: "the page" }],
    runSteps: ["npm run dev"], verify: "searching shows matched builders", assumptions: [],
    runGroups: [
      { where: "terminal", label: "In a terminal", commands: ["npm install", "npm run dev"], longRunning: true, copy: "npm install\nnpm run dev" },
      {
        where: "browser-console", label: "In the browser's DevTools console", commands: ["fetch('/api/track')"],
        before: "Leave that running. Then, in the browser, open the app's DevTools console.", copy: "fetch('/api/track')",
      },
    ],
  },
};

const routes: Record<string, unknown> = {
  "GET /api/mcp/manifest": {
    version: 1, instructions: "", tools: [], limits: { maxFiles: 10, maxFileBytes: 10, maxTotalBytes: 10 },
    account: { userId: "u1", email: "casey@example.test" }, pinnedProjectId: null,
  },
  "GET /api/mcp/projects/p1/status": {
    adopted: true, goal: "ship_mvp", promise: "Ship it",
    phase: { id: "week-3", title: "Week 3 — Usable by someone else", step: 1, of: 7, optional: false },
    phases: [
      { id: "week-1", title: "Week 1", done: 8, total: 8, optional: false },
      { id: "week-3", title: "Week 3 — Usable by someone else", done: 0, total: 7, optional: false },
    ],
    progress: { done: 14, total: 28 },
    next: {
      backboneId: "SHIP.M3.1", title: "Empty, loading, error states", description: "Every screen handles nothing, waiting and failure.",
      actor: "nova-builds", tier: "verified", estimateMinutes: 120, workTaskId: "t31", step: null, work: null, loops: [],
    },
  },
  "GET /api/mcp/projects/p1/work/t31": { work: null, actor: "nova-builds", tier: "verified", task: { id: "t31", title: "x", status: "todo" } },
  "GET /api/mcp/projects/p1/work/S2": { work: null, actor: "nova-builds", tier: "verified", task: { id: "S2", title: "Search results page", status: "todo" } },
  "GET /api/mcp/projects/p1/loops": {
    adopted: true, supported: true, sourceId: "SHIP.M1.2", fanOutId: "SHIP.M2.1", loops: LOOPS, rejected: [], remaining: 3,
  },
  "POST /api/mcp/projects/p1/work": PACKET,
};

/** Every request the extension made, so "free" and "exactly once" can be asserted rather than hoped. */
const calls: { method: string; path: string; body: any }[] = [];
let realFetch: typeof fetch;

beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = new URL(String(input)).pathname;
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
    const body = routes[`${method} ${path}`];
    return new Response(JSON.stringify(body ?? { message: `no route for ${method} ${path}` }), {
      status: body ? 200 : 404, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  settings.set("nova.projectId", "p1");
  const context = fakeContext();
  await context.secrets.store("nova.token", "nova_pat_test");
  activate(context as never);
});

afterAll(() => { globalThis.fetch = realFetch; });

const loopsView = () => treeProviders.get("nova.loops")!;
const pathView = () => treeProviders.get("nova.path")!;
const panel = () => {
  const view = fakeWebviewView();
  webviewProviders.get("nova.next")!.resolveWebviewView(view);
  return view;
};
const stepNode = async (taskId: string) => {
  for (const loop of await loopsView().getChildren()) {
    const step = (await loopsView().getChildren(loop)).find((n: any) => n.step?.taskId === taskId);
    if (step) return step;
  }
  throw new Error(`no step ${taskId}`);
};

describe("the Loops view", () => {
  it("sits between the next step and the path", () => {
    expect(manifest.contributes.views.nova.map((v: { id: string }) => v.id)).toEqual(["nova.next", "nova.loops", "nova.path"]);
  });

  it("shows every loop when the next step has nothing to do with loops — and the path is only phases", async () => {
    await registeredCommands.get("nova.refresh")!();

    const loops = await loopsView().getChildren();
    expect(loops.map((n: any) => n.loop.title)).toEqual(LOOPS.map((l) => l.title));

    const roots = await pathView().getChildren();
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.every((n: any) => n.kind === "phase")).toBe(true);
  });

  it("says how far each loop has got, and offers building only on steps that aren't done", async () => {
    const [explore, built, match] = await loopsView().getChildren();

    expect(loopsView().getTreeItem(explore).description).toBe("Steps ready");
    expect(loopsView().getTreeItem(built).description).toBe("Built · 1/1");
    expect(loopsView().getTreeItem(match).description).toBe("Building · 1/2");

    expect(loopsView().getTreeItem(explore).contextValue).toBe("novaLoop.unexpanded");
    expect(loopsView().getTreeItem(match).contextValue).toBe("novaLoop.expanded");

    const [search, profile] = await loopsView().getChildren(match);
    expect(loopsView().getTreeItem(search).contextValue).toBe("novaLoopStep.open");
    expect(loopsView().getTreeItem(profile).contextValue).toBe("novaLoopStep.done");
    // Clicking a row opens it; it never builds.
    expect(loopsView().getTreeItem(search).command.command).toBe("nova.openStep");
  });

  it("opens a step for free", async () => {
    const view = panel();
    calls.length = 0;

    await registeredCommands.get("nova.openStep")!(await stepNode("S2"));

    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(view.webview.html).toContain("Search results page");
    expect(view.webview.html).toContain("Match: find a co-builder");
    expect(view.webview.html).toContain("Build it with Nova");
    expect(view.webview.html).toContain("Back to the next step");
    expect(view.webview.html).not.toContain("Empty, loading, error states");
  });

  it("builds a step with exactly one request, and shows the packet and who wrote it", async () => {
    const view = panel();
    calls.length = 0;

    await registeredCommands.get("nova.buildStep")!(await stepNode("S2"));

    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe("/api/mcp/projects/p1/work");
    expect(posts[0].body.taskId).toBe("S2");

    expect(view.webview.html).toContain("Adds the search results page with filters.");
    expect(view.webview.html).toContain("Written by gpt-5.3-codex");
    expect(view.webview.html).toContain("Preview and apply");
  });

  it("shows run steps as blocks to copy, with a break where you have to switch", async () => {
    const html = panel().webview.html;
    expect(html).toContain("npm install\nnpm run dev");
    expect(html).toContain("Leave that running.");
    expect(html).toContain("Type into a terminal");

    await registeredCommands.get("nova.copyRun")!(1);
    // The server's clipboard text, exactly — not a copy of what the page happens to show.
    expect(env.clipboard.text).toBe("fetch('/api/track')");
  });

  it("goes back to the path's next step", async () => {
    const view = panel();
    await registeredCommands.get("nova.unfocus")!();

    expect(view.webview.html).toContain("Empty, loading, error states");
    expect(view.webview.html).not.toContain("Back to the next step");
  });

  it("takes 'Not a loop' from a right-click, which hands over the node rather than an id", async () => {
    messages.length = 0;
    setNextChoice(undefined); // decline — nothing is removed
    const [explore] = await loopsView().getChildren();

    await registeredCommands.get("nova.dropLoop")!(explore);

    expect(messages.some((m) => m.kind === "warning" && m.text.includes("Explore: discover builders/projects and follow up"))).toBe(true);
  });
});

describe("asking for a new packet", () => {
  const SAVED = { work: { id: "w1", kind: "build", payload: PACKET.payload }, actor: "nova-builds", tier: "verified", task: { id: "S2", title: "Search results page", status: "todo" } };

  it("puts 'Have Nova redo it' under a packet", async () => {
    const view = panel();
    await registeredCommands.get("nova.buildStep")!(await stepNode("S2"));
    expect(view.webview.html).toContain("Have Nova redo it");
  });

  it("shows the saved packet and spends nothing when you decline", async () => {
    await registeredCommands.get("nova.refresh")!();
    routes["GET /api/mcp/projects/p1/work/S2"] = SAVED;
    const view = panel();
    calls.length = 0;
    setNextChoice(undefined);

    await registeredCommands.get("nova.buildStep")!(await stepNode("S2"));

    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    expect(messages.some((m) => m.text.includes('Nova already built "Search results page"'))).toBe(true);
    expect(view.webview.html).toContain("Adds the search results page with filters.");
  });

  it("makes exactly one fresh request when you choose to build it again", async () => {
    routes["GET /api/mcp/projects/p1/work/S2"] = SAVED;
    calls.length = 0;
    setNextChoice("Build it again");

    await registeredCommands.get("nova.buildStep")!(await stepNode("S2"));

    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    // Fresh, so the server makes a new packet instead of handing back the saved one.
    expect(posts[0].body).toEqual({ taskId: "S2", fresh: true });
    setNextChoice(undefined);
  });
});

describe("the edges", () => {
  it("offers to add the first loop rather than showing nothing", () => {
    loopsView().setLoops({ adopted: true, supported: true, loops: [] });
    expect(loopsView().getChildren()).toEqual([{ kind: "message", text: "None yet — add one", command: "nova.addLoop" }]);
  });

  it("says so on a path that doesn't work in loops", () => {
    loopsView().setLoops({ adopted: true, supported: false, loops: [], message: "This path doesn't work in loops." });
    expect(loopsView().getChildren()).toEqual([{ kind: "message", text: "This path doesn't work in loops." }]);
  });
});
