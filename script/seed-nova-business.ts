/**
 * The platform's own AI account: Nova Business.
 *
 * One account, created and kept up to date by this script, that authors the
 * custom simulations the platform sells and appears as their seller. It is not
 * a person and does not pretend to be one — `is_bot` is set, which is the
 * column every candidate pool, name search and Discover query already filters
 * on (`shared/bots.ts` has the rules the product's bots are built to).
 *
 * ## Why a script rather than signing up
 *
 * Three of the things this account needs cannot be done through the sign-up
 * flow, and two of them should not be:
 *
 *   - `is_bot` has no form. It is set here or it is not set, and without it the
 *     account turns up in co-founder matching as a candidate, which is the
 *     product introducing somebody to an account nobody is behind.
 *   - The address is deliberately unroutable (`…@bots.sparktower.invalid`, the
 *     same convention as the rest of the cast), so the confirmation mail that
 *     normally proves an address can never arrive. Publishing a listing needs
 *     a confirmed address (server/email-verification.ts), so the column is set
 *     directly, which is honest here precisely because there is no inbox to
 *     mislead anybody about.
 *   - The seller agreement is a consent record. It is written here because the
 *     party agreeing is the platform itself rather than a third-party seller —
 *     and `accepted_ip` is left null rather than invented, so the row does not
 *     claim a provenance it does not have.
 *
 * ## What this deliberately does not do
 *
 * It does not fabricate a builder index, and there is no flag here that will.
 *
 * The index is derived, not stored: `refreshReputation` recomputes it from rows
 * every hour for anybody whose work has moved, so a number written straight
 * into `user_reputation_scores` is overwritten by the next pass. Holding a 100
 * means holding the evidence, and the evidence for two of the four pillars is
 * other people's: the market pillar wants 50 distinct backers and 200
 * followers, and the contribution pillar wants 60 finished tasks across 8
 * *other* people's projects plus 40 pieces of feedback other people thanked you
 * for. `script/seed-max-reputation.ts` does produce all of that, which is why
 * it refuses to run anywhere that is not local and refuses to run for anybody
 * but the creator: on a live database those backers are real accounts being
 * made to look as though they paid — and they are awarded backer badges for it
 * — and those task completions land on real strangers' project boards.
 *
 * On a development database that is all fine, and that is where to do it: the
 * fabricated backers come from the bot cast first (`order by is_bot desc`), so
 * mostly nobody is misrepresented.
 *
 *   DATABASE_URL=…dev npx tsx script/seed-max-reputation.ts novabusiness --apply
 *
 * What this account earns for real is the strategy pillar — markets played and
 * contests won are its actual job — so its index on a live database will climb
 * on its own as it sells simulations, and every point of it will be true.
 *
 * Idempotent. Run it again after editing the résumé below and it updates in
 * place; nothing here depends on being the first run.
 *
 *   DATABASE_URL=… npx tsx script/seed-nova-business.ts
 *   DATABASE_URL=… npx tsx script/seed-nova-business.ts --apply
 *   DATABASE_URL=… npx tsx script/seed-nova-business.ts --apply --login
 */
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { users, userProfiles, sellerAgreements } from "@shared/schema";
import type { ProfileExperience, ProfileEducation, ProfilePortfolioProject } from "@shared/schema";
import { SELLER_TERMS_VERSION } from "@shared/simulation-market-terms";
import { missingOnboarding } from "@shared/onboarding";

const apply = process.argv.includes("--apply");
const allowRemote = process.argv.includes("--allow-remote");
/*
 * Give it a password so a person can sign in and drive it from the UI.
 *
 * Off by default. The rest of the cast has no password and no provider, so
 * nothing can sign in as one; this account is different only because the
 * marketplace is operated through the product's own screens — writing a
 * listing, pricing it, answering a buyer — and there is no admin surface that
 * does those as somebody else. The password is read from NOVA_BUSINESS_PASSWORD
 * rather than taken on the command line, where it would land in a shell
 * history.
 */
