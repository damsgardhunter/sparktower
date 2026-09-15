/**
 * Featured tools in the feed: other companies' products, shown between posts
 * the way LinkedIn shows promoted content — a short video about the product
 * and what's new, and a link to its site.
 *
 * The catalog here is the list of companies and what each one is, in plain
 * words. What changes over time — the video, a referral link and its perk, a
 * "what's new" headline, a logo, whether it's shown at all — is set per
 * company on /admin/promotions and stored in `promotion_settings`. Nothing is
 * shown as an offer until a referral link for it has been added.
 *
 * Placement (`planFeedPromotions`) is pure and seeded: the page picks a fresh
 * seed on every visit, so each visit to the home feed shows a different set,
 * and the ones seen recently are skipped until the catalog runs out.
 */
import type { ProjectGoal } from "./goals";

export const PROMOTION_CATEGORIES = [
  { id: "ai_coding", label: "AI coding & app builders" },
  { id: "models", label: "Models & APIs" },
  { id: "hosting", label: "Hosting & infrastructure" },
  { id: "backend", label: "Backend & database" },
  { id: "auth_payments", label: "Auth, payments & email" },
  { id: "design", label: "Design & product" },
  { id: "analytics", label: "Analytics & feedback" },
  { id: "workflow", label: "Workflow & collaboration" },
  { id: "no_code", label: "No-code & automation" },
  { id: "launch", label: "Launch & distribution" },
  { id: "misc", label: "Domains & security" },
] as const;
export type PromotionCategory = (typeof PROMOTION_CATEGORIES)[number]["id"];
export const promotionCategoryLabel = (id: string) => PROMOTION_CATEGORIES.find((c) => c.id === id)?.label ?? id;

export interface CatalogPromotion {
  id: string;
  name: string;
  category: PromotionCategory;
  /** The company's own site. */
  url: string;
  /** What it is, in one line. Replaced in the feed by an admin's "what's new" headline when there is one. */
  tagline: string;
  /** An offer the company runs for referrals — shown only once a referral link is set for it. */
  perk?: string;
  /**
   * False when `url` is a page on someone else's platform (a GitHub repo): its
   * logo and YouTube links are the platform's, not the company's, so the sync
   * reads nothing from it. An admin sets the logo and channel instead.
   */
  readSite?: false;
}

const P = (id: string, name: string, category: PromotionCategory, url: string, tagline: string, perk?: string): CatalogPromotion =>
  ({ id, name, category, url, tagline, ...(perk ? { perk } : {}) });

