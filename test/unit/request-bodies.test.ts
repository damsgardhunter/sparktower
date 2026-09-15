/**
 * No server file spreads a request body into a write or hands one to storage
 * whole — the same check the codebase audit runs — and the picker keeps only
 * the keys it's given.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { scanSecurity } from "@shared/security-checks";
import { pickFields } from "../../server/body-fields";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : [];
});

describe("request bodies", () => {
  it("never reach a write unpicked", () => {
    const files = ["server", "shared"].flatMap(walk).map((path) => ({ path, content: readFileSync(path, "utf8") }));
    const check = scanSecurity(files).checks.find((c) => c.id === "mass-assignment")!;
    expect(check.evidence).toEqual([]);
    expect(check.status).toBe("pass");
  });

  it("the audit flags each way of doing it", () => {
    for (const line of [
      "await storage.createThing({ ...req.body, ownerId });",
      "Object.assign(row, req.body);",
      "await db.update(things).set(req.body);",
      "await storage.updateThing(req.params.id, req.body);",
    ]) {
      const r = scanSecurity([{ path: "server/routes.ts", content: `import express from "express";\n${line}` }]);
      expect(r.checks.find((c) => c.id === "mass-assignment")!.status, line).toBe("partial");
    }
  });

  it("pickFields keeps only the listed keys that were sent", () => {
    expect(pickFields({ name: "a", role: "owner", projectId: "x", price: 0 }, ["name", "price", "notes"] as const)).toEqual({ name: "a", price: 0 });
    expect(pickFields(null, ["name"] as const)).toEqual({});
    expect(pickFields(["name"], ["0"] as const)).toEqual({});
    const picked = pickFields(JSON.parse('{"__proto__": {"polluted": true}, "name": "b"}'), ["name", "__proto__"] as const);
    expect(picked).toEqual({ name: "b" });
    expect((picked as any).polluted).toBeUndefined();
    expect(({} as any).polluted).toBeUndefined();
  });
});
