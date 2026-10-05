/**
 * Make one advert for a project, from a terminal.
 *
 * What it is for: watching the whole pipeline run against a real project
 * without a browser, and — with AI_STUB=1 — without spending anything at all.
 * Stubbed, the script writer answers locally and the video model returns a
 * stub task that `fetchPlate` turns into a generated test pattern, so every
 * step after generation is the real one: the cutting, the lettering, the logo,
 * the concat and the upload.
 *
 *   AI_STUB=1 NODE_ENV=development npx tsx --env-file=.env \
 *     script/render-one-ad.ts <projectId> [seconds] [format] [style]
 *
 * Without AI_STUB it uses the real video model and bills the real account, so
 * it asks before it does. The wallet is charged either way — that is the point
 * of running the real path — and refunded in full if the render fails.
 */
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { projects } from "@shared/schema";
import { startRender, advanceRender, quoteRender } from "../server/ad-render";
import { walletOf } from "../server/wallet";
import { brandKitFor } from "../server/ad-brand-routes";
import { brandCompleteness } from "@shared/ad-brand";
import { isAdDuration, type AdDuration } from "@shared/ads";
import { aiStubbed } from "../server/ai-stub";

const [, , projectId, secondsArg = "15", format = "vertical", style = "problem_solution"] = process.argv;

async function main() {
  if (!projectId) {
    console.error("usage: render-one-ad.ts <projectId> [seconds] [format] [style]");
    process.exit(1);
  }
  const seconds = Number(secondsArg);
  if (!isAdDuration(seconds)) { console.error(`seconds must be 6, 15 or 30 — got ${secondsArg}`); process.exit(1); }

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) { console.error(`no project ${projectId}`); process.exit(1); }

  const kit = await brandKitFor(projectId);
  const filled = brandCompleteness(kit);
  console.log(`project:  ${project.title}`);
  console.log(`brand:    ${filled.done}/${filled.of} filled${filled.missing.length ? ` — missing ${filled.missing.join(", ")}` : ""}`);
  if (!kit) {
    /* The thing that made the first adverts brandless. Worth saying out loud. */
    console.log(`          no brand kit, so this advert will use fallback colours and no logo.`);
  }

  const quote = quoteRender(seconds as AdDuration);
  console.log(`\nquote:    $${(quote.priceCents / 100).toFixed(2)} for ${seconds}s — ${quote.plates.length} clips, ${quote.generatedSeconds}s generated`);
  console.log(`          expected provider cost $${(quote.expectedProviderCents / 100).toFixed(2)}`);
  console.log(`mode:     ${aiStubbed() ? "AI_STUB — nothing is sent to the video model" : "LIVE — this bills the real video model"}`);

  if (!aiStubbed()) {
    console.log(`\nThis will spend real generation units. Ctrl-C within five seconds to stop.`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  const before = (await walletOf(project.ownerId)).balanceCents;
  const started = await startRender(project.ownerId, projectId, {
    duration: seconds, format, style, brief: project.description ?? "",
  }, { productPhotos: !!kit?.logoPath, founderLine: !!kit?.tagline });

  if (!started.ok) { console.error(`\nrefused (${started.refusal.field}): ${started.refusal.message}`); process.exit(1); }
  console.log(`\nrender ${started.render.id} — charged $${(started.render.chargedCents / 100).toFixed(2)}, balance $${((await walletOf(project.ownerId)).balanceCents / 100).toFixed(2)}`);

  let row = started.render;
  const t0 = Date.now();
  for (let step = 0; step < 200 && row.status !== "ready" && row.status !== "failed"; step++) {
    row = await advanceRender(row.id);
    const plates = (row.plates as any[]) ?? [];
    console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${row.status}  clips ${plates.filter((p) => p?.status === "succeeded").length}/${plates.length}`);
    if (row.status === "generating") await new Promise((r) => setTimeout(r, aiStubbed() ? 500 : 5000));
  }

  console.log(`\n${row.status}`);
  if (row.failure) console.log(`  ${row.failure}`);
  if (row.outputPath) {
    console.log(`  file:     ${row.outputPath}`);
    console.log(`  cost:     $${(row.providerCents / 100).toFixed(2)} to make, $${(row.chargedCents / 100).toFixed(2)} charged`);
  }
  const after = (await walletOf(project.ownerId)).balanceCents;
  console.log(`  balance:  $${(before / 100).toFixed(2)} → $${(after / 100).toFixed(2)}${row.refundedCents ? ` (refunded $${(row.refundedCents / 100).toFixed(2)})` : ""}`);
  process.exit(row.status === "ready" ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