const wantsLogin = process.argv.includes("--login");

/** The address, matching the rest of the cast: unroutable on purpose. */
const EMAIL = "nova-business@bots.sparktower.invalid";
const USERNAME = "novabusiness";
const DISPLAY_NAME = "Nova Business";

/**
 * Refuse to write to anything that is not plainly local, unless told.
 *
 * Same shape as seed-max-reputation's guard and for a weaker reason: this
 * script writes nothing about anybody else, so running it against production is
 * a legitimate thing to want — that is where the account has to exist. It is
 * still a flag you type, because creating an account that will appear beside
 * real ones is not a thing to do by accident.
 */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"];

export const isLocal = (url: string): boolean => LOCAL_HOSTS.includes(new URL(url).hostname);

function assertIntentional(url: string): void {
  if (isLocal(url) || allowRemote) return;
  throw new Error(
    `${host} does not look like a local database.\n`
    + "This creates an account that will appear beside real ones. Add --allow-remote if that is what you mean.",
  );
}

/**
 * The résumé.
 *
 * Written as what this account actually does, which is the only version of it
 * that stays true. An invented employment history would read better and would
 * be the one thing on the profile that a buyer could catch out — and a seller
 * caught inventing its credentials is a worse first impression than one with a
 * short, accurate history.
 *
 * No education. A model has no school, and the field exists to say where a
 * person studied; filling it in with the model it runs on would be a joke the
 * profile makes once and then has to keep making.
 */
const HEADLINE = "AI simulation designer · builds the custom markets SparkTower sells";

const BIO = [
  "I'm SparkTower's own AI account. I build the custom business simulations people",
  "play here: the market a business actually operates in, the rivals already in it,",
  "and the settings that turn it into a contest worth losing.",
  "",
  "Everything listed under my name was generated for a specific business and then",
  "run before it was sold. If you bought a simulation from SparkTower, I wrote it.",
].join("\n");

const NOVA_SUMMARY = [
  "Designs and tests custom market simulations end to end: segment and region modelling,",
  "competitor rosters, pricing and demand curves, and the season settings that decide how",
  "hard a market is to win. Works from a real business's own shape rather than a template,",
  "and plays each market through before it is listed.",
].join(" ");

const SKILLS = [
  "Market simulation", "Competitive modelling", "Pricing strategy", "Scenario design",
  "Demand forecasting", "Unit economics", "Game balance", "Business analysis",
];

const INTERESTS = ["SaaS", "Entrepreneurship", "Fintech", "Open Source"];

const EXPERIENCE: ProfileExperience[] = [
  {
    title: "Simulation designer",
    company: "SparkTower",
    current: true,
    startDate: "2026",
    description:
      "Builds the custom markets sold through the simulation marketplace. For each one: the "
      + "segments and regions a business really competes in, the companies already holding share, "
      + "and the season settings — how often the table decides, how good the rivals are, whether "
      + "companies open funded or on what the work has earned. Each market is played through "
      + "before it is listed.",
    skills: ["Market simulation", "Competitive modelling", "Game balance"],
  },
  {
    title: "Business partner to builders",
    company: "SparkTower",
    current: true,
    startDate: "2025",
    description:
      "Works a project from its goal to the week in front of it: the phase tree it is on, what "
      + "the next step is, and what it would take. Reads a business's capital position as a "
      + "constraint rather than a preference — an owner who will not take debt is not offered it.",
    skills: ["Business analysis", "Unit economics", "Scenario design"],
  },
];

const EDUCATION: ProfileEducation[] = [];

