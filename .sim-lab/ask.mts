import { writeFileSync, existsSync } from "node:fs";
import { buildMarketPrompt, parseMarket } from "../server/nova-market";
import { getOpenAI } from "../server/openai-client";
const PROJECTS: Record<string, any> = {
  tallyhold: { title: "Tallyhold", category: "saas", goal: "ship_mvp",
    description: "A stocktake app for independent bottle shops. Walk the shelves with your phone, reconcile against the till export. Me, a half-built iOS app, three shops in Leeds on a spreadsheet I fill in by hand on Sundays, £9,000 of savings. Two of three say they'd pay. No idea what to charge." },
  kilnshare: { title: "Kilnshare", category: "marketplace", goal: "first_customers",
    description: "A booking site for pottery studios to rent out spare kiln firings to hobbyists who have nowhere to fire their work. Studios list a firing, people book a shelf. I take a cut. Eleven studios signed up around Bristol, about forty firings booked so far, no app — it's a form and a WhatsApp group. I do the matching myself every Tuesday night." },
  rotaread: { title: "Rotaread", category: "saas", goal: "grow_revenue",
    description: "Shift swapping for hospital bank staff. Nurses post shifts they can't do, others pick them up, and it writes back to the trust's rostering system. Two NHS trusts paying £1,400 a month each, eight months in, one developer who is me and a contractor two days a week. Procurement takes nine months and every trust wants something different." },
};
const which = process.argv[2];
const OUT = `.sim-lab/${which}.json`; const RAW = `.sim-lab/${which}.raw.txt`;
if (existsSync(OUT)) { console.log(`${which}: already asked`); process.exit(0); }
const project = PROJECTS[which];
const prompt = buildMarketPrompt({ project, progress: null, startup: true });
const completion = await getOpenAI().chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
});
const raw = completion.choices[0]?.message?.content ?? "";
writeFileSync(RAW, raw);
const niche = parseMarket(raw, which);
if (!niche) { console.log(`${which}: parseMarket REFUSED the answer`); process.exit(1); }
writeFileSync(OUT, JSON.stringify(niche));
const total = niche.segments.reduce((s: number, x: any) => s + x.size, 0);
const worth = niche.segments.reduce((s: number, x: any) => s + x.size * x.referencePrice, 0);
console.log(`${which}: "${niche.name}" · ${total.toLocaleString()} customers · $${worth.toLocaleString()}/yr · ${niche.segments.length} segments · ${niche.cities.length} regions`);
console.log(`  prices ${niche.segments.map((s: any) => "$" + s.referencePrice).join("/")} · entry ${niche.cities.map((c: any) => "$" + Math.round(c.entryCost)).join("/")} · rivals ${niche.incumbents.map((i: any) => Math.round(i.startingShare * 100) + "%").join("/")}`);
