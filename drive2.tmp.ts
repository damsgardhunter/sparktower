import { chromium } from "playwright";
import { db } from "./server/db";
const BASE = "http://localhost:5055";
const SHOT = "/private/tmp/claude-501/-Users-hunterdamsgard-Downloads-project/eb1b83af-e56c-4e9e-8bad-42a87b893087/scratchpad";
const ROLES = ["ceo","cmo","cfo","cto","coo"];

async function main(){
  const { startReadySeasons, tickSeason } = await import("./server/simulation-tick");
  const { simSeasons, simVentures } = await import("@shared/schema");
  const { eq, inArray } = await import("drizzle-orm");

  // Clear open rooms so our five get their own.
  await db.update(simVentures).set({ phase: "retired" }).where(inArray(simVentures.phase, ["filling","claiming","naming"]));

  const browser = await chromium.launch();
  const pages = [];
  const stamp = Date.now();
  for (let i=0;i<5;i++){ const c = await browser.newContext({ viewport:{width:1280,height:1600} }); pages.push(await c.newPage()); }
  for (let i=0;i<5;i++){
    const r = await pages[i].request.post(`${BASE}/api/auth/register`, {
      headers: { "x-forwarded-for": `203.0.113.${(stamp + i) % 200 + 20}` },
      data:{ email:`dv${stamp}_${i}@example.test`, password:"a-good-passphrase-here", firstName:`P${i}` }});
    if (r.status()!==201){ console.log("register", r.status(), (await r.text()).slice(0,150)); return; }
  }
  let vid = "";
  for (let i=0;i<5;i++){ const b = await (await pages[i].request.post(`${BASE}/api/sim/join`, { data:{nicheId:"fitness_app"} })).json(); vid = b.ventureId; }
  for (let i=0;i<5;i++) await pages[i].request.post(`${BASE}/api/sim/ventures/${vid}/claim`, { data:{role:ROLES[i]} });
  await pages[0].request.post(`${BASE}/api/sim/ventures/${vid}/name`, { data:{name:"Northbound", product:"Training app"} });

  const started = await startReadySeasons();
  console.log("seasons started:", started.length);
  const [v] = await db.select().from(simVentures).where(eq(simVentures.id, vid));

  // Resolve year 1 so the screen has a "last year" to show.
  await db.update(simSeasons).set({ nextTickAt: new Date(Date.now()-1000), startsAt: new Date(Date.now()-60000) }).where(eq(simSeasons.id, v.seasonId));
  console.log("ticked year:", await tickSeason(v.seasonId));

  const cmo = pages[1];
  cmo.on("console", (m) => { if (m.type()==="error") console.log("CONSOLE ERR:", m.text().slice(0,200)); });
  cmo.on("pageerror", (e) => console.log("PAGE ERR:", String(e).slice(0,300)));
  cmo.on("response", (r) => { if (r.url().includes("/api/sim") ) console.log("API", r.status(), r.url().replace(BASE,"")); });
  await cmo.goto(`${BASE}/simulation/${vid}`, { waitUntil:"domcontentloaded" });
  await cmo.waitForTimeout(3000);
  console.log("BODY:", (await cmo.locator("body").innerText()).slice(0,400).replace(/\n+/g," | "));
  await cmo.waitForSelector('[data-testid="text-company-name"]', { timeout: 120000 });
  await cmo.waitForTimeout(1200);
  console.log("company:", await cmo.locator('[data-testid="text-company-name"]').textContent());
  console.log("commitment:", await cmo.locator('[data-testid="text-commitment"]').textContent().catch(()=>"(none)"));
  console.log("lastYear heading present:", await cmo.locator("text=/^Year 1$/").count());

  await cmo.locator('[data-testid="input-brandSpend"]').fill("4000000");
  await cmo.waitForTimeout(500);
  console.log("commitment after typing 4m:", await cmo.locator('[data-testid="text-commitment"]').textContent());
  await cmo.screenshot({ path:`${SHOT}/desk-web.png`, fullPage:true });

  await cmo.locator('[data-testid="button-file-decision"]').click();
  await cmo.waitForTimeout(2000);
  console.log("filed badge count:", await cmo.locator('[data-testid="badge-filed"]').count());

  const coo = pages[4];
  await coo.goto(`${BASE}/simulation/${vid}`, { waitUntil:"domcontentloaded" });
  await coo.waitForSelector('[data-testid="text-commitment"]', { timeout: 120000 });
  await coo.waitForTimeout(800);
  console.log("COO sees commitment:", await coo.locator('[data-testid="text-commitment"]').textContent());
  console.log("COO warnings:", (await coo.locator('[data-testid="text-warning"]').allTextContents()).map(s=>s.slice(0,70)));

  // Mobile width.
  await cmo.setViewportSize({ width: 390, height: 900 });
  await cmo.waitForTimeout(600);
  const scrollW = await cmo.evaluate(() => document.documentElement.scrollWidth);
  console.log("mobile scrollWidth (want <=390):", scrollW);
  await cmo.screenshot({ path:`${SHOT}/desk-mobile.png`, fullPage:true });

  await browser.close();
  process.exit(0);
}
main().catch(e=>{console.error(e); process.exit(1);});
