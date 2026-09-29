/**
 * The people and the things they are building.
 *
 * Written by hand rather than generated from name lists, because a populated
 * site is only convincing if the projects are. Twenty plausible businesses
 * with real-sounding constraints read as a community; two hundred rows of
 * "Project 47 — a platform for X" read as a database with rows in it, which is
 * worse than an empty page because it tells a visitor the place is fake.
 *
 * Spread on purpose across all three paths (ship an MVP, systemize, run a
 * company), across software and the trades, across countries and currencies,
 * and across stages — so every filter on Discover has something behind it and
 * the market does not look like twenty people building the same SaaS.
 */
export interface DemoPerson {
  first: string;
  last: string;
  location: string;
  headline: string;
  bio: string;
  skills: string[];
}

export interface DemoProject {
  owner: number;
  title: string;
  description: string;
  category: string;
  goal: "ship_mvp" | "systemize_business" | "run_company";
  subcategory: string;
  stage: "planning" | "active" | "completed";
  currency: string;
  /** Posts this project's owner has made about it, oldest first. */
  updates: { type: string; text: string }[];
}

export const PEOPLE: DemoPerson[] = [
  { first: "Amara", last: "Okafor", location: "Lagos, Nigeria", headline: "Building payments rails for market traders",
    bio: "Ten years in bank ops, two of them watching traders lose an afternoon a week reconciling cash. Now building the thing I kept asking for.",
    skills: ["Product", "Payments", "Postgres", "Go"] },
  { first: "Ben", last: "Kowalski", location: "Kraków, Poland", headline: "Backend engineer, ex-logistics",
    bio: "I moved pallets before I moved packets. Interested in software for people who work with their hands.",
    skills: ["TypeScript", "Node", "Kubernetes", "APIs"] },
  { first: "Chiara", last: "Rossi", location: "Bologna, Italy", headline: "Running two bakeries, systemising the second",
    bio: "Opened in 2019, survived, opened again. Trying to build a business that does not need me in it at five in the morning.",
    skills: ["Operations", "Hiring", "Food & drink"] },
  { first: "Daniel", last: "Osei", location: "Toronto, Canada", headline: "Translator turned toolmaker",
    bio: "Eighteen months building the glossary checker I needed. Nine translators use it daily. Working out whether that is a business.",
    skills: ["Python", "NLP", "Localisation"] },
  { first: "Eve", last: "Lindqvist", location: "Gothenburg, Sweden", headline: "Design systems, mostly for small teams",
    bio: "I make things legible. Currently doing that for a climate reporting tool and for anyone who asks nicely.",
    skills: ["Design", "Figma", "Front-end", "Accessibility"] },
  { first: "Faisal", last: "Rahman", location: "Manchester, UK", headline: "Third-generation electrician, first to write software",
    bio: "Taught myself to code between jobs. Building scheduling for trades because every tool I tried was made for offices.",
    skills: ["React", "Scheduling", "Trades"] },
  { first: "Grace", last: "Mbeki", location: "Cape Town, South Africa", headline: "Community solar, one roof at a time",
    bio: "Financing and installing panels for households the banks will not touch. The spreadsheet became a company.",
    skills: ["Energy", "Finance", "Operations"] },
  { first: "Hiro", last: "Tanaka", location: "Fukuoka, Japan", headline: "Games, small and finished",
    bio: "Two shipped, one abandoned, learned more from the abandoned one. Prefers projects that fit in a year.",
    skills: ["Unity", "C#", "Game design"] },
  { first: "Ines", last: "Moreau", location: "Lyon, France", headline: "Bookkeeper for people who hate bookkeeping",
    bio: "Forty clients, all sole traders. Building the tool I use for them so they can use it themselves.",
    skills: ["Accounting", "Automation", "Excel"] },
  { first: "Jonah", last: "Weiss", location: "Berlin, Germany", headline: "Data plumbing for climate reporting",
    bio: "Regulation made this a market. I would rather it had not, but here we are and the work matters.",
    skills: ["Data engineering", "Python", "dbt"] },
  { first: "Keira", last: "Donnelly", location: "Galway, Ireland", headline: "Physio, two clinics, one bad rota",
    bio: "Clinical lead who ended up running the business. Fixing the admin so I can go back to treating people.",
    skills: ["Healthcare", "Operations", "Hiring"] },
  { first: "Luis", last: "Ferreira", location: "Porto, Portugal", headline: "Wine logistics, unglamorous and needed",
    bio: "Small producers cannot afford the systems the big ones use. Building the cheap version properly.",
    skills: ["Logistics", "B2B", "Rails"] },
  { first: "Maya", last: "Goldberg", location: "Tel Aviv, Israel", headline: "Security engineer, reluctant founder",
    bio: "Kept finding the same misconfiguration at every client. Wrote a scanner. Clients started paying for the scanner.",
    skills: ["Security", "Cloud", "Go"] },
  { first: "Niall", last: "Byrne", location: "Dublin, Ireland", headline: "Coffee roastery, wholesale-first",
    bio: "No café, no queue, no rent on a high street. Just good beans and forty restaurant accounts.",
    skills: ["Food & drink", "Wholesale", "Sales"] },
  { first: "Ola", last: "Adeyemi", location: "Brighton, UK", headline: "Teaching kids to code, badly at first",
    bio: "Started in a library with six laptops. Now eleven schools. The hard part was never the curriculum.",
    skills: ["Education", "Curriculum", "Community"] },
  { first: "Petra", last: "Novak", location: "Ljubljana, Slovenia", headline: "Hardware for greenhouses",
    bio: "Sensors, valves, and a dashboard growers will actually open. Two seasons of field data so far.",
    skills: ["IoT", "Embedded", "Agriculture"] },
  { first: "Quentin", last: "Diallo", location: "Dakar, Senegal", headline: "Delivery routing for cities without street names",
    bio: "Addressing is the whole problem. Everything else is a solved problem badly applied.",
    skills: ["Mobile", "Routing", "Maps"] },
  { first: "Rosa", last: "Martín", location: "Valencia, Spain", headline: "Ceramics studio, six kilns, one waitlist",
    bio: "Made pots, then made a business by accident. Now deciding whether to teach or to make.",
    skills: ["Craft", "Retail", "Teaching"] },
  { first: "Sam", last: "Whitfield", location: "Leeds, UK", headline: "Zero-waste grocery, third year",
    bio: "One shop, a van round, and a margin that only works if the round is full. Working on the round.",
    skills: ["Retail", "Sustainability", "Operations"] },
  { first: "Tara", last: "Iyer", location: "Bengaluru, India", headline: "Hiring tools for teams under twenty",
    bio: "Every applicant tracker is built for a company with a recruiting department. Most companies do not have one.",
    skills: ["Product", "HR tech", "TypeScript"] },
  { first: "Umar", last: "Sadiq", location: "Karachi, Pakistan", headline: "Tailoring at scale, without losing the fit",
    bio: "Forty tailors, one measurement standard, and a lot of arguing about sleeves.",
    skills: ["Manufacturing", "Supply chain", "Retail"] },
  { first: "Vera", last: "Ilić", location: "Belgrade, Serbia", headline: "Accessibility audits, mostly for public services",
    bio: "If a form cannot be filled in with a keyboard it is not a form, it is a wall.",
    skills: ["Accessibility", "Testing", "Public sector"] },
  { first: "Wes", last: "Carter", location: "Detroit, USA", headline: "Bike repair, mobile, by appointment",
    bio: "The van is the shop. Three years, no premises, and a booking system held together with hope.",
    skills: ["Trades", "Logistics", "Customer service"] },
  { first: "Yuki", last: "Nakamura", location: "Osaka, Japan", headline: "Inventory for independent bookshops",
    bio: "Booksellers know their stock better than any algorithm. They just need it written down faster.",
    skills: ["Retail tech", "Ruby", "Search"] },
];