export const PROMOTION_CATALOG: CatalogPromotion[] = [
  // AI coding / app builders
  P("replit", "Replit", "ai_coding", "https://replit.com", "Build and deploy apps from your browser, with an AI agent that writes the code.", "$10 in credits"),
  P("cursor", "Cursor", "ai_coding", "https://cursor.com", "The AI code editor: chat with, edit and refactor your whole codebase."),
  P("windsurf", "Windsurf", "ai_coding", "https://windsurf.com", "An AI-native code editor with an agent that works through multi-step changes."),
  P("lovable", "Lovable", "ai_coding", "https://lovable.dev", "Describe an app in plain English and get a working full-stack app."),
  P("bolt", "Bolt.new", "ai_coding", "https://bolt.new", "Prompt, run, edit and deploy full-stack web apps right in the browser."),
  P("v0", "v0 by Vercel", "ai_coding", "https://v0.dev", "Vercel's AI builder for React interfaces and full apps from a prompt."),
  P("github-copilot", "GitHub Copilot", "ai_coding", "https://github.com/features/copilot", "An AI pair programmer in your editor and across GitHub."),
  P("claude-code", "Claude Code", "ai_coding", "https://www.anthropic.com/claude-code", "Anthropic's agentic coding tool that works in your terminal and IDE."),
  P("openai-codex", "OpenAI Codex", "ai_coding", "https://openai.com/codex", "OpenAI's coding agent for writing, reviewing and shipping code."),
  { ...P("gemini-cli", "Gemini CLI", "ai_coding", "https://github.com/google-gemini/gemini-cli", "Google's open-source AI agent for the command line."), readSite: false },
  P("devin", "Devin", "ai_coding", "https://devin.ai", "Cognition's autonomous AI software engineer."),
  P("base44", "Base44", "ai_coding", "https://base44.com", "Build full apps with AI from a conversation, no code required."),
  P("softgen", "Softgen", "ai_coding", "https://softgen.ai", "An AI web app builder that turns a description into a full-stack app."),

  // Models / APIs
  P("openai", "OpenAI", "models", "https://platform.openai.com", "GPT models and APIs for text, images, audio and agents."),
  P("anthropic", "Anthropic", "models", "https://www.anthropic.com/api", "The Claude API: models for reasoning, coding and long documents."),
  P("google-ai-studio", "Google AI Studio", "models", "https://aistudio.google.com", "Try Gemini models and get an API key in minutes."),
  P("mistral", "Mistral AI", "models", "https://mistral.ai", "Open-weight and commercial models, available by API."),
  P("groq", "Groq", "models", "https://groq.com", "Very fast inference for open models."),
  P("together-ai", "Together AI", "models", "https://www.together.ai", "Run, fine-tune and deploy open-source models."),
  P("fireworks", "Fireworks AI", "models", "https://fireworks.ai", "Fast, low-cost inference for open models."),
  P("openrouter", "OpenRouter", "models", "https://openrouter.ai", "One API for hundreds of models across providers."),
  P("fal", "fal.ai", "models", "https://fal.ai", "Fast APIs for generative image, video and audio models."),
  P("replicate", "Replicate", "models", "https://replicate.com", "Run open-source models with an API call."),
  P("elevenlabs", "ElevenLabs", "models", "https://elevenlabs.io", "Realistic AI voices, text-to-speech and dubbing."),
  P("hugging-face", "Hugging Face", "models", "https://huggingface.co", "Models, datasets and Spaces from the open ML community."),

  // Hosting / infra
  P("vercel", "Vercel", "hosting", "https://vercel.com", "Deploy frontends and full-stack apps, with a preview for every push."),
  P("netlify", "Netlify", "hosting", "https://www.netlify.com", "Build, deploy and host web projects straight from Git."),
  P("railway", "Railway", "hosting", "https://railway.com", "Deploy apps, databases and workers with almost no config."),
  P("render", "Render", "hosting", "https://render.com", "Host web services, databases, workers and cron jobs."),
  P("fly", "Fly.io", "hosting", "https://fly.io", "Run your app on servers close to your users, worldwide."),
  P("cloudflare", "Cloudflare", "hosting", "https://www.cloudflare.com", "CDN, security, and Workers to run code at the edge."),
  P("digitalocean", "DigitalOcean", "hosting", "https://www.digitalocean.com", "Simple cloud servers, managed databases and app hosting."),
  P("hetzner", "Hetzner", "hosting", "https://www.hetzner.com", "Low-cost cloud and dedicated servers."),
  P("aws-activate", "AWS Activate", "hosting", "https://aws.amazon.com/startups", "Amazon Web Services' program for startups."),
  P("google-cloud-startups", "Google Cloud for Startups", "hosting", "https://cloud.google.com/startup", "Google Cloud's program for startups."),
  P("azure-startups", "Microsoft for Startups", "hosting", "https://www.microsoft.com/en-us/startups", "Microsoft's program for startups, including Azure."),

  // Backend / database
  P("supabase", "Supabase", "backend", "https://supabase.com", "Postgres with auth, storage, realtime and edge functions."),
  P("firebase", "Firebase", "backend", "https://firebase.google.com", "Google's app platform: auth, databases, hosting and more."),
  P("convex", "Convex", "backend", "https://www.convex.dev", "A reactive backend: database, functions and sync, in TypeScript."),
  P("planetscale", "PlanetScale", "backend", "https://planetscale.com", "Managed databases built to scale."),
  P("neon", "Neon", "backend", "https://neon.tech", "Serverless Postgres with branching."),
  P("turso", "Turso", "backend", "https://turso.tech", "SQLite for production, close to your users."),
  P("mongodb-atlas", "MongoDB Atlas", "backend", "https://www.mongodb.com/atlas", "MongoDB's managed cloud database."),
  P("upstash", "Upstash", "backend", "https://upstash.com", "Serverless Redis, queues and vector storage."),
  P("xata", "Xata", "backend", "https://xata.io", "A Postgres platform for developers."),

  // Auth / payments / email
  P("clerk", "Clerk", "auth_payments", "https://clerk.com", "Drop-in authentication and user management."),
  P("auth0", "Auth0", "auth_payments", "https://auth0.com", "Authentication and authorization, by Okta."),
  P("workos", "WorkOS", "auth_payments", "https://workos.com", "Enterprise-ready auth: SSO, directory sync and more."),
  P("stripe", "Stripe", "auth_payments", "https://stripe.com", "Online payments, subscriptions and billing."),
  P("lemon-squeezy", "Lemon Squeezy", "auth_payments", "https://www.lemonsqueezy.com", "Sell software and digital products, with sales tax handled."),
  P("paddle", "Paddle", "auth_payments", "https://www.paddle.com", "A merchant of record for SaaS billing and tax."),
  P("polar", "Polar", "auth_payments", "https://polar.sh", "Payments and subscriptions built for developers."),
  P("resend", "Resend", "auth_payments", "https://resend.com", "An email API for developers."),
  P("postmark", "Postmark", "auth_payments", "https://postmarkapp.com", "Fast, reliable transactional email."),
  P("loops", "Loops", "auth_payments", "https://loops.so", "Email for SaaS: product, marketing and transactional."),

  // Design / product
  P("figma", "Figma", "design", "https://www.figma.com", "Design, prototype and collaborate in the browser."),
  P("framer", "Framer", "design", "https://www.framer.com", "Design and publish websites visually."),
  P("webflow", "Webflow", "design", "https://webflow.com", "Build professional websites visually, with a CMS."),
  P("canva", "Canva", "design", "https://www.canva.com", "Design graphics, presentations and videos."),
  P("mobbin", "Mobbin", "design", "https://mobbin.com", "A library of real app screens and flows for design reference."),
  P("lottiefiles", "LottieFiles", "design", "https://lottiefiles.com", "Lightweight Lottie animations for web and apps."),
  P("spline", "Spline", "design", "https://spline.design", "Design interactive 3D for the web."),
  P("rive", "Rive", "design", "https://rive.app", "Interactive animations that run in apps, games and sites."),

  // Analytics / feedback / growth
  P("posthog", "PostHog", "analytics", "https://posthog.com", "Product analytics, session replay, feature flags and experiments."),
  P("plausible", "Plausible", "analytics", "https://plausible.io", "Simple, privacy-friendly web analytics."),
  P("mixpanel", "Mixpanel", "analytics", "https://mixpanel.com", "Product analytics for funnels, retention and growth."),
  P("amplitude", "Amplitude", "analytics", "https://amplitude.com", "Digital analytics for product teams."),
  P("hotjar", "Hotjar", "analytics", "https://www.hotjar.com", "Heatmaps, recordings and surveys."),
  P("sentry", "Sentry", "analytics", "https://sentry.io", "Error tracking and performance monitoring."),
  P("logrocket", "LogRocket", "analytics", "https://logrocket.com", "Session replay and analytics for frontends."),
  P("featurebase", "Featurebase", "analytics", "https://www.featurebase.app", "Feedback boards, roadmaps and changelogs."),
  P("canny", "Canny", "analytics", "https://canny.io", "Collect, organize and prioritize customer feedback."),

  // Workflow / collaboration
  P("linear", "Linear", "workflow", "https://linear.app", "Issue tracking and planning for software teams."),
  P("notion", "Notion", "workflow", "https://www.notion.com", "Docs, wikis and projects in one workspace."),
  P("slack", "Slack", "workflow", "https://slack.com", "Team messaging, organized in channels."),
  P("discord", "Discord", "workflow", "https://discord.com", "Voice, video and text for communities."),
  P("loom", "Loom", "workflow", "https://www.loom.com", "Record quick video messages of your screen."),
  P("cal-com", "Cal.com", "workflow", "https://cal.com", "Open-source scheduling."),
  P("zapier", "Zapier", "workflow", "https://zapier.com", "Connect your apps and automate workflows."),
  P("n8n", "n8n", "workflow", "https://n8n.io", "Workflow automation you can self-host."),
  P("make", "Make", "workflow", "https://www.make.com", "Visual automation across your apps."),

  // No-code / automation
  P("bubble", "Bubble", "no_code", "https://bubble.io", "Build web apps visually, without code."),
  P("glide", "Glide", "no_code", "https://www.glideapps.com", "Turn your data into apps without code."),
  P("softr", "Softr", "no_code", "https://www.softr.io", "Build portals and internal tools on top of your data."),
  P("airtable", "Airtable", "no_code", "https://www.airtable.com", "A spreadsheet-database for apps and workflows."),
  P("retool", "Retool", "no_code", "https://retool.com", "Build internal tools on your databases and APIs."),
  P("flutterflow", "FlutterFlow", "no_code", "https://www.flutterflow.io", "Build Flutter apps visually."),

  // Launch / distribution
  P("product-hunt", "Product Hunt", "launch", "https://www.producthunt.com", "Launch your product and find early users."),
  P("show-hn", "Show HN", "launch", "https://news.ycombinator.com/show", "Share what you built with the Hacker News community."),
  P("indie-hackers", "Indie Hackers", "launch", "https://www.indiehackers.com", "A community of founders building profitable businesses."),
  P("betalist", "BetaList", "launch", "https://betalist.com", "Get your early-stage startup in front of early adopters."),
  P("peerlist", "Peerlist", "launch", "https://peerlist.io", "A professional network for builders, with weekly launches."),
  P("x", "X", "launch", "https://x.com", "Build in public and reach people where the conversation is."),
  P("linkedin", "LinkedIn", "launch", "https://www.linkedin.com", "Share your progress with a professional network."),

  // Domains / misc
  P("namecheap", "Namecheap", "misc", "https://www.namecheap.com", "Domains, hosting and SSL certificates."),
  P("porkbun", "Porkbun", "misc", "https://porkbun.com", "A domain registrar with low prices."),
  P("cloudflare-registrar", "Cloudflare Registrar", "misc", "https://www.cloudflare.com/products/registrar/", "Register domains at cost, with no markup."),
  P("1password", "1Password", "misc", "https://1password.com", "A password manager for people and teams."),
  P("tailscale", "Tailscale", "misc", "https://tailscale.com", "Private networks between your devices and servers."),
];

