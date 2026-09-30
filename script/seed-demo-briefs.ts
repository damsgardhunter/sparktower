/**
 * Has Nova write each demo project's brief — the five cards on the overview.
 *
 * The overview draws problem, target user, value proposition, customer profile
 * and success metrics, and a project with none of them is a one-liner over
 * empty space. Nova writes them rather than a human doing it here, which is
 * both the point of the product and the reason they read like the rest of the
 * site: the same model, the same prompt and the same `update_project`
 * operations a real owner's Nova would produce.
 *
 * It goes through `novaSuggest` — the function behind
 * `/api/projects/:id/nova/suggest` — and applies what comes back with
 * `applyProjectOperations`, exactly as the apply route does. What it does not
 * go through is the route itself: that is where the sign-in lives, and these
 * owners are bot accounts that cannot sign in at all.
 *
 *   DATABASE_URL=… npx tsx script/seed-demo-briefs.ts               # who needs one
 *   DATABASE_URL=… npx tsx script/seed-demo-briefs.ts --apply
 *   DATABASE_URL=… npx tsx script/seed-demo-briefs.ts --apply --limit 1
 */
import { pathToFileURL } from "node:url";
import { eq, like, isNull, or } from "drizzle-orm";
import { db } from "../server/db";
import { users, projects } from "@shared/schema";

const apply = process.argv.includes("--apply");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

/** What is being asked for, in the words an owner would use. */
const ASK =
  "Write the brief for this project: the problem it solves, who it is for, " +
  "the value proposition, the customer profile, and the success metrics that " +
  "would show it is working. Ground every one of them in what this project " +
  "actually is and who its owner is — no generic startup language, no filler. " +
  "Use update_project to set problemStatement, targetUser, valueProposition, " +
  "targetCustomerProfile and successMetrics.";

/**
 * A response object that keeps what was written instead of sending it.
 *
 * `novaSuggest` answers an HTTP request, and there is no request here. This is
 * the smallest thing it will accept that lets the payload be read back.
 */
function capture() {
  const out: { status: number; body: any } = { status: 200, body: null };
  const res: any = {
    status(code: number) { out.status = code; return res; },
    json(body: any) { out.body = body; return res; },
  };
  return { res, out };
}

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL.");

  const rows = await db.select({
    id: projects.id, title: projects.title, ownerId: projects.ownerId, owner: users.firstName,
    problem: projects.problemStatement, metrics: projects.successMetrics,
  }).from(projects).innerJoin(users, eq(users.id, projects.ownerId))
    .where(like(users.email, "%@demo.sparktower.invalid"))
    .orderBy(projects.createdAt);

  const todo = rows.filter((r) => !r.problem || !r.metrics);
  console.log(`demo projects: ${rows.length}`);
  console.log(`already brief: ${rows.length - todo.length}`);
  console.log(`to write:      ${Math.min(todo.length, LIMIT)}`);

  if (!apply) {
    for (const r of todo.slice(0, LIMIT)) console.log(`  ${r.owner} — ${r.title}`);
    console.log("\nreport only — rerun with --apply. One model call each.");
    return 0;
  }

  const { novaSuggest, validateNovaAsk } = await import("../server/nova-assist-routes");
  const { applyProjectOperations } = await import("../server/project-operations");
  const { getUserEntitlements } = await import("../server/entitlements");

  let done = 0, failed = 0;
  for (const r of todo.slice(0, LIMIT)) {
    const started = Date.now();
    process.stdout.write(`  ${r.owner} — ${r.title} … `);
    try {
      const ent = await getUserEntitlements(r.ownerId);
      const input = { surface: "strategy", ask: ASK };
      const { res: vRes } = capture();
      const config = validateNovaAsk(input, vRes as any);
      if (!config) throw new Error("the ask was refused before it reached Nova");

      const { res, out } = capture();
      await novaSuggest(r.id, r.ownerId, input, ent, config, res as any);
      if (out.status >= 400) throw new Error(`Nova answered ${out.status}: ${out.body?.message ?? ""}`);

      const operations = (out.body?.operations ?? []).filter((o: any) => o?.op === "update_project");
      if (!operations.length) throw new Error("Nova suggested nothing that writes the brief");

      await applyProjectOperations(r.id, r.ownerId, operations, { max: 20 } as any);
      done += 1;
      console.log(`${operations.length} update(s) in ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (err) {
      failed += 1;
      console.log(`FAILED: ${(err as Error)?.message?.slice(0, 140)}`);
    }
  }

  console.log(`\n${done} written, ${failed} failed.`);
  return failed ? 1 : 0;
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => { console.error(err); process.exit(1); },
  );
}