const PORTFOLIO: ProfilePortfolioProject[] = [
  {
    name: "Custom market generator",
    role: "Designer",
    description:
      "Writes a playable market from one business's own shape — segments, regions, incumbents "
      + "and their share — instead of dropping it into a generic industry template.",
    technologies: ["Market simulation", "Scenario design"],
  },
  {
    name: "Season balance passes",
    role: "Designer",
    description:
      "Plays each market before it is sold, looking for the two failures that make a simulation "
      + "worthless: a dominant strategy, and a market nobody can move at all.",
    technologies: ["Game balance", "Demand forecasting"],
  },
];

/** The five answers co-founder matching reads (shared/onboarding.ts). */
const WORK_STYLE = {
  hoursPerWeek: 40,
  riskTolerance: "moderate" as const,
  scheduleStyle: "structured" as const,
  speedVsPolish: "balanced" as const,
  conflictStyle: "direct" as const,
  builderType: "long-term" as const,
  experienceLevel: "expert" as const,
};

/**
 * Create or update the account. Exported so a test can drive the real thing
 * rather than a copy of it — the shape of these rows is the whole point of this
 * script, and a test that built its own would prove nothing about it.
 */
/**
 * Whether the simulation marketplace has been migrated here yet.
 *
 * It had not been, on production, when this script was written: `users` and
 * `user_profiles` were there and `seller_agreements` and `simulation_listings`
 * were not, because the marketplace work has not been deployed. The account is
 * still worth creating without them — it is a profile people will see — but the
 * seller agreement cannot be recorded and nothing can be listed until the
 * migrations land, and the script says so rather than failing halfway through
 * with a missing-relation error.
 */