/** The categories that matter most to each goal: weighted up when choosing what to show. */
export const GOAL_AFFINITY: Record<ProjectGoal, PromotionCategory[]> = {
  ship_mvp: ["ai_coding", "models", "hosting", "backend", "auth_payments", "design", "launch"],
  systemize_business: ["workflow", "no_code", "analytics", "auth_payments", "misc"],
  raise_funding: ["launch", "analytics", "hosting", "design"],
};

/** A promotion as the feed shows it: the catalog entry with what an admin set for it. */
export interface FeedPromotion extends CatalogPromotion {
  headline: string | null;
  videoUrl: string | null;
  referralUrl: string | null;
  logoUrl: string | null;
  /** The perk, only when there's a referral link to claim it through. */
  offer: string | null;
}

// ─── Video links ─────────────────────────────────────────────────────────────

export type PromoVideo =
  | { kind: "youtube"; id: string; embedUrl: string; posterUrl: string }
  | { kind: "vimeo"; id: string; embedUrl: string }
  | { kind: "file"; src: string };

/** A video link an admin pasted, as something the feed can play — or null when it isn't one it can. */
export function parsePromoVideo(raw: string | null | undefined): PromoVideo | null {
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "");
  const yt = (id: string | null | undefined): PromoVideo | null => id && /^[A-Za-z0-9_-]{11}$/.test(id)
    ? { kind: "youtube", id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`, posterUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }
    : null;
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") return yt(url.searchParams.get("v"));
    const m = /^\/(?:embed|shorts|live)\/([^/?#]+)/.exec(url.pathname);
    return yt(m?.[1]);
  }
  if (host === "youtu.be") return yt(url.pathname.slice(1).split("/")[0]);
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = /(\d{6,12})/.exec(url.pathname)?.[1];
    return id ? { kind: "vimeo", id, embedUrl: `https://player.vimeo.com/video/${id}?autoplay=1&title=0&byline=0` } : null;
  }
  if (/\.(mp4|webm)$/i.test(url.pathname)) return { kind: "file", src: url.toString() };
  return null;
}

