/**
 * Project vocabulary the phone needs, restated from the web's shared folder.
 *
 * Metro doesn't resolve `@shared/*`, and several of those modules import
 * Drizzle, so the lists are copied here. The server validates every one of
 * them, so a drift shows up as a clear error rather than bad data — but keep
 * them in sync when the originals change:
 *
 *   shared/goals.ts, shared/new-project-steps.ts, shared/investment.ts,
 *   shared/backing.ts, shared/project-visuals.ts
 */

// --- Goals (shared/goals.ts) -----------------------------------------------

export const PROJECT_GOALS = [
  { id: "ship_mvp", label: "Ship an MVP", short: "Ship", description: "Get a first version in front of real people and learn from what they do." },
  { id: "systemize_business", label: "Systemize a business", short: "Systemize", description: "Turn something that already works into something that runs without you in every step." },
  { id: "run_company", label: "Run a company", short: "Run", description: "Keep an existing business on track every week: the numbers, the team's recurring work, and what to fix next." },
] as const;

/** Retired goals and the path that took over their work (shared/goals.ts LEGACY_GOALS). */
export const LEGACY_GOALS: Record<string, ProjectGoal> = { raise_funding: "systemize_business" };

export type ProjectGoal = (typeof PROJECT_GOALS)[number]["id"];

export const PROJECT_SUBCATEGORIES: Record<ProjectGoal, readonly { id: string; label: string }[]> = {
  ship_mvp: [
    { id: "app", label: "App" },
    { id: "saas", label: "SaaS" },
    { id: "game", label: "Game" },
    { id: "website", label: "Website" },
    { id: "other", label: "Other" },
  ],
  systemize_business: [
    { id: "restaurant", label: "Restaurant" },
    { id: "service", label: "Service business" },
    { id: "retail", label: "Retail" },
    { id: "other", label: "Other" },
  ],
  run_company: [
    { id: "restaurant", label: "Restaurant or café" },
    { id: "service", label: "Service business" },
    { id: "retail", label: "Retail or e-commerce" },
    { id: "agency", label: "Agency or studio" },
    { id: "software", label: "Software company" },
    { id: "other", label: "Other" },
  ],
};

/** Validity is always the (goal, subcategory) pair — "other" is shared, "restaurant" isn't. */
export const isValidSubcategory = (goal: string | null | undefined, sub: string | null | undefined): boolean =>
  !!goal && !!sub && (PROJECT_SUBCATEGORIES as Record<string, readonly { id: string }[]>)[goal]?.some((s) => s.id === sub) === true;

export const projectGoal = (id: string | null | undefined) =>
  PROJECT_GOALS.find((g) => g.id === (id && LEGACY_GOALS[id] ? LEGACY_GOALS[id] : id)) ?? PROJECT_GOALS[0];

export const GOAL_ICONS: Record<ProjectGoal, "rocket-outline" | "git-network-outline" | "calendar-outline"> = {
  ship_mvp: "rocket-outline",
  systemize_business: "git-network-outline",
  run_company: "calendar-outline",
};

/** The kind question, worded for its goal, as on the web. */
export const subcategoryQuestion = (goal: string | null | undefined) =>
  goal === "run_company" ? "What kind of company is it?" : goal === "systemize_business" ? "What kind of business is it?" : "What kind of thing are you shipping?";

// --- The stepper (shared/new-project-steps.ts) ------------------------------

export const NEW_PROJECT_STEPS = ["setup", "goal", "subcategory", "review"] as const;
export type NewProjectStep = (typeof NEW_PROJECT_STEPS)[number];
export const STEP_LABELS: Record<NewProjectStep, string> = {
  setup: "Setup", goal: "Goal", subcategory: "Kind", review: "Create",
};

// --- Categories and roles (client/src/pages/project-create.tsx) ------------

export const PROJECT_CATEGORIES = [
  "Web App", "Mobile App", "AI/ML", "SaaS", "Fintech", "Sustainability", "IoT", "Design",
  "Data Analytics", "Marketing", "E-Commerce", "Education", "Healthcare", "Social Media",
  "Gaming", "Blockchain", "Content Creation", "DevOps", "Research", "Nonprofit", "Other",
];

export const AVAILABLE_ROLES = [
  "Frontend Developer", "Backend Developer", "Full Stack Developer", "UI/UX Designer", "Graphic Designer",
  "Product Manager", "Project Manager", "Data Analyst", "Data Scientist", "ML Engineer", "DevOps Engineer",
  "QA Tester", "Technical Writer", "Content Creator", "Marketing Specialist", "Business Analyst",
  "Community Manager", "Mobile Developer", "Game Developer", "Security Engineer", "Cloud Architect",
  "Video Editor", "Illustrator", "Copywriter", "SEO Specialist", "Growth Hacker", "Researcher",
  "Legal Advisor", "Financial Analyst",
];