async function hasMarketplace(): Promise<boolean> {
  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text n from information_schema.tables
     where table_schema = 'public' and table_name in ('seller_agreements', 'simulation_listings')`,
  );
  return Number(rows[0]?.n ?? 0) === 2;
}

export async function seedNovaBusiness(
  opts: { password?: string; devUnlimited?: boolean } = {},
): Promise<{ id: string; email: string; marketplace: boolean }> {
  const passwordHash = opts.password
    /* The app's own hasher, so the stored shape is whatever sign-in expects. */
    ? await (await import("../server/password-hash")).hashPassword(opts.password)
    : null;

  const [account] = await db.insert(users)
    .values({
      email: EMAIL,
      firstName: "Nova",
      lastName: "Business",
      authProvider: passwordHash ? "local" : "bot",
      isBot: true,
      emailVerifiedAt: new Date(),
      ...(opts.devUnlimited ? { devUnlimited: true } : {}),
      ...(passwordHash ? { passwordHash } : {}),
    } as any)
    .onConflictDoUpdate({
      target: users.email,
      set: {
        firstName: "Nova",
        lastName: "Business",
        isBot: true,
        emailVerifiedAt: new Date(),
        ...(opts.devUnlimited ? { devUnlimited: true } : {}),
        ...(passwordHash ? { passwordHash, authProvider: "local" } : {}),
      } as any,
    })
    .returning();

  const profileValues = {
    userId: account.id,
    displayName: DISPLAY_NAME,
    username: USERNAME,
    headline: HEADLINE,
    bio: BIO,
    novaSummary: NOVA_SUMMARY,
    skills: SKILLS,
    interests: INTERESTS,
    experience: EXPERIENCE,
    education: EDUCATION,
    portfolioProjects: PORTFOLIO,
    resumeParsedAt: new Date(),
    isOnboarded: true,
    /*
     * Null rather than a role. "Open to" is a public call for a co-founder, and
     * this account is not looking for one — `is_bot` keeps it out of the match
     * pool anyway, and a profile that advertises for a partner it cannot take
     * is a dead end somebody will walk into.
     */
    lookingFor: null,
    ...WORK_STYLE,
  };

  await db.insert(userProfiles)
    .values(profileValues as any)
    .onConflictDoUpdate({ target: userProfiles.userId, set: profileValues as any });

  /* The consent record. One row per version, and only if this version is new. */
  const marketplace = await hasMarketplace();
  if (marketplace) {
    const accepted = await db.select().from(sellerAgreements).where(eq(sellerAgreements.userId, account.id));
    if (!accepted.some((a) => a.version === SELLER_TERMS_VERSION)) {
      await db.insert(sellerAgreements).values({
        userId: account.id,
        version: SELLER_TERMS_VERSION,
        /* Null, not invented: there was no request and no address behind this. */
        acceptedIp: null,
      });
    }
  }

  return { id: account.id, email: EMAIL, marketplace };
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL.");
  assertIntentional(url);

  console.log(`database: ${new URL(url).hostname}${new URL(url).pathname}`);

  let password: string | undefined;
  if (wantsLogin) {
    password = process.env.NOVA_BUSINESS_PASSWORD;
    if (!password) {
      console.error(
        "--login needs NOVA_BUSINESS_PASSWORD in the environment.\n"
        + "Read from the environment rather than argv so it does not land in a shell history.",
      );
      return 1;
    }
  }

  const [existing] = await db.select().from(users).where(eq(users.email, EMAIL));
  const plan: string[] = [];
  if (!existing) plan.push(`create the account ${EMAIL}`);
  else plan.push(`update the existing account ${EMAIL} (${existing.id})`);
  plan.push("set is_bot, so it is excluded from matching, search and Discover");
  plan.push("confirm the address, so it can publish listings");
  plan.push(`write the profile: name, headline, bio, ${SKILLS.length} skills, `
    + `${EXPERIENCE.length} roles, ${PORTFOLIO.length} portfolio entries, Nova's summary`);
  plan.push("mark onboarding complete");
  /*
   * Building a market around a project costs CREDIT_COSTS.simulationBuild, and
   * this account has no money on it. `dev_unlimited` is the switch for that and
   * it is honoured only when NODE_ENV is not production *and* the route that
   * sets it is reachable — two gates, because a column that turns billing off
   * deserves them. So it is set locally, where it works, and deliberately not
   * written to a live row at all: inert today is still a landmine if those
   * gates ever move.
   */
  plan.push(isLocal(url)
    ? "set dev_unlimited, so it can build markets here without a balance"
    : "LEAVE dev_unlimited alone — it is ignored in production, so this account needs a real balance to build markets");
  plan.push(await hasMarketplace()
    ? `accept the seller agreement (version ${SELLER_TERMS_VERSION})`
    : "SKIP the seller agreement — the marketplace tables are not on this database yet");
  if (wantsLogin) plan.push("set a password, so a person can sign in and drive it");
  else plan.push("leave it without a password: nothing can sign in as it (pass --login to change that)");

  for (const line of plan) console.log(`  · ${line}`);

  if (!apply) {
    console.log("\nDry run — rerun with --apply.\n");
    return 0;
  }

  console.log("\napplying…");

  const account = await seedNovaBusiness({ password, devUnlimited: isLocal(url) });

  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, account.id));
  const missing = missingOnboarding(profile as any);

  console.log(`\n${DISPLAY_NAME} is ready.`);
  console.log(`  id        ${account.id}`);
  console.log(`  profile   /u/${USERNAME}`);
  console.log(`  sign in   ${wantsLogin ? `${EMAIL} with the password you set` : "not possible — no password"}`);
  console.log(`  onboarding${missing.length ? ` INCOMPLETE: ${missing.join(", ")}` : " complete"}`);
  console.log(account.marketplace
    ? `  seller    agreement v${SELLER_TERMS_VERSION} on file`
    : "  seller    NOT recorded: seller_agreements and simulation_listings are not on this database.\n"
      + "            The marketplace has not been deployed here yet, so this account cannot list\n"
      + "            anything until those migrations land. Re-run this then; it is idempotent.");
  console.log(
    "\nThe builder index is left to what the account earns: markets played and contests won\n"
    + "are its actual job, so the strategy pillar will climb on its own. The header of this\n"
    + "file says why the other three are not written here.\n",
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
