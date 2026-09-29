/**
 * Nova builds the season, from the business the company actually has.
 *
 * A company that wants to run a simulation has to answer questions it has no
 * way to answer yet: which of seven markets is closest to what we do, how much
 * of the world should we play, how many rivals is honest, how many years is
 * long enough for a decision to come back to us. Those are the questions the
 * product should answer — it is already holding the project, the path, the
 * roadmap and the description.
 *
 * So this reads what the company is building and proposes a season shaped like
 * it: the market whose shape matches theirs, the scope that matches their
 * ambition, rivals that match what they are actually up against, and a plain
 * account of *why* — which is the part a team argues with, and the argument is
 * the point.
 *
 * The prompt and the parse live here, pure and tested. The model call and the
 * writing of the season live in the route, where the entitlement and the
 * transaction are.
 */
import { parseModelJson } from "./ai-json";
import { NICHES } from "@shared/simulation/niches";
import { SCOPES, isContinent } from "@shared/simulation/geography";
import { TRAINING_YEARS_MIN, TRAINING_YEARS_MAX, BOT_TEAMS_MAX } from "./company-season-routes";

export interface SimulationBrief {
  /** Which of the markets, by id. */
  nicheId: string;
  /** "home", "world", or a continent id. */
  scope: string;
  botTeams: number;
  totalYears: number;
  name: string;
  /** Why this market, in the company's own terms. Shown to the team, and argued with. */
  why: string;
  /**
   * What in the simulation stands for what in their business — the part that
   * makes it theirs rather than a game about dating apps. Two to five lines.
   */
  mapping: { inTheGame: string; inYourBusiness: string }[];
}

const str = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** What Nova is told about the business, and what it is allowed to answer. */
export function buildSimulationPrompt(input: {
  company: { name: string; industry?: string | null; size?: string | null; description?: string | null };
  project?: { title?: string | null; description?: string | null; goal?: string | null } | null;
  /** Where the project has actually got to, in whatever words the app has. */
  progress?: string | null;
  people: number;
}): { system: string; user: string } {
  const markets = NICHES.map((n) => `${n.id}: ${n.name} — ${n.premise}`).join("\n");
  const scopes = SCOPES.map((s) => `${s.id}: ${s.name} — ${s.blurb}`).join("\n");

  return {
    system: [
      "You design a business simulation for a real company, from what they are actually building.",
      "",
      "Pick the market whose SHAPE matches theirs — how customers choose, what costs money, what",
      "a year's decision does — not the one whose subject matter sounds similar. A hardware startup",
      "may well belong in drone delivery; a consultancy usually belongs in project software.",
      "",
      "MARKETS",
      markets,
      "",
      "SCOPES",
      scopes,
      "",
      "Rules. Rivals: as many as the market they are really in, between 2 and 12 unless they told you",
      `otherwise; never more than ${BOT_TEAMS_MAX}. Years: ${TRAINING_YEARS_MIN} to ${TRAINING_YEARS_MAX};`,
      "pick enough that a decision comes back to them, which is rarely fewer than six. Scope: 'home'",
      "for a company selling in one country, a continent for one selling across it, 'world' only for",
      "a company that genuinely sells everywhere.",
      "",
      "The mapping is the important part: say what each thing in the game stands for in THEIR",
      "business, in their words. Be concrete and be honest — if the fit is rough, say where.",
      "Never flatter. Never invent facts about them you were not given.",
      "",
      "Answer as JSON only:",
      `{"nicheId":"","scope":"","botTeams":0,"totalYears":0,"name":"","why":"two or three sentences","mapping":[{"inTheGame":"","inYourBusiness":""}]}`,
    ].join("\n"),
    user: [
      `COMPANY\n${str(input.company.name, 120) || "(unnamed)"}`,
      input.company.industry ? `Industry: ${str(input.company.industry, 120)}` : "",
      input.company.size ? `Size: ${str(input.company.size, 60)}` : "",
      input.company.description ? `About: ${str(input.company.description, 1500)}` : "",
      `People who will play: ${Math.max(1, Math.round(input.people))}`,
      "",
      input.project ? `WHAT THEY ARE BUILDING\n${str(input.project.title, 200)} — ${str(input.project.description, 2000)}` : "",
      input.project?.goal ? `Their goal: ${str(input.project.goal, 200)}` : "",
      "",
      input.progress ? `WHERE THEY HAVE GOT TO\n${str(input.progress, 3000)}` : "",
    ].filter(Boolean).join("\n"),
  };
}

/**
 * What came back, made safe.
 *
 * Every field is clamped to something the season routes would accept anyway —
 * a model that invents a market, a continent or a forty-year season should
 * produce a season, not a validation error thrown at the person who pressed a
 * button. Anything unusable comes back null, and the caller says so plainly.
 */
export function parseSimulationBrief(raw: string, fallbackName: string): SimulationBrief | null {
  /*
   * `parseModelJson` throws on prose where JSON was asked for, which is the
   * right behaviour for a route that wants to answer 502. Here the caller
   * wants to know whether there is a season in this or not, and an exception
   * thrown out of a parser is not an answer.
   */
  let parsed: any;
  try {
    parsed = parseModelJson(raw, "simulation brief");
  } catch {
    return null;
  }
  if (!parsed) return null;

  const nicheId = NICHES.some((n) => n.id === parsed?.nicheId) ? String(parsed.nicheId) : "";
  if (!nicheId) return null;

  const rawScope = str(parsed?.scope, 40);
  const scope = rawScope === "home" || rawScope === "world" || isContinent(rawScope) ? rawScope : "home";

  const years = Math.round(Number(parsed?.totalYears));
  const totalYears = Number.isFinite(years)
    ? Math.min(TRAINING_YEARS_MAX, Math.max(TRAINING_YEARS_MIN, years))
    : 8;

  const rivals = Math.round(Number(parsed?.botTeams));
  const botTeams = Number.isFinite(rivals) ? Math.min(BOT_TEAMS_MAX, Math.max(0, rivals)) : 3;

  const mapping = (Array.isArray(parsed?.mapping) ? parsed.mapping : [])
    .map((m: any) => ({ inTheGame: str(m?.inTheGame, 120), inYourBusiness: str(m?.inYourBusiness, 300) }))
    .filter((m: { inTheGame: string; inYourBusiness: string }) => m.inTheGame && m.inYourBusiness)
    .slice(0, 6);

  return {
    nicheId,
    scope,
    totalYears,
    botTeams,
    name: str(parsed?.name, 80) || fallbackName,
    why: str(parsed?.why, 800),
    mapping,
  };
}