/** Questions an owner can add in one tap (client/src/pages/project-dashboard.tsx). */
export const PRE_PROMPTED_QUESTIONS = [
  "Why are you interested in joining this project?",
  "What relevant experience do you have?",
  "How many hours per week can you dedicate?",
  "What is your preferred role on this project?",
  "Share a link to a relevant past project or portfolio piece.",
  "What timezone are you in?",
  "Do you have any specific skills related to this project?",
  "What motivates you about this project's mission?",
];

// --- Investment (shared/investment.ts) --------------------------------------

type Opt = readonly { id: string; label: string }[];

export const INVESTMENT_AMOUNTS: Opt = [
  { id: "lt10k", label: "Under $10k" },
  { id: "10k_25k", label: "$10k–$25k" },
  { id: "25k_100k", label: "$25k–$100k" },
  { id: "100k_250k", label: "$100k–$250k" },
  { id: "250k_1m", label: "$250k–$1M" },
  { id: "1m_plus", label: "$1M+" },
];

export const INVESTMENT_INSTRUMENTS: Opt = [
  { id: "equity", label: "Equity" },
  { id: "convertible", label: "SAFE or convertible note" },
  { id: "profit_share", label: "Profit share" },
  { id: "revenue_share", label: "Revenue share" },
  { id: "loan", label: "A loan" },
  { id: "open", label: "Open to discuss" },
];

export const INVESTOR_TYPES: Opt = [
  { id: "individual", label: "Individual" },
  { id: "angel", label: "Angel investor" },
  { id: "network", label: "Angel group or network" },
  { id: "fund", label: "Venture or investment fund" },
  { id: "family_office", label: "Family office" },
  { id: "strategic", label: "Business in the industry" },
  { id: "lender", label: "Lender or CDFI" },
];

export const ACCREDITED_ANSWERS: Opt = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
  { id: "unsure", label: "Not sure" },
];

export type InvestmentStatus = "new" | "reviewing" | "accepted" | "declined" | "withdrawn";

export const INVESTMENT_STATUS_LABEL: Record<InvestmentStatus, string> = {
  new: "New", reviewing: "Reviewing", accepted: "Want to talk", declined: "Declined", withdrawn: "Withdrawn",
};

export const INVESTMENT_MESSAGE_MAX = 2000;

export const labelOf = (list: Opt, id: string | null | undefined) => list.find((x) => x.id === id)?.label ?? id ?? "";

// --- Backing (shared/backing.ts) -------------------------------------------

export const BELIEVER_TAGLINE = "I believe'd in them";
export const TIP_PRESET_PERCENTS = [0, 5, 10, 15, 20] as const;
export const MIN_PLEDGE_CENTS = 100;

export const BADGE_LEVELS = [
  { key: "bronze", label: "Bronze", minCents: 500, hex: "#a8672a" },
  { key: "silver", label: "Silver", minCents: 1500, hex: "#9aa3ad" },
  { key: "gold", label: "Gold", minCents: 3500, hex: "#c9962a" },
  { key: "platinum", label: "Platinum", minCents: 7500, hex: "#8f9bb3" },
] as const;

export const badgeLevelForAmount = (amountCents: number) =>
  [...BADGE_LEVELS].reverse().find((l) => amountCents >= l.minCents) ?? BADGE_LEVELS[0];

export const DIGITAL_REWARD_LABELS: Record<string, string> = {
  backer_wall: "Name on the backer wall",
  believer_number: "Believer number",
  digital_badge: "Digital badge",
  profile_frame: "Profile frame",
  wallpaper: "Wallpaper",
  certificate: "Printable certificate",
  founding_believer: "Founding believer credit",
  early_access: "Early access",
  video_thankyou: "Personal video thank-you",
};

export const MERCH_LABELS: Record<string, string> = {
  sticker_pack: "Sticker pack",
  believer_card: "\"I believe'd in them\" card",
  mug: "Mug",
  pin: "Enamel pin",
  patch: "Embroidered patch",
  shirt: "The shirt",
  tote: "Tote bag",
};

/** The most expensive rung a pledge clears — the amount earns the tier, not the button. */
export function tierForAmount<T extends { amountCents: number }>(tiers: T[], amountCents: number): T | null {
  return tiers.filter((t) => t.amountCents <= amountCents).sort((a, b) => b.amountCents - a.amountCents)[0] ?? null;
}

export const formatBelieverNumber = (n: number) => `#${String(n).padStart(4, "0")}`;

export const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

// --- AI profile visuals (shared/project-visuals.ts) -------------------------

export type ProjectVisualSlot = "oneLiner" | "about" | "success" | "railTop" | "railBottom";

/** The image the public page shows for a slot, or null when there's none or the owner hid it. */
export function projectVisual(visuals: unknown, slot: ProjectVisualSlot): string | null {
  if (!visuals || typeof visuals !== "object") return null;
  const hidden = (visuals as { hidden?: unknown }).hidden;
  if (Array.isArray(hidden) && hidden.includes(slot)) return null;
  const url = (visuals as Record<string, unknown>)[slot];
  return typeof url === "string" && url ? url : null;
}
