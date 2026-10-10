/**
 * The choices a lever offers this particular company, this year.
 *
 * `LEVER_FIELDS` is the static list; a good half of its choice levers have
 * `options: []` because what they offer depends on the company and the year —
 * which feature ideas are on this year's menu, which programmes are not
 * already running, which region was announced, which offers arrived, which
 * seats could be overruled. The desk filled those in inline, so nothing else
 * could ask the same question, and Nova's plan — which has to choose between
 * exactly the options a person would be shown — had no way to know what they
 * were. One function, read by both.
 */
import type { Company, Niche, Role, World } from "./types";
import { ROLE_TITLES } from "./types";
import type { LeverField } from "./levers";
import { describeWeights } from "./criteria";
import { overrulable, personOf, WARN_AT } from "./people";
import { featureCost, featureMenu } from "./product";
import { SHIFT_MAX } from "./factory";
import { SPENDING_SEATS } from "./responsibilities";
import { audienceModelFor, isAudience, wordsOf } from "./creator";
import {
  EXPANSION_DISCOUNT, PROGRAMMES, announcedRegion, programmeCost, researchCost, statementCost,
  type ProgrammeId,
} from "./world";

/** An offer that arrived this year, as the desk lists it. */
export interface OfferView { id: string; title: string; terms: string }

export interface LeverOptionContext {
  company: Company;
  niche: Niche;
  seasonId: string;
  year: number;
  /** A founder holding every desk: nobody to blame or overrule. */
  solo: boolean;
  /** This year's offers from outside, for `deals` and `dealVotes`. */
  offers: OfferView[];
  /** Niches already carved out of this market, by anyone. */
  openedNiches?: World["openedNiches"];
}

/**
 * The levers whose meaning changes when nobody pays to subscribe.
 *
 * The price is what a member pays, not what a viewer pays; capacity is what
 * the team can make, not a door people are turned away at. Said in the
 * market's own words, so a podcast talks about episodes and downloads.
 */
function inAudienceWords<F extends LeverField>(field: F, niche: Niche): F {
  const w = wordsOf(niche);
  const model = audienceModelFor(niche);
  switch (field.id) {
    case "price":
      return { ...field, label: `Membership price`, help: `What a member pays — the ${niche.voice.customers} who want more than the free ${w.uploads}. Subscribing costs nothing whatever this is set to; it decides only how many join. Nought means no memberships.` };
    case "tiers":
      return { ...field, label: "Membership tiers", help: `A membership price for each kind of ${niche.voice.customer}. Superfans pay for perks a casual ${niche.voice.customer} never would.` };
    case "capacityTarget":
      return { ...field, help: `How much the team can make: ${w.uploads} at the quality you set. Nobody is ever turned away — but an audience bigger than what you make sees less of you, so each ${niche.voice.customer} brings fewer ${w.views}. Ads start paying at ${model.partnerAt.toLocaleString()} ${niche.voice.customers} and sponsors look from ${model.sponsorsFrom.toLocaleString()}.` };
    case "performanceSpend":
      return { ...field, label: "Promoting videos", help: `Paid promotion and thumbnails tested to death: ${niche.voice.customers} now, for as long as you keep paying.` };
    default:
      return field;
  }
}

