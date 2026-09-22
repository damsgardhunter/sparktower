/**
 * The three ideas round one offers you.
 *
 * Lifted out of the retired sprint routes rather than rewritten. The prompt
 * below was tuned against two specific failure modes seen in practice — the
 * model reaching for tech-stack soup, and bland interchangeable SaaS
 * dashboards — and every hard rule in it is there because something went wrong
 * without it. Rewriting it from scratch would have quietly thrown that away.
 *
 * The era briefs map onto the game's three buttons: the past, now, and the
 * future.
 */
import { getOpenAI } from "./openai-client";
import type { Express } from "express";
import { storage } from "./storage";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireCredits, modelFor } from "./entitlements";
import { parseModelJson, respondToAiError } from "./ai-json";
import { CREDIT_COSTS , CHARGEABLE} from "@shared/plans";

/*
 * The shared client. This built its own from `OPENAI_API_KEY`, which the
 * product does not set — so the idea shuffle failed on every press, the same
 * way the valuation did. See server/openai-client.ts.
 */

const STYLE_BRIEFS: Record<string, string> = {
  past: "Take something that existed before roughly 2010 — a gadget, a ritual, a service, a fad — and reimagine it for today. Think jukeboxes, video rental stores, pen pals, TV dinners, arcade cabinets, mixtapes, Blockbuster, drive-ins, encyclopedia salesmen.",
  modern: "Take something people put up with today and make it dramatically better or stranger. Think group chats, potlucks, gym memberships, dog parks, wedding planning, moving apartments, fantasy leagues, neighbourhood gossip.",
  futuristic: "Invent something that doesn't exist yet but plausibly could within 15 years. Think memory rental, mood-based city routing, sleep economies, pet translators, weather subscriptions, personal reputation escrow.",
};

/**
 * Prompt for the three-option idea picker.
 *
 * Written to fight two specific failure modes we hit in practice:
 *  1. The model reaching for tech-stack soup ("Next.js + Tailwind, GraphQL,
 *     Docker/Kubernetes templates"), which is unreadable and no fun to build.
 *  2. Bland, interchangeable SaaS dashboards.
 * Hence the hard bans and the demand for a concrete, surprising hook.
 */
function ideaOptionsPrompt(style: string, skills: string, interests: string): string {
  const brief = STYLE_BRIEFS[style] || STYLE_BRIEFS.modern;
  return `You are Nova, pitching sprint ideas to builders who have 24-72 hours and want to enjoy themselves.

THE BRIEF
${brief}

GENERATE EXACTLY 3 IDEAS. Each must be genuinely different from the other two — not three flavours of the same thing.

WHAT MAKES A GOOD IDEA HERE
- Fun first. If it sounds like homework, throw it out.
- Specific and concrete. "An app for pet owners" is nothing. "A translator that tells you what your cat's 3am screaming actually means" is something.
- Has a hook — one surprising twist a person would repeat to a friend.
- Buildable as a rough prototype in a weekend by two people.
- Slightly playful or absurd is good. Boring is the only real failure.

HARD RULES — breaking these makes the idea useless
- NEVER mention frameworks, languages, databases, cloud providers, or infrastructure. No React, Next.js, Tailwind, Node, Go, GraphQL, Postgres, Docker, Kubernetes, AWS. Not once.
- NEVER use these words: platform, solution, leverage, seamless, robust, scalable, ecosystem, synergy, empower, revolutionize, holistic, cutting-edge, state-of-the-art.
- No buzzword stacking. No em-dash-joined feature lists.
- Write like you're telling a friend at a bar, not writing a pitch deck.

FIELD RULES
- "name": 1-3 words. Memorable, sayable out loud. No CamelCase mashups like "HoloSprintCoach".
- "tagline": ONE short sentence, max 12 words. The hook.
- "pitch": 2 sentences MAX, plain English, under 40 words total. What it does and why someone would use it.
- "twist": ONE sentence on the part that makes people grin.
- "whoItsFor": 5-10 words describing a specific kind of person.
- "vibe": 1-3 words for the tone, e.g. "cozy chaos", "petty revenge", "wholesome".

Builder's skills: ${skills}
Builder's interests: ${interests}
(Nudge toward their interests where it fits naturally, but never at the cost of the idea being fun.)

Respond ONLY with valid JSON, no markdown or code fences:
{"ideas":[{"name":"","tagline":"","pitch":"","twist":"","whoItsFor":"","vibe":""}]}`;
}

