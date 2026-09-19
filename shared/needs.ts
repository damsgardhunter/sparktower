/**
 * The things a founder needs from outside this product, as a fixed vocabulary.
 *
 * Nova names a need. It never names a URL.
 *
 * That is the whole design, and it is a safety decision rather than a tidiness
 * one. A model asked for "a link to form an LLC" will produce a plausible URL
 * every time, and some of the time that URL will be a typosquat, a dead
 * redirect, or a company that no longer exists — handed to someone who is
 * about to type their legal name, address and payment details into it because
 * their business guide told them to. So the model's job is to recognise the
 * moment ("this person needs a domain now"), and the app's job is to answer
 * with a link from a list a human curated (@shared/tool-directory).
 *
 * The cost is real and worth naming: Nova can only point at what the directory
 * covers. A need with no entries shows nothing rather than guessing, which is
 * the right failure — silence is recoverable, a bad link isn't.
 *
 * Ordering matters as much as coverage. Most founders do not need an LLC on
 * day one, and a product that offers one at signup is selling them something
 * before they have anything to protect. `typicalStage` is what keeps this a
 * sequence rather than a directory dump.
 */
import type { ProjectGoal } from "./goals";

/** Roughly when a need arrives. Not a rule — a default for ordering and for deciding what to offer unprompted. */
export type Stage =
  | "deciding"      // still working out what the thing is
  | "building"      // making the first version
  | "launching"     // putting it in front of people
  | "earning"       // taking money
  | "formalising";  // the business as a legal and financial entity

export const STAGE_ORDER: Stage[] = ["deciding", "building", "launching", "earning", "formalising"];

/**
 * How much care a recommendation needs.
 *
 * `advice` marks the needs where being wrong costs money or creates legal
 * exposure — entity type, tax, contracts. This product is not a lawyer or an
 * accountant, and the honest position is to name the options, say what they
 * cost, and say plainly that the choice between them is one for a professional
 * when it matters. Anything marked `advice` must carry that alongside it.
 */
export type Sensitivity = "ordinary" | "advice";

export interface Need {
  id: string;
  /** What to call it in front of a person. */
  label: string;
  /** One sentence a founder who has never heard the term would understand. */
  plain: string;
  typicalStage: Stage;
  sensitivity: Sensitivity;
  /**
   * True when the right answer depends on the country the founder is in.
   * Everything about forming a company is; a code editor isn't.
   */
  jurisdictional: boolean;
  /**
   * What someone can do instead of paying anyone, when that exists. The most
   * useful sentence on the whole card, and the one a directory that earns
   * commission would rather not print.
   */
  freeRoute?: string;
  /** Paths where this comes up at all. Absent means all of them. */
  goals?: ProjectGoal[];
  /** Phrases that suggest this need, for steering Nova and for search. Not a classifier — a hint. */
  cues: string[];
}

/**
 * The vocabulary. Adding to it is cheap; changing an `id` is not, because
 * saved recommendations and Nova's own output reference these strings.
 */
