/**
 * Sixteen demo builders, one per headshot in attached_assets/headshots.
 *
 * Seed data for a site that is about to open: an empty Discover page tells a
 * visitor that nobody is here, which is the one thing a network cannot recover
 * from saying. These fill it.
 *
 * ## What they are, honestly
 *
 * Accounts with `isBot: true` and `authProvider: "bot"` — the same mechanism
 * the simulation opponents use (server/bot-accounts.ts). Nothing can sign in
 * as one, and every one of them can be found and removed with a single query.
 * They carry no visible marker on the profile card, which is the owner's
 * decision and worth restating here: a visitor reading Discover will take them
 * for real builders.
 *
 * The photographs are generated, not of real people, and the names, histories
 * and companies are invented. No real person, employer or school should be
 * recognisable in any of this — if one ever is, that is a bug, and the fix is
 * to change the row rather than to argue about it.
 *
 * ## Why the detail
 *
 * Each has a real-shaped history because a profile with a headline and nothing
 * under it reads as abandoned, which is worse than absent. The work in each
 * resume is the work that explains the project they are building: the
 * restaurant manager is building a rota tool, the supply-chain director is
 * building freight software. That is the product's whole argument — people
 * build what they already understand — and seed data that contradicts it
 * would teach a visitor the opposite.
 */

export interface DemoProject {
  title: string;
  description: string;
  category: string;
  goal: "ship_mvp" | "systemize_business" | "run_company";
  subcategory: string;
}

export interface DemoBuilder {
  /** The file in attached_assets/headshots this persona was written for. */
  photo: string;
  firstName: string;
  lastName: string;
  username: string;
  headline: string;
  bio: string;
  location: string;
  skills: string[];
  interests: string[];
  experienceLevel: "beginner" | "intermediate" | "expert";
  hoursPerWeek: number;
  riskTolerance: "low" | "moderate" | "high";
  speedVsPolish: "speed" | "balanced" | "polish";
  scheduleStyle: "structured" | "flexible" | "hybrid";
  conflictStyle: "direct" | "diplomatic" | "avoidant" | "collaborative";
  builderType: "long-term" | "experimental" | "both";
  experience: {
    title: string; company: string; location?: string;
    startDate: string; endDate?: string | null; current?: boolean;
    description: string; skills?: string[];
  }[];
  education: { school: string; degree?: string; field?: string; startYear?: string; endYear?: string }[];
  projects: DemoProject[];
}

