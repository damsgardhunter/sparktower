/**
 * Answers the working-style questions for accounts that predate them being asked.
 *
 * `shared/onboarding.ts` made "finished" mean five things, and `requireOnboarded`
 * now refuses the actions that put somebody in front of another person until all
 * five are there. The flag that used to mean finished never checked anything:
 * `/api/profile/complete-onboarding` set it and validated nothing, so an account
 * could reach the end of the form having answered none of it.
 *
 * The result is accounts marked onboarded that the new rule would refuse —
 * people who did what was asked of them at the time. Locking them out to make a
 * point about a rule they were never shown is the wrong way round, so their
 * blanks get filled instead and the rule stays the same for everybody.
 *
 * ## What it fills, and what it will not
 *
 * The three working-style answers, with neutral values: twenty hours, moderate
 * risk, flexible schedule. These are preferences with a real middle, the middle
 * is the least wrong guess, and anybody can change them in a form they already
 * have.
 *
 * Skills are different and are only filled for accounts that are plainly ours —
 * the demo, bot and example addresses. A skill is a claim about a person that
 * other people read and that matching acts on; inventing one for a real human
 * puts words in their mouth. A real account missing skills is named in the
 * output and left alone, because that one wants a person to decide.
 *
 * Only accounts already marked onboarded are touched. A new sign-up is not
 * finished and is not meant to be: the rule applies to them from the start.
 *
 *   DATABASE_URL=… npx tsx script/backfill-onboarding-answers.ts [--apply]
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { db } from "../server/db";
import { userProfiles, users } from "@shared/schema";
import { missingOnboarding } from "@shared/onboarding";

/** Neutral middles. Each is a real answer somebody might have given. */
const DEFAULTS = { hoursPerWeek: 20, riskTolerance: "moderate", scheduleStyle: "flexible" } as const;

/** Addresses that are ours rather than somebody's. */
const OURS = /@(demo\.sparktower\.invalid|bots\.sparktower\.invalid|example\.test|example\.com)$/i;

export async function backfillOnboarding(apply: boolean): Promise<number> {
  const rows = await db.select({
    userId: userProfiles.userId,
    email: users.email,
    displayName: userProfiles.displayName,
    skills: userProfiles.skills,
    hoursPerWeek: userProfiles.hoursPerWeek,
    riskTolerance: userProfiles.riskTolerance,
    scheduleStyle: userProfiles.scheduleStyle,
  }).from(userProfiles)
    .innerJoin(users, eq(users.id, userProfiles.userId))
    .where(eq(userProfiles.isOnboarded, true));

  const blocked = rows.filter((r) => missingOnboarding(r as any).length > 0);
  if (!blocked.length) {
    console.log(`${rows.length} onboarded account(s), none of them blocked. Nothing to do.`);
    return 0;
  }

  console.log(`${rows.length} onboarded account(s); ${blocked.length} the new rule would refuse.\n`);

  const needsAHuman: string[] = [];
  let filled = 0;

  for (const row of blocked) {
    const missing = missingOnboarding(row as any);
    const patch: Record<string, unknown> = {};
    for (const key of ["hoursPerWeek", "riskTolerance", "scheduleStyle"] as const) {
      if (missing.includes(key)) patch[key] = DEFAULTS[key];
    }

    /* A name or a skill is a claim about a person. Ours may be given one; a real account may not. */
    const mine = OURS.test(row.email ?? "");
    if (missing.includes("skills")) {
      if (mine) patch.skills = ["Building"];
      else needsAHuman.push(`${row.email} — no skills`);
    }
    if (missing.includes("displayName")) {
      if (mine) patch.displayName = (row.email ?? "Someone").split("@")[0];
      else needsAHuman.push(`${row.email} — no display name`);
    }

    if (!Object.keys(patch).length) continue;
    console.log(`  ${(row.email ?? row.userId).padEnd(40)} ${Object.keys(patch).join(", ")}`);
    filled += 1;
    if (apply) {
      await db.update(userProfiles).set(patch as any).where(eq(userProfiles.userId, row.userId));
    }
  }

  console.log(`\n${apply ? "Filled" : "Would fill"} ${filled} account(s).`);
  if (needsAHuman.length) {
    console.log(`\nLeft alone — a real account, and this is a claim about a person rather than a preference:`);
    for (const line of needsAHuman) console.log(`  ${line}`);
    console.log("Those stay blocked until somebody fills them in, which is the point of the rule.");
  }
  if (!apply) console.log("\nReport only. Pass --apply to write.");
  return 0;
}

async function main(): Promise<number> {
  return backfillOnboarding(process.argv.includes("--apply"));
}

/* Only as a command, never on import — see the note in script/reputation-gap.ts. */
const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
}