export function withOptions<F extends LeverField>(input: F, ctx: LeverOptionContext): F {
  const { company, niche, seasonId, year, solo, offers } = ctx;
  const field = isAudience(niche) ? inAudienceWords(input, niche) : input;
  if (field.id === "tiers") {
    return {
      ...field,
      options: niche.segments.map((s) => ({ value: s.id, label: s.name, help: `Pays around ${s.referencePrice} and ${s.priceSensitivity >= 0.6 ? "watches every penny" : s.priceSensitivity <= 0.3 ? "barely looks at the price" : "notices price"}.` })),
    };
  }
  /*
   * The year's offers, for the chief executive to answer and everybody
   * else to vote on. The same list for both, so a seat voting can read
   * exactly what it is voting on.
   */
  if (field.id === "deals" || field.id === "dealVotes") {
    return {
      ...field,
      options: offers.map((o) => ({ value: o.id, label: o.title, help: o.terms })),
    };
  }
  // What to say about last year's shock — and who to blame, if it comes to that.
  if (field.id === "shockAnswer") {
    if (!company.shock) return { ...field, options: [] };
    return {
      ...field,
      label: `Answer: ${company.shock.headline}`,
      options: [
        { value: "statement", label: "Make a statement", help: `Costs ${statementCost(niche).toLocaleString()} to do well, and wins back about half of the ${Math.round(company.shock.reputation)} points of reputation it cost.` },
        { value: "silence", label: "Say nothing", help: "Cheap, and it reads as evasive: a little more reputation goes." },
        /*
         * Blaming a colleague, where there is one. A founder holding
         * every desk blaming "the chief technology officer" in public is
         * blaming themselves, which is not a strategy the game should
         * offer with a straight face.
         */
        ...(solo ? [] : overrulable(company.seats)).map((r) => ({
          value: `blame_${r}`,
          label: `Blame the ${ROLE_TITLES[r].toLowerCase()}`,
          help: `Wins back about 70% of it, and costs that seat 25 points of loyalty. They are at ${Math.round(personOf(company, r).loyalty)}.`,
        })),
      ],
    };
  }
  /*
   * The kinds of customer this company could go looking inside. Its own
   * niche is left off — one a season — and so is a segment somebody has
   * already carved this company's corner out of.
   */
  if (field.id === "openNiche") {
    const opened = (ctx.openedNiches ?? []);
    if (opened.some((o) => o.openedBy === company.id)) return { ...field, options: [] };
    return {
      ...field,
      options: [
        { value: "", label: "Not this year", help: "Keep the year's research money." },
        ...niche.segments
          .filter((seg) => !opened.some((o) => o.id === seg.id))
          .map((seg) => ({
            value: seg.id,
            label: `Look inside ${seg.name.toLowerCase()}`,
            help: `${seg.description} Costs ${researchCost(niche).toLocaleString()}, and what you find depends on what you are already better at than everyone else.`,
          })),
      ],
    };
  }
  // The improvement programmes not already running, and what one costs.
  if (field.id === "programme") {
    const running = new Set((company.programmes ?? []).map((p) => p.id));
    return {
      ...field,
      options: [
        { value: "", label: "None this year", help: "Keep the money." },
        ...Object.entries(PROGRAMMES).filter(([id]) => !running.has(id as ProgrammeId)).map(([id, p]) => ({
          value: id, label: p.name, help: `${p.blurb} ${programmeCost(niche).toLocaleString()} to start.`,
        })),
      ],
    };
  }
  /*
   * The region announced for next year, if the company has not
   * committed to one already — put up by operations, voted on by the
   * other four. The same region and the same price on both levers, so
   * a seat voting is reading exactly what it is voting on.
   */
  if (field.id === "expand" || field.id === "expandVote") {
    // No operations seat, no proposal, so nothing for anyone to vote on.
    const announced = company.expanding || !company.seats.includes("coo")
      ? null
      : announcedRegion({ niche, seasonId, year, open: company.cities ?? [] });
    const price = announced ? Math.round(announced.entryCost * EXPANSION_DISCOUNT).toLocaleString() : "";
    if (!announced) return { ...field, options: [] };
    if (field.id === "expandVote") {
      return {
        ...field,
        options: [{
          value: announced.id,
          label: `Open ${announced.name}`,
          help: `${announced.note} ${price} now, opening next year — and in its first year you reach only as far as the brand does. Operations has to put it up for your vote to count.`,
        }],
      };
    }
    return {
      ...field,
      options: [
        { value: "", label: "Not this year", help: "The announcement stands; somebody else may take it." },
        { value: announced.id, label: `Open ${announced.name}`, help: `${announced.note} ${price} now, opening next year — and in its first year you reach only as far as the brand does. Putting it up counts as your vote for it.` },
      ],
    };
  }
  /*
   * This year's feature menu: three ideas, the same for every team in
   * the season, each saying who it is for, whether a rival already has
   * it (so it can be copied), and what it costs.
   */
  if (field.id === "featureBet") {
    const owned = new Set((company.features ?? []).map((f) => f.id));
    const menu = featureMenu(niche, seasonId, year).filter((m) => !owned.has(m.id));
    const segName = (id: string) => niche.segments.find((s) => s.id === id)?.name ?? id;
    const build = featureCost(niche, "build");
    const copy = featureCost(niche, "copy");
    return {
      ...field,
      options: [
        { value: "", label: "No bet this year", help: "Keep the money." },
        ...menu.map((m) => ({
          value: m.id,
          label: m.name,
          help: `For ${segName(m.segment).toLowerCase()}. ${m.blurb} Build £${build.toLocaleString()}${m.rivalHas ? ` · a rival already has it: copy £${copy.toLocaleString()}` : ""}.`,
        })),
      ],
    };
  }
  /*
   * Where the marketing goes: the regions this company actually sells
   * in, each saying how big it is and who over-indexes there, because
   * that is the whole basis of the decision.
   */
  if (field.id === "regionFocus") {
    const open = new Set(company.cities ?? niche.cities.map((c) => c.id));
    const segName = (id: string) => niche.segments.find((s) => s.id === id)?.name ?? id;
    return {
      ...field,
      options: niche.cities.filter((c) => open.has(c.id)).map((c) => {
        const leans = Object.entries(c.mix ?? {}).sort((a, b) => b[1] - a[1])[0];
        const character = leans && leans[1] > 1.02 ? ` Leans ${segName(leans[0]).toLowerCase()}.`
          : leans && leans[1] < 0.98 ? "" : "";
        return { value: c.id, label: c.name, help: `${Math.round(c.weight * 100)}% of the market.${character} ${c.note}` };
      }),
    };
  }
  // And who it is for: the segments, with what each is worth.
  if (field.id === "segmentFocus") {
    const market = niche.segments.reduce((sum, s) => sum + s.size, 0) || 1;
    return {
      ...field,
      options: niche.segments.map((s) => ({
        value: s.id,
        label: s.name,
        help: `${Math.round((s.size / market) * 100)}% of the market, paying around ${s.referencePrice}. ${describeWeights(s)}`,
      })),
    };
  }
  // A second shift can only run the plant you have: half as much again, at most.
  if (field.id === "shiftCapacity") {
    return { ...field, max: Math.round(company.capacity * SHIFT_MAX) };
  }
  // The other four chairs, for the chief executive's people levers.
  if (field.id === "targets" || field.id === "overrule" || field.id === "replaceSeat") {
    const others = overrulable(company.seats).map((r) => {
      const person = personOf(company, r);
      const record = person.record ?? [];
      const right = record.filter((x) => x.right === "seat").length;
      return {
        value: r,
        label: ROLE_TITLES[r],
        help: `Loyalty ${Math.round(person.loyalty)}${person.loyalty < WARN_AT ? " — thinking about leaving" : ""} · rated ${person.skill}${record.length ? ` · overruled ${record.length}×, right ${right} of those` : ""}`,
      };
    });
    return {
      ...field,
      options: field.id === "targets" ? others : [{ value: "", label: "Nobody", help: field.id === "overrule" ? "Every seat's own decision stands." : "Keep everybody." }, ...others],
    };
  }
  if (field.id === "budget") {
    return {
      ...field,
      options: SPENDING_SEATS.filter((r) => company.seats.includes(r))
        .map((r) => ({ value: r, label: ROLE_TITLES[r], help: "" })),
    };
  }
  if (field.id === "rehire") {
    return {
      ...field,
      options: (["cmo", "cfo", "cto", "coo"] as Role[])
        .filter((r) => !company.seats.includes(r))
        .map((r) => ({ value: r, label: ROLE_TITLES[r], help: `Costs the salary that was saved, and gives the seat back its decisions.` })),
    };
  }
  if (field.id === "positioning") {
    return {
      ...field,
      options: [
        { value: "", label: "Everybody", help: "No particular allegiance, and no particular advantage anywhere." },
        ...niche.segments.map((s) => ({ value: s.id, label: s.name, help: s.description })),
      ],
    };
  }
  return field;
}