export const DEMO_BUILDERS: DemoBuilder[] = [
  {
    photo: "Abraham_headshot.png",
    firstName: "Abraham", lastName: "Reyes", username: "abereyes",
    headline: "Ran kitchens for eleven years. Building the rota tool I kept asking for.",
    bio: "I spent eleven years in restaurant kitchens, the last four running two of them. Every week I built the schedule in a spreadsheet, every week somebody's availability changed on a Thursday, and every week I found out on the floor. I am building the thing I wanted and could never find at a price a two-site operator can pay.",
    location: "Austin, TX",
    skills: ["Operations", "Scheduling", "Hospitality", "Cost control", "Team leadership"],
    interests: ["Restaurants", "Small business tooling", "Local suppliers"],
    experienceLevel: "intermediate", hoursPerWeek: 15,
    riskTolerance: "moderate", speedVsPolish: "speed", scheduleStyle: "flexible",
    conflictStyle: "direct", builderType: "long-term",
    experience: [
      { title: "General Manager", company: "Cedar & Salt", location: "Austin, TX", startDate: "2021", current: true,
        description: "Two sites, 38 staff. Took food cost from 34% to 28% over two years by changing how prep was scheduled rather than what was bought.",
        skills: ["P&L", "Scheduling", "Vendor negotiation"] },
      { title: "Sous Chef", company: "Marchetti's", location: "Austin, TX", startDate: "2017", endDate: "2021",
        description: "Ran service on a 90-cover line. Wrote the prep lists the kitchen still uses.",
        skills: ["Kitchen management", "Training"] },
      { title: "Line Cook", company: "The Hollow", location: "San Antonio, TX", startDate: "2014", endDate: "2017",
        description: "Where I learned that a rota is a promise to somebody's childcare arrangements." },
    ],
    education: [{ school: "Austin Community College", degree: "Associate", field: "Culinary Arts", startYear: "2012", endYear: "2014" }],
    projects: [
      { title: "Shiftwork", description: "Rota software for restaurants with two to five sites. Staff set availability from their phone, the schedule warns you before it breaks labour law or your budget, and swaps settle without a group chat.", category: "SaaS", goal: "ship_mvp", subcategory: "saas" },
    ],
  },
  {
    photo: "ChatGPT Image Sep 29, 2026, 09_42_20 AM.png",
    firstName: "Rajan", lastName: "Mehta", username: "rajanmehta",
    headline: "Twenty years moving other people's freight. Now building the software I couldn't buy.",
    bio: "I ran supply chain for a mid-market manufacturer through two recessions and one pandemic. The tooling available to a company our size was either a spreadsheet or a six-figure implementation. There is nothing in between, and that gap is the company I am building.",
    location: "Chicago, IL",
    skills: ["Supply chain", "Logistics", "Vendor management", "Forecasting", "B2B sales"],
    interests: ["Manufacturing", "Freight", "Mid-market software"],
    experienceLevel: "expert", hoursPerWeek: 20,
    riskTolerance: "low", speedVsPolish: "polish", scheduleStyle: "structured",
    conflictStyle: "diplomatic", builderType: "long-term",
    experience: [
      { title: "VP, Supply Chain", company: "Keystone Industrial", location: "Chicago, IL", startDate: "2016", current: true,
        description: "$240M of goods a year across 40 suppliers. Cut stockouts by two thirds by forecasting at the component level rather than the SKU.",
        skills: ["Forecasting", "Supplier contracts", "ERP"] },
      { title: "Director of Logistics", company: "Vance Manufacturing", location: "Milwaukee, WI", startDate: "2010", endDate: "2016",
        description: "Rebuilt the carrier mix after a fuel spike made the old one unaffordable." },
      { title: "Operations Analyst", company: "Grainline Foods", startDate: "2005", endDate: "2010",
        description: "Learned demand planning on a product with a nine-day shelf life." },
    ],
    education: [
      { school: "Purdue University", degree: "MS", field: "Industrial Engineering", startYear: "2003", endYear: "2005" },
      { school: "University of Mumbai", degree: "BEng", field: "Mechanical Engineering", startYear: "1999", endYear: "2003" },
    ],
    projects: [
      { title: "Laneways", description: "Freight planning for manufacturers too big for spreadsheets and too small for SAP. Tells you what a lane really costs once you count the delays, not what the rate card says.", category: "SaaS", goal: "ship_mvp", subcategory: "saas" },
      { title: "Keystone spare-parts line", description: "Turning our spare-parts desk into a business that runs without me: documented process, pricing rules, and someone other than me able to quote.", category: "Other", goal: "systemize_business", subcategory: "service" },
    ],
  },
  {
    photo: "ChatGPT Image Sep 29, 2026, 09_42_25 AM.png",
    firstName: "Nia", lastName: "Whitfield", username: "niawhitfield",
    headline: "Twelve years in school districts. Building the thing teachers actually open.",
    bio: "I have bought edtech and I have been sold edtech, and the gap between the demo and the Tuesday is where most of it dies. Teachers do not need another dashboard. They need the thing that takes twenty minutes off their evening.",
    location: "Atlanta, GA",
    skills: ["Education policy", "Programme design", "Research", "Stakeholder management", "Grant writing"],
    interests: ["Public education", "Literacy", "Measurement"],
    experienceLevel: "intermediate", hoursPerWeek: 12,
    riskTolerance: "moderate", speedVsPolish: "balanced", scheduleStyle: "structured",
    conflictStyle: "collaborative", builderType: "long-term",
    experience: [
      { title: "Director of Academic Programs", company: "Fulton Public Schools", location: "Atlanta, GA", startDate: "2019", current: true,
        description: "38 schools, 22,000 students. Ran the literacy intervention that moved third-grade reading five points in two years.",
        skills: ["Programme evaluation", "Curriculum"] },
      { title: "Instructional Coach", company: "Fulton Public Schools", startDate: "2015", endDate: "2019",
        description: "Sat at the back of six hundred lessons. Most of what I know came from that." },
      { title: "Middle School Teacher", company: "Carver Middle School", startDate: "2012", endDate: "2015",
        description: "Seventh-grade English. Learned what a teacher will and will not do at 9pm." },
    ],
    education: [
      { school: "Emory University", degree: "MEd", field: "Educational Leadership", startYear: "2013", endYear: "2015" },
      { school: "Spelman College", degree: "BA", field: "English", startYear: "2008", endYear: "2012" },
    ],
    projects: [
      { title: "Marginal", description: "Reading intervention grouping that takes a class's assessment data and gives a teacher three groups and what to do with each, in the time it takes to make coffee.", category: "SaaS", goal: "ship_mvp", subcategory: "saas" },
    ],
  },
  {
    photo: "ChatGPT Image Sep 29, 2026, 09_42_28 AM.png",
    firstName: "Daniel", lastName: "Park", username: "danpark",
    headline: "Ex-marketplace PM. Building developer tools that don't need a meeting to explain.",
    bio: "Five years shipping marketplace features to millions of people taught me how much of a product's complexity is organisational rather than necessary. I am building small tools with a short explanation.",
    location: "Seattle, WA",
    skills: ["Product management", "APIs", "TypeScript", "Analytics", "Experimentation"],
    interests: ["Developer tools", "Marketplaces", "Pricing"],
    experienceLevel: "expert", hoursPerWeek: 25,
    riskTolerance: "high", speedVsPolish: "speed", scheduleStyle: "flexible",
    conflictStyle: "direct", builderType: "experimental",
    experience: [
      { title: "Senior Product Manager", company: "Tidewater Commerce", location: "Seattle, WA", startDate: "2021", current: true,
        description: "Owned seller onboarding. Took time-to-first-listing from eleven days to under one by deleting four steps.",
        skills: ["Onboarding", "Funnel analysis"] },
      { title: "Product Manager", company: "Northbeam Retail", startDate: "2018", endDate: "2021",
        description: "Search relevance and ranking. Shipped the experiment framework the team still runs on." },
      { title: "Software Engineer", company: "Corvid Labs", startDate: "2016", endDate: "2018",
        description: "Backend, mostly payments. Where I learned to read a ledger." },
    ],
    education: [{ school: "University of Washington", degree: "BS", field: "Computer Science", startYear: "2012", endYear: "2016" }],
    projects: [
      { title: "Sandbar", description: "A staging environment for payment webhooks. Replay any provider's events against your own endpoint, see what your code did, and stop testing money in production.", category: "Web App", goal: "ship_mvp", subcategory: "app" },
      { title: "Ledgerline", description: "A small tool that reconciles what your payment provider says it sent you against what your bank actually received, and names the difference.", category: "SaaS", goal: "ship_mvp", subcategory: "saas" },
    ],
  },
  {
    photo: "ChatGPT Image Sep 29, 2026, 09_42_33 AM.png",
    firstName: "Meredith", lastName: "Vance", username: "meredithvance",
    headline: "Ran clinic operations for fifteen years. Building scheduling that respects a waiting room.",
    bio: "I have opened four clinics and closed one. The software we used was written by people who had never watched a receptionist take three calls while a patient stood in front of them. I am trying to write the other kind.",
    location: "Boston, MA",
    skills: ["Healthcare operations", "Compliance", "Staff management", "Process design", "Budgeting"],
    interests: ["Primary care", "Patient access", "Small practices"],
    experienceLevel: "intermediate", hoursPerWeek: 10,
    riskTolerance: "low", speedVsPolish: "polish", scheduleStyle: "structured",
    conflictStyle: "diplomatic", builderType: "long-term",
    experience: [
      { title: "Director of Operations", company: "Charles River Family Health", location: "Boston, MA", startDate: "2017", current: true,
        description: "Four sites, 60 staff, 41,000 visits a year. Cut no-shows from 18% to 9% by changing when reminders were sent, not how many.",
        skills: ["Clinic operations", "HIPAA", "Vendor selection"] },
      { title: "Practice Manager", company: "Brookline Pediatrics", startDate: "2011", endDate: "2017",
        description: "Two physicians to nine. Hired most of them." },
      { title: "Patient Coordinator", company: "Mass General Brigham", startDate: "2008", endDate: "2011",
        description: "The front desk. Everything I believe about scheduling comes from those three years." },
    ],
    education: [
      { school: "Boston University", degree: "MHA", field: "Health Administration", startYear: "2009", endYear: "2011" },
      { school: "University of Vermont", degree: "BA", field: "Psychology", startYear: "2004", endYear: "2008" },
    ],
    projects: [
      { title: "Waitroom", description: "Appointment scheduling for independent practices, built around the receptionist rather than the calendar. Overbooking rules that know which appointment types actually run late.", category: "SaaS", goal: "ship_mvp", subcategory: "saas" },
    ],
  },
  {
    photo: "ChatGPT Image Sep 29, 2026, 09_50_36 AM.png",
    firstName: "Luca", lastName: "Ferrante", username: "lucaferrante",
    headline: "Payments infrastructure, eight years. Building the part nobody wants to build.",
    bio: "Reconciliation, disputes, chargebacks — the unglamorous half of payments, which is where the money actually goes missing. I have written this system twice inside other companies and would rather write it once properly.",
    location: "Miami, FL",
    skills: ["Payments", "Fraud", "Go", "PostgreSQL", "Risk modelling"],
    interests: ["Fintech", "Fraud", "Latin American markets"],
    experienceLevel: "expert", hoursPerWeek: 20,
    riskTolerance: "moderate", speedVsPolish: "polish", scheduleStyle: "hybrid",
    conflictStyle: "direct", builderType: "long-term",
    experience: [
      { title: "Staff Engineer, Payments", company: "Banda Pagos", location: "Miami, FL", startDate: "2020", current: true,
        description: "Built the dispute pipeline handling 40,000 cases a month. Recovered roughly $3M a year that was previously written off for want of evidence.",
        skills: ["Chargebacks", "Event pipelines"] },
      { title: "Senior Engineer", company: "Orilla Financial", startDate: "2017", endDate: "2020",
        description: "Card issuing and ledgering. Learned that a balance is an opinion until it is reconciled." },
      { title: "Engineer", company: "Vercetti Systems", startDate: "2014", endDate: "2017", description: "Integrations, mostly with banks that had none." },
    ],
    education: [{ school: "Università di Bologna", degree: "BSc", field: "Computer Engineering", startYear: "2010", endYear: "2014" }],
    projects: [
      { title: "Chargeback Desk", description: "Dispute handling for merchants doing $1M–$20M a year: pulls the evidence together, files on time, and tells you which disputes are worth fighting.", category: "SaaS", goal: "ship_mvp", subcategory: "saas" },
    ],
  },
  {
    photo: "ChatGPT Image Sep 29, 2026, 09_50_40 AM.png",
    firstName: "Grace", lastName: "Lim", username: "gracelim",
    headline: "Hotel operations, seventeen years. Building for the people behind the desk.",
    bio: "I have run front office, housekeeping and revenue for properties from 40 rooms to 400. Independents are sold enterprise software at enterprise prices and end up running the place on WhatsApp. That is the problem I want.",
    location: "San Francisco, CA",
    skills: ["Hospitality operations", "Revenue management", "Training", "Vendor management"],
    interests: ["Independent hotels", "Travel", "Service design"],
    experienceLevel: "expert", hoursPerWeek: 12,
    riskTolerance: "moderate", speedVsPolish: "balanced", scheduleStyle: "structured",
    conflictStyle: "collaborative", builderType: "long-term",
    experience: [
      { title: "General Manager", company: "The Ferry Building Hotel", location: "San Francisco, CA", startDate: "2018", current: true,
        description: "112 rooms, 70 staff. Took RevPAR up 22% in a flat market by changing the rate calendar and nothing else.",
        skills: ["Revenue management", "P&L"] },
      { title: "Director of Rooms", company: "Kimpton Marlowe", startDate: "2013", endDate: "2018", description: "Front office and housekeeping for 236 rooms." },
      { title: "Front Office Manager", company: "Hotel Zephyr", startDate: "2009", endDate: "2013", description: "Nights, then days. Learned the job from the 3am end of it." },
    ],
    education: [{ school: "Cornell University", degree: "BS", field: "Hotel Administration", startYear: "2005", endYear: "2009" }],
    projects: [
      { title: "Frontdesk", description: "A shift-handover and task tool for independent hotels. What happened overnight, what is outstanding, and who owns it — without the WhatsApp group.", category: "Web App", goal: "ship_mvp", subcategory: "app" },
    ],
  },
  {
    photo: "ChatGPT Image Sep 29, 2026, 09_50_44 AM.png",
    firstName: "Thomas", lastName: "Hale", username: "tomhale",
    headline: "Commercial real estate, a decade. Building the model everyone rebuilds in Excel.",
    bio: "Every acquisitions team in the country rebuilds the same underwriting model from scratch, badly, under time pressure. I have done it about two hundred times. It should be a product.",
    location: "Denver, CO",
    skills: ["Underwriting", "Financial modelling", "Due diligence", "Negotiation", "Excel"],
    interests: ["Real estate", "Capital markets", "Small-bay industrial"],
    experienceLevel: "intermediate", hoursPerWeek: 18,
    riskTolerance: "moderate", speedVsPolish: "balanced", scheduleStyle: "hybrid",
    conflictStyle: "direct", builderType: "both",
    experience: [
      { title: "Director of Acquisitions", company: "Front Range Capital", location: "Denver, CO", startDate: "2019", current: true,
        description: "$310M of small-bay industrial across 14 deals. Passed on more than I bought, which is the job.",
        skills: ["Underwriting", "LOIs", "Debt"] },
      { title: "Acquisitions Associate", company: "Stonebridge Partners", startDate: "2015", endDate: "2019", description: "Modelled everything the directors looked at." },
      { title: "Analyst", company: "CBRE", startDate: "2013", endDate: "2015", description: "Valuation. Where the Excel habit started." },
    ],
    education: [{ school: "University of Colorado Boulder", degree: "BS", field: "Finance", startYear: "2009", endYear: "2013" }],
    projects: [
      { title: "Underwrite", description: "Industrial and multifamily underwriting that starts from the rent roll you were actually sent, not from a blank sheet. Assumptions you can defend in an investment committee.", category: "SaaS", goal: "ship_mvp", subcategory: "saas" },
    ],
  },
  {
    photo: "ChatGPT Image Sep 29, 2026, 09_50_48 AM.png",
    firstName: "Amara", lastName: "Diallo", username: "amaradiallo",
    headline: "Brand and content for consumer companies. Turning the studio into a business.",
    bio: "Nine years making brands that people can describe to a friend. I have a studio with four people and a waiting list, which sounds like success and behaves like a bottleneck. Working on the version that runs without me in every meeting.",
    location: "Brooklyn, NY",
    skills: ["Brand strategy", "Copywriting", "Art direction", "Content", "Client management"],
    interests: ["Consumer brands", "Publishing", "Typography"],
    experienceLevel: "intermediate", hoursPerWeek: 14,
    riskTolerance: "moderate", speedVsPolish: "polish", scheduleStyle: "flexible",
    conflictStyle: "collaborative", builderType: "long-term",
    experience: [
      { title: "Founder & Creative Director", company: "Fieldnote Studio", location: "Brooklyn, NY", startDate: "2020", current: true,
        description: "Four people, 30 brand projects. Built the positioning for two companies that went on to raise a Series A.",
        skills: ["Brand strategy", "Team leadership"] },
      { title: "Associate Creative Director", company: "Reed & Company", startDate: "2017", endDate: "2020", description: "Consumer packaged goods, mostly food." },
      { title: "Copywriter", company: "Halyard", startDate: "2014", endDate: "2017", description: "Learned to cut my own writing by half." },
    ],
    education: [{ school: "Pratt Institute", degree: "BFA", field: "Communications Design", startYear: "2010", endYear: "2014" }],
    projects: [
      { title: "Fieldnote Studio", description: "Making a four-person brand studio run without the founder in every meeting: productised packages, a real pipeline, and someone else able to run a kickoff.", category: "Other", goal: "systemize_business", subcategory: "service" },
    ],
  },
  {
    photo: "ChatGPT Image Sep 29, 2026, 09_58_30 AM.png",
    firstName: "Saul", lastName: "Brenner", username: "saulbrenner",
    headline: "Thirty years in metal fabrication. Handing it over, and writing down how it works.",
    bio: "My father started the shop in 1978 and I have run it since 2004. Forty-one people. I am sixty-two and the knowledge that keeps this place running is in my head, which is a bad place for it. This is me getting it out.",
    location: "Yonkers, NY",
    skills: ["Manufacturing", "Quoting", "Quality systems", "Succession planning", "Union relations"],
    interests: ["Fabrication", "Apprenticeships", "Family business"],
    experienceLevel: "expert", hoursPerWeek: 8,
    riskTolerance: "low", speedVsPolish: "polish", scheduleStyle: "structured",
    conflictStyle: "direct", builderType: "long-term",
    experience: [
      { title: "President", company: "Brenner Metalworks", location: "Yonkers, NY", startDate: "2004", current: true,
        description: "41 staff, $14M a year in architectural metal. Took the shop through 2008 without a layoff, which cost me a house.",
        skills: ["Operations", "Estimating", "Leadership"] },
      { title: "Shop Foreman", company: "Brenner Metalworks", startDate: "1994", endDate: "2004", description: "Ran the floor while my father ran the front." },
      { title: "Welder", company: "Brenner Metalworks", startDate: "1988", endDate: "1994", description: "Started where everyone here starts." },
    ],
    education: [{ school: "Westchester Community College", degree: "Certificate", field: "Welding Technology", startYear: "1986", endYear: "1988" }],
    projects: [
      { title: "Brenner Metalworks", description: "Getting forty years of quoting judgement out of my head and into something the next person can run: estimating rules, a real handover, and a shop that does not phone me on a Sunday.", category: "Other", goal: "systemize_business", subcategory: "other" },
    ],
  },
  {
    photo: "ChatGPT Image Sep 29, 2026, 09_58_36 AM.png",
    firstName: "Leila", lastName: "Haddad", username: "leilahaddad",
    headline: "Product design for health and finance. Building the tool designers keep faking in Figma.",
    bio: "Twelve years designing things people use when they are worried — medical results, loan applications, benefit claims. Most design tooling assumes a happy user with time. I am building for the other one.",
    location: "New York, NY",
    skills: ["Product design", "Research", "Accessibility", "Design systems", "Prototyping"],
    interests: ["Accessibility", "Public services", "Health"],
    experienceLevel: "expert", hoursPerWeek: 16,
    riskTolerance: "moderate", speedVsPolish: "polish", scheduleStyle: "flexible",
    conflictStyle: "collaborative", builderType: "both",
    experience: [
      { title: "Principal Designer", company: "Meridian Health", location: "New York, NY", startDate: "2019", current: true,
        description: "Redesigned how results are delivered to patients. Complaints about 'not understanding my results' fell by two thirds.",
        skills: ["Research", "Accessibility", "Content design"] },
      { title: "Senior Product Designer", company: "Société Générale", location: "Paris", startDate: "2015", endDate: "2019", description: "Retail lending. Learned how a form feels when the answer matters." },
      { title: "Designer", company: "Atelier Nord", location: "Paris", startDate: "2012", endDate: "2015", description: "Agency work, everything from packaging to kiosks." },
    ],
    education: [
      { school: "ENSCI – Les Ateliers", degree: "MDes", field: "Industrial Design", startYear: "2010", endYear: "2012" },
      { school: "Université Paris-Saclay", degree: "BSc", field: "Cognitive Science", startYear: "2007", endYear: "2010" },
    ],
    projects: [
      { title: "Plainly", description: "A readability and comprehension check for interfaces that carry bad news: reads your actual screens and tells you which sentence a worried person will misread.", category: "Web App", goal: "ship_mvp", subcategory: "app" },
    ],
  },
  {
    photo: "ChatGPT Image Sep 29, 2026, 09_58_47 AM.png",
    firstName: "Arjun", lastName: "Nair", username: "arjunnair",
    headline: "Data science in insurance. Building forecasting small companies can actually run.",
    bio: "Seven years building models inside companies with data teams. Every small business I know forecasts by taking last year and adding ten per cent. The gap between those two worlds is enormous and nobody is serving the middle.",
    location: "Toronto, ON",
    skills: ["Python", "Forecasting", "Machine learning", "SQL", "Statistics"],
    interests: ["Forecasting", "Insurance", "Open data"],
    experienceLevel: "expert", hoursPerWeek: 22,
    riskTolerance: "high", speedVsPolish: "balanced", scheduleStyle: "flexible",
    conflictStyle: "diplomatic", builderType: "experimental",
    experience: [
      { title: "Lead Data Scientist", company: "Maple Shield Insurance", location: "Toronto, ON", startDate: "2021", current: true,
        description: "Claims severity models across four provinces. Took reserve error down 31%, which is a lot of money at this size.",
        skills: ["Modelling", "Validation"] },
      { title: "Data Scientist", company: "Northwind Analytics", startDate: "2018", endDate: "2021", description: "Consulting. Twelve industries in three years, which is the fastest way to learn what generalises." },
      { title: "Analyst", company: "Statistics Canada", startDate: "2017", endDate: "2018", description: "Survey methodology. Learned to distrust a clean dataset." },
    ],
    education: [
      { school: "University of Waterloo", degree: "MMath", field: "Statistics", startYear: "2015", endYear: "2017" },
      { school: "University of Delhi", degree: "BSc", field: "Mathematics", startYear: "2011", endYear: "2015" },
    ],
    projects: [
      { title: "Nearcast", description: "Demand forecasting for businesses with one location and no data team. Connects to your point of sale and tells you what next week looks like, in units you order in.", category: "SaaS", goal: "ship_mvp", subcategory: "saas" },
      { title: "Seasonality", description: "A free tool that takes two years of sales history and shows you your real seasonal pattern, separated from the growth trend.", category: "Web App", goal: "ship_mvp", subcategory: "app" },
    ],
  },
  {
    photo: "ChatGPT Image Sep 29, 2026, 09_58_53 AM.png",
    firstName: "Diane", lastName: "Kowalski", username: "dianekowalski",
    headline: "Ran a nonprofit for eighteen years. Now running three thrift shops properly.",
    bio: "I spent eighteen years in nonprofit leadership and the last four running the retail arm that funds it. Three shops, volunteers, donated stock, and no system anywhere. Retail software assumes you bought your inventory. Ours arrives in bin bags.",
    location: "Minneapolis, MN",
    skills: ["Nonprofit management", "Retail operations", "Volunteer management", "Fundraising", "Budgeting"],
    interests: ["Circular economy", "Community retail", "Volunteering"],
    experienceLevel: "intermediate", hoursPerWeek: 10,
    riskTolerance: "low", speedVsPolish: "balanced", scheduleStyle: "structured",
    conflictStyle: "diplomatic", builderType: "long-term",
    experience: [
      { title: "Executive Director", company: "Lakeside Community Trust", location: "Minneapolis, MN", startDate: "2012", current: true,
        description: "Three thrift shops and a food programme. Retail now funds 60% of the budget, up from 14% when I took over.",
        skills: ["Retail", "Board management", "Grants"] },
      { title: "Director of Programs", company: "Lakeside Community Trust", startDate: "2007", endDate: "2012", description: "Ran the programmes the shops now pay for." },
      { title: "Case Manager", company: "Hennepin County", startDate: "2001", endDate: "2007", description: "Housing. Still the hardest job I have had." },
    ],
    education: [{ school: "University of Minnesota", degree: "MSW", field: "Social Work", startYear: "1999", endYear: "2001" }],
    projects: [
      { title: "Lakeside Thrift", description: "Making three donation-funded shops run on one system: what arrived, what is worth pricing up, what sells, and which volunteer shift actually covers the floor.", category: "Other", goal: "systemize_business", subcategory: "retail" },
    ],
  },
  {
    photo: "Emily_headshot.png",
    firstName: "Emily", lastName: "Brennan", username: "emilybrennan",
    headline: "Two coffee shops, four years. Opening the third without losing the first two.",
    bio: "I opened the first one at twenty-six with a loan from my aunt. The second nearly killed the first, because everything that worked was in my head and my head was in the other shop. Doing the third one differently.",
    location: "Portland, OR",
    skills: ["Retail operations", "Hiring", "Coffee", "Cost control", "Local marketing"],
    interests: ["Speciality coffee", "Neighbourhood retail", "Baking"],
    experienceLevel: "intermediate", hoursPerWeek: 12,
    riskTolerance: "moderate", speedVsPolish: "speed", scheduleStyle: "flexible",
    conflictStyle: "collaborative", builderType: "long-term",
    experience: [
      { title: "Owner", company: "Alder & Ash Coffee", location: "Portland, OR", startDate: "2021", current: true,
        description: "Two shops, 19 staff, $1.4M a year. The second site broke even in month seven, the first took fourteen.",
        skills: ["Operations", "Hiring", "Menu costing"] },
      { title: "Café Manager", company: "Stumptown Coffee", startDate: "2018", endDate: "2021", description: "Ran a high-volume bar and learned what a queue does to a till." },
      { title: "Barista", company: "Heart Coffee", startDate: "2016", endDate: "2018", description: "Where I learned the craft, badly at first." },
    ],
    education: [{ school: "Portland State University", degree: "BA", field: "Communications", startYear: "2012", endYear: "2016" }],
    projects: [
      { title: "Alder & Ash", description: "Opening a third coffee shop without the second one's mistakes: the opening checklist, the hiring bar, and the numbers that say whether the site works before the lease is signed.", category: "food", goal: "run_company", subcategory: "restaurant" },
    ],
  },
  {
    photo: "Jared_Headshot.png",
    firstName: "Jared", lastName: "Coleman", username: "jaredcoleman",
    headline: "Built a gym community from nothing. Building the software that ran it.",
    bio: "Eight years running a strength gym in Houston. We grew on retention, not marketing — people stayed because somebody noticed when they stopped coming. I built that noticing in spreadsheets, and now I am building it properly.",
    location: "Houston, TX",
    skills: ["Community building", "Coaching", "Retention", "Small business", "Programming"],
    interests: ["Strength training", "Community", "Local business"],
    experienceLevel: "intermediate", hoursPerWeek: 18,
    riskTolerance: "high", speedVsPolish: "speed", scheduleStyle: "flexible",
    conflictStyle: "direct", builderType: "both",
    experience: [
      { title: "Owner & Head Coach", company: "Ironbound Strength", location: "Houston, TX", startDate: "2018", current: true,
        description: "310 members, 82% twelve-month retention in an industry that averages half that. The whole system is knowing who is drifting before they quit.",
        skills: ["Retention", "Coaching", "Operations"] },
      { title: "Strength Coach", company: "Rice University Athletics", startDate: "2015", endDate: "2018", description: "Olympic sports. Learned periodisation properly." },
      { title: "Personal Trainer", company: "Life Time Fitness", startDate: "2013", endDate: "2015", description: "Sold memberships, which taught me what I did not want to build." },
    ],
    education: [{ school: "Texas A&M University", degree: "BS", field: "Kinesiology", startYear: "2009", endYear: "2013" }],
    projects: [
      { title: "Driftwatch", description: "Retention software for gyms and studios: tells an owner who has quietly stopped coming, this week, while a text still fixes it.", category: "SaaS", goal: "ship_mvp", subcategory: "saas" },
      { title: "Ironbound Strength", description: "Taking a 310-member gym from one coach's memory to something a second location could copy.", category: "Other", goal: "systemize_business", subcategory: "service" },
    ],
  },
  {
    photo: "Min_headshot.png",
    firstName: "Min-Ji", lastName: "Kang", username: "minjikang",
    headline: "Beauty e-commerce, six years. Building the returns tool that saved my margin.",
    bio: "I run a skincare brand doing seven figures. Returns were eating eleven per cent of revenue and nobody could tell me which products or why. I built the answer for myself in a spreadsheet and three other founders asked for it.",
    location: "Los Angeles, CA",
    skills: ["E-commerce", "Merchandising", "Paid acquisition", "Supply chain", "Analytics"],
    interests: ["Beauty", "DTC", "Sustainability"],
    experienceLevel: "intermediate", hoursPerWeek: 15,
    riskTolerance: "moderate", speedVsPolish: "balanced", scheduleStyle: "hybrid",
    conflictStyle: "diplomatic", builderType: "both",
    experience: [
      { title: "Founder", company: "Sohn Skincare", location: "Los Angeles, CA", startDate: "2020", current: true,
        description: "$3.1M a year, eleven SKUs, no outside money. Took returns from 11% to 4% by changing two product pages and one size guide.",
        skills: ["DTC", "Merchandising", "Retention"] },
      { title: "Senior Merchandiser", company: "Glossier", startDate: "2017", endDate: "2020", description: "Assortment planning. Learned what sells versus what photographs well." },
      { title: "Buyer", company: "Nordstrom", startDate: "2015", endDate: "2017", description: "Beauty. Where I learned to read a sell-through report." },
    ],
    education: [{ school: "UCLA", degree: "BA", field: "Economics", startYear: "2011", endYear: "2015" }],
    projects: [
      { title: "Returnly", description: "Return analytics for DTC brands: which SKU, which size, which page, and what one change would cost you least to fix.", category: "SaaS", goal: "ship_mvp", subcategory: "saas" },
    ],
  },
];
