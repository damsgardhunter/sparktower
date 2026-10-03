import { writeFileSync, existsSync } from "node:fs";
import { buildMarketPrompt, parseMarket } from "../server/nova-market";
import { getOpenAI } from "../server/openai-client";
const PROJECTS: Record<string, any> = {
  hedgerow: { title: "Hedgerow", category: "marketplace", goal: "first_customers",
    description: "A pickup service for allotment gluts. People with too many courgettes list them, neighbours collect for a couple of quid, I take 20p. Forty growers on one allotment site in Sheffield, a Google Form and a WhatsApp group. No money in it yet. I do the routing myself on a Sunday." },
  pressfit: { title: "Pressfit", category: "hardware", goal: "ship_mvp",
    description: "A replacement bearing press for small bike workshops. CNC'd in a friend's unit in Bradford. Six prototypes out with mechanics, two want to buy. £14,000 of my own money in tooling, no distributor, no CE mark yet." },
  quorumcast: { title: "Quorumcast", category: "saas", goal: "grow_revenue",
    description: "Minute-taking and motion tracking for parish and town councils. Clerks record the meeting, it drafts minutes and tracks which motions carried. Thirty-one councils paying £40 a month, two years in, me and a part-time support person. Every council procures differently and clerks change job constantly." },
  saltbox: { title: "Saltbox", category: "consumer", goal: "grow_revenue",
    description: "An app for sea swimmers: water quality, tide, temperature and who else is going. 60,000 monthly users across the UK and Ireland, mostly free, 2,400 paying £3 a month for forecasts. Three of us. Sewage data is the hook and it is getting us press." },
  ledgerloom: { title: "Ledgerloom", category: "fintech", goal: "raise_money",
    description: "Reconciliation for textile mills that still run on paper dockets. Photograph the docket, it matches to the PO and the invoice. Four mills in Lancashire and one in Portugal, £90k of annual contracts, five people. Mills are consolidating and the big ERPs do not cover this." },
};
const which = process.argv[2];
const OUT = `.sim-lab/${which}.json`;
if (existsSync(OUT)) { console.log(`${which}: already asked`); process.exit(0); }
const prompt = buildMarketPrompt({ project: PROJECTS[which], progress: null, startup: true });
const completion = await getOpenAI().chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
});
const raw = completion.choices[0]?.message?.content ?? "";
const niche = parseMarket(raw, which);
if (!niche) { console.log(`${which}: parseMarket REFUSED the answer`); process.exit(1); }
writeFileSync(OUT, JSON.stringify(niche));
const total = niche.segments.reduce((s: number, x: any) => s + x.size, 0);
const worth = niche.segments.reduce((s: number, x: any) => s + x.size * x.referencePrice, 0);
console.log(`${which}: "${niche.name}" · ${total.toLocaleString()} customers · ${worth.toLocaleString()}/yr · ${niche.segments.length} seg · ${niche.cities.length} regions · openShare ${(niche as any).openShare?.toFixed(3)}`);