// ─── What an admin can set ───────────────────────────────────────────────────

export const PROMO_HEADLINE_MAX = 140;
export const PROMO_PERK_MAX = 40;

export interface PromotionSettingsInput {
  headline?: string | null;
  videoUrl?: string | null;
  referralUrl?: string | null;
  logoUrl?: string | null;
  perk?: string | null;
  youtubeChannelUrl?: string | null;
  active?: boolean;
}

const httpsUrl = (v: string) => { try { return new URL(v).protocol === "https:"; } catch { return false; } };

/** Cleans an admin's edit, or says which field is wrong. Empty strings clear a field. */
export function validatePromotionSettings(raw: Record<string, unknown>):
  | { ok: true; value: Required<{ [K in keyof PromotionSettingsInput]: PromotionSettingsInput[K] }> }
  | { ok: false; field: string; message: string } {
  const text = (v: unknown) => (v == null ? null : String(v).trim() || null);
  const headline = text(raw.headline), videoUrl = text(raw.videoUrl), referralUrl = text(raw.referralUrl), logoUrl = text(raw.logoUrl), perk = text(raw.perk), youtubeChannelUrl = text(raw.youtubeChannelUrl);
  if (youtubeChannelUrl && !/^https:\/\/(www\.)?youtube\.com\/(@[A-Za-z0-9_.-]{2,100}|channel\/UC[A-Za-z0-9_-]{22}|c\/[A-Za-z0-9_.-]{1,100}|user\/[A-Za-z0-9_.-]{1,100})\/?$/.test(youtubeChannelUrl)) {
    return { ok: false, field: "youtubeChannelUrl", message: "Use the channel's link, like https://www.youtube.com/@company." };
  }
  if (headline && headline.length > PROMO_HEADLINE_MAX) return { ok: false, field: "headline", message: `Keep the headline under ${PROMO_HEADLINE_MAX} characters.` };
  if (perk && perk.length > PROMO_PERK_MAX) return { ok: false, field: "perk", message: `Keep the perk under ${PROMO_PERK_MAX} characters.` };
  if (videoUrl && !parsePromoVideo(videoUrl)) return { ok: false, field: "videoUrl", message: "Use a YouTube or Vimeo link, or an https link to an .mp4 or .webm file." };
  if (referralUrl && !httpsUrl(referralUrl)) return { ok: false, field: "referralUrl", message: "The referral link must start with https://." };
  if (logoUrl && !httpsUrl(logoUrl)) return { ok: false, field: "logoUrl", message: "The logo link must start with https://." };
  return { ok: true, value: { headline, videoUrl, referralUrl, logoUrl, perk, youtubeChannelUrl, active: raw.active === undefined ? true : raw.active === true } };
}

