#!/usr/bin/env tsx
/**
 * The cheap evaluation harness for Nova's v1 prompt packs.
 *
 * Five inputs per live pack, run against the real model, scored by hand
 * against the rubric in docs/nova-evals-v1.md. It exists because a prompt pack
 * is easy to change and hard to judge: the only way to know whether a question
 * is earning its place is to read five plans written with it, including the
 * awkward inputs — the builder who answered nothing, the one who wants two
 * actions, the one whose plan is blocked on something they don't have.
 *
 *   npx tsx --env-file=.env script/nova-evals-v1.ts            # the live pack
 *   npx tsx --env-file=.env script/nova-evals-v1.ts --json     # machine-readable
 *
 * It costs real model calls (five per run) and writes nothing to the database.
 */
import OpenAI from "openai";
import { packFor, NOVA_PACK_VERSION } from "@shared/nova-prompt-packs";
import { firstPlanPrompt, parseFirstPlan, type FirstPlan } from "../server/nova-first-plan";

export interface EvalCase {
  id: string;
  /** What makes this case worth running — the awkwardness it puts in front of the pack. */
  tests: string;
  project: { title: string; description: string };
  answers: Record<string, string>;
}

/** Ship MVP + Website: the live pack. Four of the five are deliberately awkward. */
export const WEBSITE_CASES: EvalCase[] = [
  {
    id: "1-freelancer-with-proof",
    tests: "The straightforward case: a clear visitor, one action, real proof that isn't written down yet.",
    project: { title: "Copy that converts", description: "A landing page for my freelance copywriting, so people stop asking me for a portfolio over email." },
    answers: {
      visitor: "A founder who just got told by an investor that their site doesn't explain what they do.",
      action: "Book a 20-minute call",
      proof: "Nine clients, two with names people would know, but no testimonials written down",
      live: "The call booking has to work and the page has to say what I charge",
    },
  },
  {
    id: "2-no-proof-yet",
    tests: "No proof at all. The plan should make getting the first piece a step, not fake it.",
    project: { title: "Dog walk weather", description: "A tiny page that tells dog owners the best hour to walk today." },
    answers: {
      visitor: "A dog owner checking their phone at breakfast.",
      action: "Enter a postcode and see today's hour",
      proof: "Nothing yet — I built it for myself",
      live: "It has to be right for my own postcode for a week",
    },
  },
  {
    id: "3-answered-nothing",
    tests: "Every question skipped. The plan has to work from the description alone and say what it's assuming.",
    project: { title: "Studio bookings", description: "Recording studio in Leeds wants bookings without phone tag." },
    answers: {},
  },
  {
    id: "4-two-actions",
    tests: "Two competing actions. A good plan picks one for the page and sequences the other, rather than planning both.",
    project: { title: "Cohort or course", description: "A page for my product management course. I want signups for the paid cohort and email subscribers for the free version." },
    answers: {
      visitor: "A PM who saw my thread about product reviews and wants to get better at them.",
      action: "Honestly both: buy the cohort, or join the list",
      proof: "Two cohorts run, 40 people through, a few quotes in DMs",
      live: "Payment working and the cohort dates decided",
    },
  },
  {
    id: "5-blocked-on-something-missing",
    tests: "Blocked on a thing they don't have (a domain). Getting it should be its own step, in the right place.",
    project: { title: "Bakery preorders", description: "Local bakery, Saturday preorders, currently run through Instagram DMs." },
    answers: {
      visitor: "A regular who follows us on Instagram and wants Saturday sourdough.",
      action: "Place a preorder for Saturday",
      proof: "We sell out most Saturdays; about 30 DMs a week",
      live: "Card payment, and the cutoff time has to be clear. We don't have a domain yet.",
    },
  },
];

async function run(): Promise<void> {
  const asJson = process.argv.includes("--json");
  const pack = packFor("ship_mvp", "website");
  // The same base-URL handling the server uses: the proxy wants /v1, and without it every call is a 404.
  const rawBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const openai = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: rawBase ? (rawBase.endsWith("/v1") ? rawBase : `${rawBase.replace(/\/$/, "")}/v1`) : undefined,
  });
  const model = process.env.AI_DEFAULT_MODEL || "gpt-5.2";
  const results: { id: string; tests: string; plan: FirstPlan | null }[] = [];

  for (const c of WEBSITE_CASES) {
    const { system, user } = firstPlanPrompt(pack, c.project, "(a new project: no tasks or milestones yet)", c.answers);
    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    });
    const plan = parseFirstPlan(completion.choices[0]?.message?.content ?? "");
    results.push({ id: c.id, tests: c.tests, plan });
    if (asJson) continue;
    console.log(`\n===== ${c.id} — ${c.tests}`);
    if (!plan) { console.log("UNREADABLE ANSWER"); continue; }
    console.log(plan.summary);
    plan.steps.forEach((s, i) => console.log(` ${i + 1}. ${s.title}\n    done when: ${s.done}${s.why ? `\n    why now: ${s.why}` : ""}`));
  }

  if (asJson) console.log(JSON.stringify({ pack: pack.key, version: NOVA_PACK_VERSION, model, results }, null, 2));
  else console.log(`\n${results.filter((r) => r.plan).length}/${results.length} readable · pack ${pack.key} ${NOVA_PACK_VERSION} · model ${model}`);
}

run().catch((err) => { console.error(err); process.exit(1); });
