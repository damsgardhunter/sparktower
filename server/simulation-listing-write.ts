/**
 * Turning a market into something somebody would choose from a grid.
 *
 * A market comes out of `nova-market.ts` as segments, regions, rivals and
 * costs — everything the engine needs and nothing a person browsing would read.
 * A marketplace card needs the opposite: what this puts you through, who it is
 * for, and why it is harder than it looks.
 *
 * That is a different piece of writing from the market, and it is written from
 * the market rather than from the brief. Written from the brief it describes
 * the business somebody was thinking about; written from the market it
 * describes the contest they are actually buying — which rivals are already
 * seated, how much of the room is open, what the money does in year one.
 */
import { openai } from "./openai-client";
import { parseModelJson } from "./ai-json";
import { TEXT_MODEL } from "./aiModels";
import { aiStubbed } from "./ai-stub";
import { marketShares } from "@shared/simulation/custom-market";
import type { Niche } from "@shared/simulation/types";

export interface ListingCopy {
  title: string;
  summary: string;
  description: string;
  tags: string[];
}

/** The few numbers that actually characterise a market, for the prompt. */
export function marketFacts(niche: Niche): string {
  const shares = marketShares({ incumbents: niche.incumbents ?? [] });
  const segments = (niche.segments ?? []).map((s: any) => `${s.name} (${s.size?.toLocaleString?.() ?? s.size})`).join(", ");
  const rivals = (niche.incumbents ?? []).map((i: any) => `${i.name}, ${i.posture ?? "steady"}`).join("; ");
  return [
    `Market: ${niche.name}`,
    niche.premise ? `Premise: ${niche.premise}` : "",
    segments ? `Segments: ${segments}` : "",
    rivals ? `Already seated: ${rivals}` : "",
    `Share held by incumbents: ${Math.round(shares.rivals.reduce((n, r) => n + r.share, 0) * 100)}%`,
    `Open share: ${Math.round((niche.openShare ?? 0) * 100)}%`,
    `Unit cost: ${niche.baseUnitCost}`,
    `Innovation pace: ${niche.innovationPace}`,
  ].filter(Boolean).join("\n");
}

const RULES = `You are writing the marketplace entry for a business simulation somebody will choose from a grid of them.
Write about the contest, not the software: what a table is up against, what makes it hard, and who would learn something from it. Never promise an outcome and never invent a figure that is not given to you.
Respond ONLY with a JSON object in exactly the shape at the end of the instructions.`;

/**
 * The card, the page and the chips for one market.
 *
 * Stubbed, it writes something structurally valid from the market's own name
 * and premise — so publishing, searching and the grid can all be exercised
 * without a model call.
 */
export async function writeListingCopy(input: {
  niche: Niche;
  brief?: string | null;
  cadence: string;
  botSkill: string;
  totalYears: number;
}): Promise<ListingCopy> {
  if (aiStubbed()) {
    const name = input.niche.name ?? "A market";
    return {
      title: name,
      summary: `${input.niche.premise ?? `A ${name.toLowerCase()} market with rivals already seated and a narrow way in.`} Played over ${input.totalYears} years, deciding ${input.cadence}.`.slice(0, 400),
      description: `A ${input.cadence} season in ${name.toLowerCase()}. The companies already there are not waiting for you, and the share that is open is smaller than it looks. Bot rivals play at "${input.botSkill}".`,
      tags: ["custom", input.cadence, input.botSkill],
    };
  }

  const completion = await openai.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      { role: "system", content: RULES },
      {
        role: "user",
        content: [
          marketFacts(input.niche),
          ``,
          `Settings: decisions ${input.cadence}, ${input.totalYears} years, bot rivals play at "${input.botSkill}".`,
          input.brief ? `\nThe business this was written from, in their words: ${input.brief.slice(0, 600)}` : "",
          ``,
          `Write:`,
          `- "title": what this simulation is called. Four to seven words, naming the market and the difficulty rather than being clever.`,
          `- "summary": one or two sentences for the card, under 400 characters. What a table is walking into.`,
          `- "description": three short paragraphs for the listing page — the market, what makes it hard, and who should play it.`,
          `- "tags": three to six short lowercase labels somebody would filter by.`,
          ``,
          `Answer as JSON: { "title": "...", "summary": "...", "description": "...", "tags": ["..."] }`,
        ].filter(Boolean).join("\n"),
      },
    ],
  }, { timeout: 60_000 });

  const parsed = parseModelJson<any>(completion.choices[0]?.message?.content ?? "", "listing copy");
  return {
    title: String(parsed?.title ?? input.niche.name ?? "Custom simulation").slice(0, 80),
    summary: String(parsed?.summary ?? "").slice(0, 400),
    description: String(parsed?.description ?? ""),
    tags: Array.isArray(parsed?.tags)
      ? parsed.tags.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 6)
      : [],
  };
}