// ─── Placement ───────────────────────────────────────────────────────────────

/** A small seeded random number generator (mulberry32): the same seed, the same feed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PROMO_FIRST_SLOT_CHANCE = 0.8;
/** Posts between promotions, at least and at most. */
export const PROMO_GAP = { min: 4, max: 6 } as const;
/** How many shown promotions a viewer's browser remembers, to rotate past them. */
export const PROMO_SEEN_MEMORY = 24;

export interface PromotionPlacement<T extends { id: string; category: string }> {
  /** Where each promotion goes: before the post at this index (postCount means after the last). */
  slots: { beforeIndex: number; promotion: T }[];
}

/**
 * Where promotions go in a feed of `postCount` posts, and which. Usually one
 * at the very top (otherwise after the first post), then one every 4–6 posts.
 * Chosen by a weighted draw — the viewer's goals count double — skipping what
 * they've seen recently until nothing unseen is left, and never two from the
 * same category back to back.
 */
export function planFeedPromotions<T extends { id: string; category: string }>(opts: {
  promotions: T[];
  postCount: number;
  seed: number;
  goals?: string[];
  recentlySeen?: string[];
  hidden?: string[];
}): PromotionPlacement<T> {
  const rand = seededRandom(opts.seed);
  const hidden = new Set(opts.hidden ?? []);
  const pool = opts.promotions.filter((p) => !hidden.has(p.id));
  if (!pool.length || opts.postCount < 1) return { slots: [] };

  const favoured = new Set<string>((opts.goals ?? []).flatMap((g) => GOAL_AFFINITY[g as ProjectGoal] ?? []));
  const seen = new Set(opts.recentlySeen ?? []);
  // Weighted shuffle (Efraimidis–Spirakis): higher weight, earlier on average.
  const order = (items: T[]) => items
    .map((p) => ({ p, key: Math.pow(rand(), 1 / (favoured.has(p.category) ? 2 : 1)) }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.p);
  const queue = [...order(pool.filter((p) => !seen.has(p.id))), ...order(pool.filter((p) => seen.has(p.id)))];

  const positions: number[] = [];
  let at = rand() < PROMO_FIRST_SLOT_CHANCE ? 0 : 1;
  while (at <= opts.postCount) {
    positions.push(at);
    at += PROMO_GAP.min + Math.floor(rand() * (PROMO_GAP.max - PROMO_GAP.min + 1));
  }

  const slots: PromotionPlacement<T>["slots"] = [];
  let lastCategory: string | null = null;
  for (const beforeIndex of positions) {
    if (!queue.length) break;
    // The first in the queue from a different category than the last shown; any, if none is.
    const i = queue.findIndex((p) => p.category !== lastCategory);
    const [promotion] = queue.splice(i >= 0 ? i : 0, 1);
    slots.push({ beforeIndex, promotion });
    lastCategory = promotion.category;
  }
  return { slots };
}

/** The remembered list after showing `shown`: newest first, deduplicated, capped. */
export function rememberSeen(previous: string[], shown: string[]): string[] {
  return [...new Set([...shown, ...previous])].slice(0, PROMO_SEEN_MEMORY);
}

// ─── Events ──────────────────────────────────────────────────────────────────

/** What the browser reports about featured tools: seen, visited, video played. */
export const PROMO_EVENTS = {
  impression: "promo.impression",
  click: "promo.click",
  videoPlay: "promo.video_play",
} as const;
export const PROMO_EVENT_NAMES: string[] = Object.values(PROMO_EVENTS);

/** A promo event keeps which promotion, where in the feed, and whether the click was a referral link — nothing else. */
export function sanitizePromoProps(raw: unknown): { promotionId: string; slot: number; referral: boolean } | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const promotionId = typeof r.promotionId === "string" && PROMOTION_CATALOG.some((c) => c.id === r.promotionId) ? r.promotionId : null;
  if (!promotionId) return null;
  const slot = Number.isInteger(r.slot) && (r.slot as number) >= 0 && (r.slot as number) < 1000 ? (r.slot as number) : 0;
  return { promotionId, slot, referral: r.referral === true };
}