export const PROJECTS: DemoProject[] = [
  { owner: 0, title: "Tally Market", description: "Cash reconciliation for market traders. Photograph the day's takings, and it squares them against stock movements before you get home. Built for a phone in one hand at the end of a twelve-hour day, not a desktop at midnight.", category: "Fintech", goal: "ship_mvp", subcategory: "saas", stage: "active", currency: "USD",
    updates: [{ type: "milestone", text: "Forty traders on the pilot. The reconciliation now runs in under four seconds on a mid-range Android, which was the whole bar." }, { type: "seeking_feedback", text: "Torn between charging per stall or per market. Per stall is simpler; per market is what the associations actually budget for. Anyone sold to trade associations before?" }] },
  { owner: 1, title: "Palletwise", description: "Route and load planning for hauliers running fewer than twenty vehicles. The big systems cost more per month than a small operator's insurance, and assume a planning department that does not exist here.", category: "Transport & Logistics", goal: "ship_mvp", subcategory: "saas", stage: "active", currency: "EUR",
    updates: [{ type: "project_update", text: "Rewrote the packing solver. It is slower and right, which is the correct trade — the fast one was quietly overloading axles." }] },
  { owner: 2, title: "Forno Due", description: "The second bakery, and the first one that has to run without me. Same bread, same hours, different problem: everything in my head has to end up written down before it opens.", category: "Food & Drink", goal: "systemize_business", subcategory: "restaurant", stage: "active", currency: "EUR",
    updates: [{ type: "project_update", text: "Wrote down the morning: 4:40 to 7:15, twenty-two steps. Half of them I did not know I was doing until I watched someone else fail to do them." }, { type: "looking_for_help", text: "Looking for a head baker who wants to run a shift rather than be told how. Bologna or willing to move." }] },
  { owner: 3, title: "Glossline", description: "A glossary and style checker for freelance translators. It reads a finished translation against the client's own terminology before it goes back — the slips that cost you the account.", category: "SaaS", goal: "ship_mvp", subcategory: "saas", stage: "active", currency: "CAD",
    updates: [{ type: "launch", text: "Opened it to everyone today. Nine testers became sixty-one people in a week, which is either a good sign or a support problem. Probably both." }] },
  { owner: 4, title: "Plainsight", description: "A design system for teams without a designer. Components, the reasoning behind them, and the three decisions you actually have to make yourself.", category: "Design", goal: "ship_mvp", subcategory: "saas", stage: "planning", currency: "EUR", updates: [] },
  { owner: 5, title: "Sparkside", description: "Scheduling for electricians, plumbers and heating engineers. Built around a day that changes at nine in the morning, because it always does.", category: "Trades & Home Services", goal: "ship_mvp", subcategory: "saas", stage: "active", currency: "GBP",
    updates: [{ type: "idea_validation", text: "Twenty-two sparkies interviewed. Every one of them said the same thing: the problem is not the calendar, it is telling the customer you are running late without stopping the van." }] },
  { owner: 6, title: "Sunfall", description: "Rooftop solar for households the banks will not finance. We install, they repay from what they save, and the meter settles the argument.", category: "Sustainability", goal: "run_company", subcategory: "service", stage: "active", currency: "USD",
    updates: [{ type: "milestone", text: "Two hundredth roof this week. Default rate still under two per cent, which is the number everybody said would sink us." }] },
  { owner: 7, title: "Lanternfall", description: "A small game about a lighthouse keeper and the things the tide brings in. Twelve hours long, no combat, finishable in a fortnight of evenings.", category: "Gaming", goal: "ship_mvp", subcategory: "consumer", stage: "active", currency: "USD",
    updates: [{ type: "project_update", text: "Cut the crafting system. It was the best-looking part of the build and it was making the game longer rather than better." }] },
  { owner: 8, title: "Ledgerlight", description: "Bookkeeping for sole traders who would rather be doing the work. Photograph the receipt, it files itself, and your accountant gets something they can use in January.", category: "SaaS", goal: "ship_mvp", subcategory: "saas", stage: "active", currency: "EUR", updates: [] },
  { owner: 9, title: "Carbontrail", description: "Emissions reporting pipelines for mid-sized manufacturers. Boring, regulated, and the spreadsheets it replaces are genuinely dangerous.", category: "Data Analytics", goal: "systemize_business", subcategory: "agency", stage: "active", currency: "EUR", updates: [] },
  { owner: 10, title: "Rotafix", description: "Rota and room booking for two physio clinics. Eleven staff, six rooms, and a booking system that currently lives in my head and a whiteboard.", category: "Health & Wellness", goal: "systemize_business", subcategory: "service", stage: "active", currency: "EUR",
    updates: [{ type: "project_update", text: "Two weeks of running the new rota. Seven fewer hours of admin, one very cross Tuesday. Net: keeping it." }] },
  { owner: 11, title: "Cellarway", description: "Order and shipping software for small wine producers. Bonded warehouses, duty, and forty different importer formats, made survivable.", category: "E-Commerce", goal: "ship_mvp", subcategory: "saas", stage: "planning", currency: "EUR", updates: [] },
  { owner: 12, title: "Driftnet", description: "A scanner for the cloud misconfiguration everybody has and nobody finds: over-broad roles that only look safe because nothing has gone wrong yet.", category: "AI/ML", goal: "ship_mvp", subcategory: "saas", stage: "active", currency: "USD",
    updates: [{ type: "seeking_feedback", text: "Every competitor leads with a severity score. I think severity without blast radius is theatre. Am I wrong, or just annoying?" }] },
  { owner: 13, title: "Byrne & Sons Coffee", description: "Wholesale coffee roasting, no café. Forty restaurant accounts, one roaster, and a delivery round that has to stay tight to work.", category: "Food & Drink", goal: "run_company", subcategory: "retail", stage: "active", currency: "EUR",
    updates: [{ type: "milestone", text: "Forty-first account signed. That is the roaster at capacity — the next decision is a bigger one or fewer customers, and I have been avoiding it for a month." }] },
  { owner: 14, title: "Sixth Form Software", description: "A coding curriculum for schools with no computing teacher. Eleven schools, three hundred kids, and worksheets that survive a supply teacher.", category: "Education", goal: "run_company", subcategory: "service", stage: "active", currency: "GBP", updates: [] },
  { owner: 15, title: "Greenhouse Nine", description: "Sensors and valves for commercial greenhouses, with a dashboard a grower will open twice a day rather than never.", category: "IoT", goal: "ship_mvp", subcategory: "hardware", stage: "active", currency: "EUR", updates: [] },
  { owner: 16, title: "Kando", description: "Delivery routing for cities where addresses are descriptions rather than numbers. Riders draw the route once and it learns the city.", category: "Mobile App", goal: "ship_mvp", subcategory: "consumer", stage: "active", currency: "USD",
    updates: [{ type: "launch", text: "Live in two districts. The mapping is not the hard part — getting riders to trust a route they did not choose is the hard part." }] },
  { owner: 17, title: "Rosa Martín Cerámica", description: "A ceramics studio with six kilns and a nine-month waitlist. Deciding whether the business is pots or teaching people to make pots.", category: "Retail & Shops", goal: "run_company", subcategory: "retail", stage: "active", currency: "EUR", updates: [] },
  { owner: 18, title: "The Refill Round", description: "Zero-waste grocery: one shop and a weekly van round. The round only pays if it is full, so most of the work is filling the round.", category: "Retail & Shops", goal: "run_company", subcategory: "retail", stage: "active", currency: "GBP",
    updates: [{ type: "project_update", text: "Dropped two streets from the round and added one estate. Same mileage, eleven more boxes. Should have done it a year ago." }] },
  { owner: 19, title: "Twenty or Fewer", description: "Hiring software for teams too small to have a recruiter. One pipeline, no scorecards nobody fills in, and interview notes that survive the week.", category: "SaaS", goal: "ship_mvp", subcategory: "saas", stage: "active", currency: "USD", updates: [] },
  { owner: 20, title: "Sleevework", description: "Measurement standards and order tracking across forty tailors, so a shirt ordered in one shop fits the same as one ordered in another.", category: "Manufacturing", goal: "systemize_business", subcategory: "retail", stage: "active", currency: "USD", updates: [] },
  { owner: 21, title: "Keyboard First", description: "Accessibility audits for public service forms, and the retest six weeks later that nobody else includes.", category: "Professional Services", goal: "run_company", subcategory: "agency", stage: "active", currency: "EUR", updates: [] },
  { owner: 22, title: "Spokewright", description: "Mobile bike repair by appointment. The van is the shop, and the booking system is currently three apps and a notebook.", category: "Trades & Home Services", goal: "systemize_business", subcategory: "service", stage: "active", currency: "USD", updates: [] },
  { owner: 23, title: "Shelfsense", description: "Stock and search for independent bookshops. Booksellers know their stock; this just writes it down at the speed they talk.", category: "Retail & Shops", goal: "ship_mvp", subcategory: "saas", stage: "planning", currency: "USD", updates: [] },
];

