/**
 * Run steps, grouped into blocks.
 *
 * The fixture is the packet that prompted this, verbatim: three terminal
 * commands, a dev server, six console snippets that have to fire in order,
 * then "open the admin page; or call the API directly: `curl …`". What it
 * should become is four blocks and three breaks, each at a place where a
 * person genuinely has to stop.
 */
import { describe, it, expect } from "vitest";
import { flattenRunGroups, groupRunSteps, isLongRunning, sanitizeRunGroups, withRunGroups } from "@shared/phase-trees";

const EXPLORE = [
  "npm install",
  "npm run typecheck",
  "npm run dev",
  "In the web app, open DevTools Console and run: `import('/src/lib/analytics/explore').then(m => { m.markDiscoverOpened(); return m.trackExplore('open_discover',{source:'web',matchType:'mixed'}); }).then(()=>console.log('sent open_discover'))`",
  "Then run sequentially (adjust ids/rank): `import('/src/lib/analytics/explore').then(m => m.trackExplore('view_match_card',{source:'web',matchType:'builder',builderId:'test-builder',rankPosition:1}))`",
  "Then: `import('/src/lib/analytics/explore').then(m => m.trackExplore('open_profile',{source:'web',builderId:'test-builder'}))`",
  "Then: `import('/src/lib/analytics/explore').then(m => m.trackExplore('follow',{source:'web',builderId:'test-builder'}))`",
  "Then: `import('/src/lib/analytics/explore').then(m => m.trackExplore('return_to_discover',{source:'web'}))`",
  "Then: `import('/src/lib/analytics/explore').then(m => m.trackExplore('session_end',{source:'web'}))`",
  "Open the admin analytics page (existing route) and refresh; or call the API directly: `curl -s -b cookie.txt http://localhost:PORT/api/admin/analytics/summary?days=1 | jq '.explore'` (use an owner session cookie).",
];

describe("grouping an older packet's run steps", () => {
  const groups = groupRunSteps(EXPLORE);

  it("becomes four blocks, split where you have to stop", () => {
    expect(groups.map((g) => g.where)).toEqual(["terminal", "browser-console", "manual", "new-terminal"]);
  });

  it("puts the terminal commands in one block that ends with the server", () => {
    expect(groups[0].commands).toEqual(["npm install", "npm run typecheck", "npm run dev"]);
    expect(groups[0].longRunning).toBe(true);
    expect(groups[0].copy).toBe("npm install\nnpm run typecheck\nnpm run dev");
  });

  it("gathers the six console snippets, keeps the note, and wraps them so they run in order", () => {
    const console = groups[1];
    expect(console.before).toBe("Leave that running. Then, in the browser, open the app's DevTools console.");
    expect(console.label).toBe("In the web app, open DevTools Console");
    expect(console.note).toBe("adjust ids/rank");
    expect(console.commands).toHaveLength(6);
    expect(console.copy.startsWith("(async () => {\n  await import(")).toBe(true);
    expect(console.copy.endsWith("\n})();")).toBe(true);
    expect(console.copy.match(/^ {2}await /gm)).toHaveLength(6);
    // In the order written — the funnel depends on it.
    expect(console.copy.indexOf("open_discover")).toBeLessThan(console.copy.indexOf("session_end"));
  });

  it("keeps something to do as an instruction, not as code", () => {
    expect(groups[2]).toMatchObject({ where: "manual", label: "Open the admin analytics page (existing route) and refresh.", commands: [], copy: "" });
  });

  it("sends the API check to a new tab, because the first is busy with the server", () => {
    const check = groups[3];
    expect(check.before).toBe("Open a new terminal tab — leave the first one running.");
    expect(check.label).toBe("Or call the API directly");
    expect(check.commands).toEqual(["curl -s -b cookie.txt http://localhost:PORT/api/admin/analytics/summary?days=1 | jq '.explore'"]);
    expect(check.note).toBe("use an owner session cookie");
  });
});

describe("the details", () => {
  it("knows which commands keep running", () => {
    for (const yes of ["npm run dev", "npm start", "pnpm dev", "yarn dev", "npm run dev:client", "npx vite", "vite --port 3000", "next dev", "npx tsx watch server/index.ts", "docker compose up"]) {
      expect(isLongRunning(yes), yes).toBe(true);
    }
    for (const no of ["npm install", "npm run build", "npm run typecheck", "vite build", "npm run devtools", "docker compose up -d", "curl localhost:5001"]) {
      expect(isLongRunning(no), no).toBe(false);
    }
  });

  it("doesn't wrap console lines that aren't expressions", () => {
    const [group] = groupRunSteps(["In the browser console run: `const x = 1`", "Then: `console.log(x)`"]);
    expect(group.where).toBe("browser-console");
    expect(group.copy).toBe("const x = 1\nconsole.log(x)");
  });

  it("moves a trailing aside off a shell command, where it would be a syntax error", () => {
    const [group] = groupRunSteps(["npm run dev (keep it running)"]);
    expect(group.commands).toEqual(["npm run dev"]);
    expect(group.note).toBe("keep it running");
  });
});

describe("groups written by the model", () => {
  it("are held to the shape, and what gets copied is ours, not the model's", () => {
    const groups = sanitizeRunGroups([
      { where: "terminal", label: "Start", commands: ["`npm run dev`"], copy: "rm -rf /" },
      { where: "terminal", cwd: "../../etc", commands: ["ls"] },
      { where: "bogus", commands: ["echo hi"] },
      { where: "manual", note: "Open /discover" },
      { where: "terminal", commands: [] },
    ]);
    expect(groups).toHaveLength(4);
    expect(groups[0]).toMatchObject({ where: "terminal", commands: ["npm run dev"], longRunning: true, copy: "npm run dev" });
    // After a server, a terminal block is a new tab; a folder outside the repo is refused.
    expect(groups[1]).toMatchObject({ where: "new-terminal", cwd: undefined, copy: "ls" });
    expect(groups[2].where).toBe("new-terminal");
    expect(groups[3]).toMatchObject({ where: "manual", label: "Open /discover", copy: "" });
  });

  it("start with a cd when they run from a folder, and flatten back for older readers", () => {
    const groups = sanitizeRunGroups([{ where: "terminal", cwd: "client", commands: ["npm run build"] }]);
    expect(groups[0].copy).toBe("cd client\nnpm run build");
    expect(flattenRunGroups(groups)).toEqual(["cd client", "npm run build"]);
  });
});

describe("withRunGroups", () => {
  it("leaves anything that isn't a build alone", () => {
    const options = { kind: "options" as const, intro: "x", options: [] };
    expect(withRunGroups(options)).toBe(options);
  });

  it("groups a build that predates groups", () => {
    const payload = withRunGroups({ kind: "build", summary: "", files: [], verify: "", assumptions: [], runSteps: ["npm install", "npm run dev"] });
    expect(payload.kind === "build" && payload.runGroups?.[0].commands).toEqual(["npm install", "npm run dev"]);
  });
});
