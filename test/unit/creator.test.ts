/**
 * A market whose audience does not pay: a channel, a show.
 *
 * The promises `shared/simulation/creator.ts` makes, each one a thing the old
 * model got wrong about a YouTube channel — viewers paying a price, a channel
 * "turning subscribers away", money that only came from customers × price.
 */
import { describe, it, expect } from "vitest";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Niche, type Role, type World } from "@shared/simulation/types";
import { defaultDraft } from "@shared/simulation/levers";
import {
  adRevenueFor, asAudience, audienceModelFor, discoveryFor, isAudience, spreadOf, sponsorMarket, viewsFor, READ_FATIGUE,
} from "@shared/simulation/creator";

const podcasts = nicheById("podcasts")!;

function play(niche: Niche, periods: number, cmo: Record<string, unknown> = {}) {
  let world: World = buildWorld({ seasonId: "creator", niche, cadence: "quarterly", teams: [{ id: "me", name: "Me", seats: [...ROLES] as Role[], officers: 1 }] });
  const reports: any[] = [];
  let prev: any;
  for (let p = 1; p <= periods; p++) {
    const me: any = world.companies.find((c) => c.id === "me")!;
    const filed: any = { companyId: "me" };
    for (const r of ROLES) filed[r] = { ...defaultDraft(r, me, prev?.[r]), ...(r === "cmo" ? cmo : {}) };
    const out = resolveYear({ ...world, year: p }, [filed], economyFor("creator", p, 4), { withoutEvent: true });
    reports.push(out.reports.find((x: any) => x.companyId === "me"));
    prev = filed;
    world = out.world;
  }
  return reports;
}

describe("an audience market", () => {
  it("is what Podcasts now is", () => {
    expect(isAudience(podcasts)).toBe(true);
    expect(audienceModelFor(podcasts).sponsors.length).toBeGreaterThan(0);
  });

  it("never turns anybody away — production is not a door", () => {
    for (const r of play(podcasts, 6)) expect(r.turnedAway).toBe(0);
  });

  it("earns from three places, and the three add up to the revenue", () => {
    for (const r of play(podcasts, 8)) {
      const c = r.creator;
      expect(c, "every period carries the audience's figures").toBeDefined();
      expect(c.adRevenue + c.sponsorRevenue + c.memberRevenue).toBeCloseTo(r.revenue, 2);
      const lines = Object.fromEntries(r.cashBridge.lines.map((l: any) => [l.label, l.amount]));
      expect(lines["Ad revenue"]).toBeCloseTo(c.adRevenue, 2);
      expect(lines["Sponsorships"]).toBeCloseTo(c.sponsorRevenue, 2);
      expect(lines["Sales"], "nothing is sold").toBeUndefined();
    }
  });

  it("grows, and says so as milestones on the way", () => {
    const reports = play(podcasts, 16);
    expect(reports[15].creator.subscribers).toBeGreaterThan(reports[0].creator.subscribers * 3);
    const reached = reports.flatMap((r) => r.creator.milestones.map((m: any) => m.at));
    expect(reached.length, "a season of growing passes at least one milestone").toBeGreaterThan(0);
  });

  it("does not let price decide who subscribes — only who joins as a member", () => {
    const cheap = play(podcasts, 4, { price: 1 });
    const dear = play(podcasts, 4, { price: 400 });
    expect(dear[3].creator.subscribers).toBe(cheap[3].creator.subscribers);
    expect(dear[3].creator.members).not.toBe(cheap[3].creator.members);
  });
});

describe("the money, piece by piece", () => {
  const model = audienceModelFor(podcasts);

  it("pays nothing in ads below the partner threshold", () => {
    expect(adRevenueFor({ chart_hoppers: 1_000_000 }, model, model.partnerAt - 1)).toBe(0);
    expect(adRevenueFor({ chart_hoppers: 1_000_000 }, model, model.partnerAt)).toBeGreaterThan(0);
  });

  it("lets a sponsor's budget go round, not to whoever asks first", () => {
    const channel = (id: string, perUpload: number) => ({
      id, subscribers: { chart_hoppers: 500_000 }, perUpload, uploads: 13, reads: 1, reputation: 60,
    });
    const deals = sponsorMarket({ model, per: 0.25, channels: [channel("big", 200_000), channel("small", 50_000)] });
    const paid = (id: string) => (deals.get(id) ?? []).reduce((a, d) => a + d.amount, 0);
    expect(paid("big")).toBeGreaterThan(paid("small"));
    expect(paid("small"), "a smaller channel still wins some of it").toBeGreaterThan(0);
  });

  it("charges for every sponsor read past the first in views", () => {
    const base = { company: { quality: 60, brand: 30, capacity: 1e9 }, subscribers: { commuters: 100_000 }, segments: podcasts.segments, model, per: 0.25 };
    const one = viewsFor({ ...base, reads: 1 }).total;
    const three = viewsFor({ ...base, reads: 3 }).total;
    expect(three).toBeCloseTo(one * (1 - READ_FATIGUE * 2), 0);
  });

  it("thins views, rather than turning people away, when the audience outgrows production", () => {
    const base = { subscribers: { commuters: 100_000 }, segments: podcasts.segments, model, per: 0.25, reads: 1 };
    const fed = viewsFor({ ...base, company: { quality: 60, brand: 30, capacity: 100_000 } });
    const thin = viewsFor({ ...base, company: { quality: 60, brand: 30, capacity: 25_000 } });
    expect(thin.stretched).toBeCloseTo(0.5, 5);
    expect(thin.total).toBeLessThan(fed.total);
  });

  it("finds a better channel more strangers, and a promoted one more again", () => {
    const at = (quality: number, promotion: number) =>
      discoveryFor({ company: { quality, brand: 20 }, segments: podcasts.segments, model, per: 0.25, promotion }).views;
    expect(at(80, 0)).toBeGreaterThan(at(40, 0));
    expect(at(40, 0.8)).toBeGreaterThan(at(40, 0));
  });
});

describe("being in several regions", () => {
  it("reaches exactly as before from one, further from more, and less than in proportion", () => {
    expect(spreadOf([{ weight: 0.3 }])).toBe(1);
    expect(spreadOf([{ weight: 0.2 }, { weight: 0.2 }])).toBeCloseTo(Math.SQRT2, 5);
    expect(spreadOf([{ weight: 0.2 }, { weight: 0.2 }, { weight: 0.2 }, { weight: 0.2 }])).toBeCloseTo(2, 5);
  });
});

describe("a channel market written before this existed", () => {
  it("becomes an audience market with membership-sized prices", () => {
    const sold = { ...podcasts, model: undefined, audience: undefined, segments: podcasts.segments.map((s) => ({ ...s, referencePrice: 3 })) } as Niche;
    const made = asAudience(sold);
    expect(made.model).toBe("audience");
    for (const s of made.segments) expect(s.referencePrice).toBeGreaterThanOrEqual(24);
    expect(audienceModelFor(made).sponsors.length, "sponsors are filled in when none were written").toBe(made.segments.length);
  });
});