/** Posts that are not about one project: the noise a real feed has. */
export const CHATTER: { owner: number; type: string; text: string }[] = [
  { owner: 4, type: "looking_for_cofounder", text: "Looking for someone commercial to argue with me. I can build it and I will happily build the wrong thing for a year if nobody stops me." },
  { owner: 7, type: "idea_validation", text: "Does anybody actually want a twelve-hour game any more, or have I designed for the person I was in 2014?" },
  { owner: 12, type: "seeking_feedback", text: "Pricing question: security tools are bought by the person who gets blamed, not the person who uses them. Does that mean I am selling to the wrong half of my signups?" },
  { owner: 2, type: "looking_for_help", text: "Anybody here systemised a food business without making it worse? Everything I write down makes the bread slightly less good and I cannot tell if that is real or me." },
  { owner: 18, type: "seeking_feedback", text: "Van round margin: is it madness to raise the minimum box to £22? Half my regulars are at £18 and I do not want to lose them to save a tenner of diesel." },
  { owner: 10, type: "project_update", text: "Reminder to anybody running a clinic: the rota is not the bottleneck. Room turnover is. Took me two years and a spreadsheet to see it." },
  { owner: 21, type: "milestone", text: "Fiftieth audit done. Still the same three failures every time: focus order, error messages tied to colour, and a date picker nobody can use." },
  { owner: 15, type: "looking_for_help", text: "Need someone who has shipped hardware to tell me honestly how bad the certification step is going to be. Buy you dinner for an hour of truth." },
];