export const NEEDS: Need[] = [
  // ─── Deciding ──────────────────────────────────────────────────────────
  {
    id: "market-research",
    label: "Working out if anyone wants it",
    plain: "Finding out whether the problem you're solving is one people already look for help with.",
    typicalStage: "deciding",
    sensitivity: "ordinary",
    jurisdictional: false,
    freeRoute: "Search what people already ask about it. Reddit, forums and search-suggestion tools cost nothing and are where the honest complaints are.",
    cues: ["is there a market", "does anyone want", "validate the idea", "competitors", "research"],
  },

  // ─── Building ──────────────────────────────────────────────────────────
  {
    id: "build-first-version",
    label: "Building the first version",
    plain: "The tool you'll actually make the thing in — whether you write code or not.",
    typicalStage: "building",
    sensitivity: "ordinary",
    jurisdictional: false,
    cues: ["how do i build", "start coding", "no-code", "editor", "ide", "first version", "mvp"],
  },
  {
    id: "domain",
    label: "A domain name",
    plain: "The address people type to reach you, like yourname.com.",
    typicalStage: "building",
    sensitivity: "ordinary",
    jurisdictional: false,
    freeRoute: "Most hosts give you a free address to start on (yourapp.onrender.com). It's enough until you have something to show — buy the name when you're ready to tell people.",
    cues: ["domain", "buy a domain", "url", ".com", "website address", "dns"],
  },
  {
    id: "hosting",
    label: "Somewhere to put it online",
    plain: "The service that runs your site or app so other people can open it.",
    typicalStage: "building",
    sensitivity: "ordinary",
    jurisdictional: false,
    freeRoute: "Every host here has a free tier that's fine for something nobody uses yet. Pay when real traffic or a background job needs it awake.",
    cues: ["deploy", "hosting", "put it online", "go live", "server"],
  },
  {
    id: "design-assets",
    label: "Design and images",
    plain: "The look of it: a logo, colours, screenshots, the picture that shows when you share a link.",
    typicalStage: "building",
    sensitivity: "ordinary",
    jurisdictional: false,
    cues: ["logo", "design", "icon", "screenshot", "brand", "colours", "colors"],
  },

  // ─── Launching ─────────────────────────────────────────────────────────
  {
    id: "email-sending",
    label: "Sending email from your product",
    plain: "The service that delivers the confirm-your-address and password-reset mail your product sends.",
    typicalStage: "launching",
    sensitivity: "ordinary",
    jurisdictional: false,
    cues: ["send email", "transactional email", "password reset email", "smtp", "deliverability"],
  },
  {
    id: "analytics",
    label: "Seeing what people do",
    plain: "Knowing how many people came, what they did, and where they gave up.",
    typicalStage: "launching",
    sensitivity: "ordinary",
    jurisdictional: false,
    cues: ["analytics", "how many visitors", "tracking", "metrics", "conversion"],
  },
  {
    id: "launch-distribution",
    label: "Telling people it exists",
    plain: "The places a first audience actually comes from.",
    typicalStage: "launching",
    sensitivity: "ordinary",
    jurisdictional: false,
    freeRoute: "The places that matter most cost nothing to post on. What they cost is the nerve to post.",
    cues: ["launch", "product hunt", "get users", "marketing", "first customers", "promote"],
  },
  {
    id: "app-store",
    label: "Publishing a mobile app",
    plain: "Getting an app onto the iPhone or Android stores, which both require a paid developer account.",
    typicalStage: "launching",
    sensitivity: "ordinary",
    jurisdictional: false,
    cues: ["app store", "play store", "publish app", "testflight", "ios app", "android app"],
  },

  // ─── Earning ───────────────────────────────────────────────────────────
  {
    id: "payments",
    label: "Taking payment",
    plain: "How money gets from a customer to you.",
    typicalStage: "earning",
    sensitivity: "ordinary",
    jurisdictional: true,
    cues: ["take payment", "charge", "stripe", "subscription", "checkout", "sell"],
  },
  {
    id: "sales-tax",
    label: "Sales tax and VAT",
    plain: "The tax you may have to collect from customers depending on where they are — not the tax you pay on profit.",
    typicalStage: "earning",
    sensitivity: "advice",
    jurisdictional: true,
    freeRoute: "Some payment services handle this for you by being the seller of record, which removes the problem rather than solving it.",
    cues: ["sales tax", "vat", "gst", "tax on sales", "merchant of record"],
  },

  // ─── Formalising ───────────────────────────────────────────────────────
  {
    id: "business-entity",
    label: "Making it a company",
    plain: "Registering a business so it exists separately from you — which is what stops a business debt becoming a personal one.",
    typicalStage: "formalising",
    sensitivity: "advice",
    jurisdictional: true,
    freeRoute: "You can file directly with the state or registry yourself and pay only the filing fee. A formation service is buying convenience, not something you cannot do.",
    cues: ["llc", "incorporate", "form a company", "limited company", "register a business", "sole trader", "s-corp"],
  },
  {
    id: "tax-id",
    label: "A tax number for the business",
    plain: "The number a bank and the tax office use to identify the business rather than you.",
    typicalStage: "formalising",
    sensitivity: "advice",
    jurisdictional: true,
    freeRoute: "In the US the IRS issues an EIN free, online, in minutes. Anyone charging you for one is charging you to fill in a form.",
    cues: ["ein", "tax id", "utr", "vat number", "employer identification"],
  },
  {
    id: "business-banking",
    label: "A business bank account",
    plain: "Keeping the business's money apart from your own, which is what makes the accounting possible and the entity meaningful.",
    typicalStage: "formalising",
    sensitivity: "advice",
    jurisdictional: true,
    cues: ["business bank", "business account", "separate the money", "mercury", "banking"],
  },
  {
    id: "accounting",
    label: "Bookkeeping and tax filing",
    plain: "Keeping a record of money in and out, and filing what's owed.",
    typicalStage: "formalising",
    sensitivity: "advice",
    jurisdictional: true,
    freeRoute: "A spreadsheet is a legitimate way to start. What matters at first is that every transaction is recorded somewhere, not which software records it.",
    cues: ["accounting", "bookkeeping", "taxes", "accountant", "invoice", "expenses"],
  },
  {
    id: "contracts",
    label: "Contracts and signatures",
    plain: "Written terms with a customer, a contractor or a co-founder, signed in a way that counts.",
    typicalStage: "formalising",
    sensitivity: "advice",
    jurisdictional: true,
    freeRoute: "Standard free templates exist for the common cases — a mutual NDA, a contractor agreement, a fundraising SAFE — written by law firms and given away. Start from one rather than from nothing.",
    cues: ["contract", "nda", "terms of service", "agreement", "sign", "co-founder split"],
  },
  {
    id: "trademark",
    label: "Protecting the name",
    plain: "Registering the name so someone else can't trade under it — different from owning the domain.",
    typicalStage: "formalising",
    sensitivity: "advice",
    jurisdictional: true,
    freeRoute: "Searching the register to check nobody already owns the name is free, and is the step that matters before you print anything.",
    cues: ["trademark", "protect the name", "ip", "copyright the name", "someone else using"],
  },
  {
    id: "insurance",
    label: "Business insurance",
    plain: "Cover for the kinds of claim a business can face — usually asked for by a client's contract before you think of it yourself.",
    typicalStage: "formalising",
    sensitivity: "advice",
    jurisdictional: true,
    cues: ["insurance", "liability", "e&o", "professional indemnity", "client requires insurance"],
  },
];

const BY_ID = new Map(NEEDS.map((n) => [n.id, n]));

export const needById = (id: string | null | undefined): Need | null => (id ? BY_ID.get(id) ?? null : null);

export const isNeedId = (value: unknown): value is string => typeof value === "string" && BY_ID.has(value);

/** Every id, for the prompt that tells Nova what it may name. Sorted by when it arrives, so the list reads as a journey. */
export const NEED_IDS = [...NEEDS]
  .sort((a, b) => STAGE_ORDER.indexOf(a.typicalStage) - STAGE_ORDER.indexOf(b.typicalStage))
  .map((n) => n.id);

/** Needs whose right answer depends on where the founder is. */
export const isJurisdictional = (id: string): boolean => !!BY_ID.get(id)?.jurisdictional;

/**
 * The sentence that goes beside anything marked `advice`.
 *
 * Not boilerplate anyone can ignore — it says what this product is and isn't,
 * and it's the difference between "here's what these cost" and "here's what
 * you should do", which is the line a product without lawyers must not cross.
 */
export const ADVICE_NOTE =
  "This is a list of the options and what they cost, not advice about which to choose. Whether you need one, and which, depends on where you live and what you're building — worth an hour of a professional's time before you spend more than that on the wrong thing.";