interface SprintIdea {
  name: string;
  tagline: string;
  pitch: string;
  twist: string;
  whoItsFor: string;
  vibe: string;
}

/** Trims the model's output to the documented field limits. */
function normalizeIdeas(raw: any): SprintIdea[] {
  const list = Array.isArray(raw?.ideas) ? raw.ideas : Array.isArray(raw) ? raw : [];
  return list
    .slice(0, 3)
    .map((i: any) => ({
      name: String(i?.name || "").trim().slice(0, 60),
      tagline: String(i?.tagline || "").trim().slice(0, 140),
      pitch: String(i?.pitch || "").trim().slice(0, 400),
      twist: String(i?.twist || "").trim().slice(0, 240),
      whoItsFor: String(i?.whoItsFor || "").trim().slice(0, 120),
      vibe: String(i?.vibe || "").trim().slice(0, 40),
    }))
    .filter((i: SprintIdea) => i.name && i.pitch);
}

/**
 * Three ideas in the chosen era.
 *
 * Still charged, and deliberately: this is the one place in the game that
 * calls a model on demand, a player can ask for as many shuffles as they like,
 * and an uncapped free model call behind a button people press for fun is a
 * bill waiting to happen. Writing your own idea costs nothing and always has.
 */
export function registerGameIdeaRoutes(app: Express) {
  app.post("/api/games/idea-options", isAuthenticated, async (req: any, res) => {
    try {
      const { productStyle, partnerId } = req.body as { productStyle?: string; partnerId?: string };
      const style = productStyle && STYLE_BRIEFS[productStyle] ? productStyle : "modern";

      const ent = await requireCredits(res, req.user.id, CREDIT_COSTS.sprintIdeaSuggestion, "ideas for your game");
      if (!ent) return;

      const [mine, theirs] = await Promise.all([
        storage.getUserProfile(req.user.id),
        partnerId ? storage.getUserProfile(partnerId) : null,
      ]);
      const skills = [...(mine?.skills || []), ...(theirs?.skills || [])].join(", ") || "general";
      const interests = [...(mine?.interests || []), ...(theirs?.interests || [])].join(", ") || "building things";

      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [
          { role: "system", content: ideaOptionsPrompt(style, skills, interests) },
          { role: "user", content: `Give me 3 ${style} ideas. Make them fun.` },
        ],
        // High temperature on purpose: pressing it again should feel like a
        // fresh shuffle, not the same three ideas every time.
        temperature: 1,
        max_completion_tokens: 2000,
      });

      let ideas: SprintIdea[] = [];
      try {
        ideas = normalizeIdeas(parseModelJson(completion.choices[0]?.message?.content ?? ""));
      } catch (parseErr) {
        console.error("Idea options parse failed:", parseErr);
      }

      if (ideas.length === 0) {
        return res.status(502).json({ message: "Couldn't come up with anything good. Try again.", code: "model_unreadable" });
      }

      await storage.deductCredits(req.user.id, CREDIT_COSTS.sprintIdeaSuggestion);
      res.json({ style, ideas, creditsCharged: CHARGEABLE });
    } catch (error) {
      console.error("Idea options error:", error);
      respondToAiError(res, error, "Failed to generate ideas");
    }
  });
}

export { STYLE_BRIEFS, normalizeIdeas, type SprintIdea };
