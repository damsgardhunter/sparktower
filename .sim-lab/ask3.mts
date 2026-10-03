import { writeFileSync, existsSync } from "node:fs";
import { buildMarketPrompt, parseMarket } from "../server/nova-market";
import { getOpenAI } from "../server/openai-client";
const P: Record<string, any> = {
  cairnwait: { title: "Cairnwait", category: "marketplace", goal: "first_customers",
    description: "Booking system for bothies and mountain huts in the Highlands. Wardens list beds, walkers book them, no more turning up to a full hut. Nineteen huts signed up, a spreadsheet and a phone number. I take no cut yet. Season is four months long and it rains." },
  loomlight: { title: "Loomlight", category: "hardware", goal: "ship_mvp",
    description: "A daylight lamp for hand-weavers that matches the colour temperature of a north-facing window. Eight units built on my kitchen table, three sold at a craft fair for GBP 180. No supplier, no certification, GBP 6,000 in." },
  parishpay: { title: "Parishpay", category: "fintech", goal: "grow_revenue",
    description: "Contactless giving terminals for rural churches. GBP 29 a month plus transaction fees. 140 churches live, mostly Church of England, two of us plus a retired vicar who does the calls. Dioceses buy in blocks or not at all." },
  scrapline: { title: "Scrapline", category: "saas", goal: "raise_money",
    description: "Routing and weighbridge software for independent scrap metal yards. Four yards paying GBP 600 a month in the West Midlands, three years, six staff. The trade is consolidating fast and the incumbents are DOS-era." },
  tideturn: { title: "Tideturn", category: "consumer", goal: "grow_revenue",
    description: "A tide-and-catch log for sea anglers. 180,000 downloads, 9,000 paying GBP 20 a year, four of us. Growth is all word of mouth on forums and we have never paid for a user." },
  hearthmap: { title: "Hearthmap", category: "marketplace", goal: "first_customers",
    description: "Matching people who need a chimney swept with sweeps who have a gap that week. Twenty-two sweeps across Devon and Cornwall, I take GBP 4 a booking, about thirty bookings so far. It is me and a Airtable base." },
};
const which = process.argv[2];
const OUT = `.sim-lab/${which}.json`;
if (existsSync(OUT)) { console.log(`${which}: already asked`); process.exit(0); }
const prompt = buildMarketPrompt({ project: P[which], progress: null, startup: true });
const c = await getOpenAI().chat.completions.create({ model: "gpt-4o", messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }] });
const niche: any = parseMarket(c.choices[0]?.message?.content ?? "", which);
if (!niche) { console.log(`${which}: parseMarket REFUSED`); process.exit(1); }
writeFileSync(OUT, JSON.stringify(niche));
const total = niche.segments.reduce((s: number, x: any) => s + x.size, 0);
const worth = niche.segments.reduce((s: number, x: any) => s + x.size * x.referencePrice, 0);
console.log(`${which}: "${niche.name}" ${total.toLocaleString()} people · ${Math.round(worth).toLocaleString()}/yr · openShare ${niche.openShare?.toFixed(3)} · prices ${niche.segments.map((s: any)=>s.referencePrice).join("/")}`);
