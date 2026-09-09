import type { PathTree } from "./types";

const h = (n: number) => n * 60;

/**
 * Part 4 — Fund it. The subcategory is the goal; routes are the methods and
 * Nova usually stacks two or three. Past week 4 the dashboard switches from a
 * date projection to pipeline mode, because outcomes now depend on other
 * people. loan_grant inverts the model and counts backward from a deadline.
 */
export const FUND_TREE: PathTree = {
  goal: "raise_funding",
  promise: "Get the story, the numbers and the plan into a shape that gets backed",
  target: "4 weeks to in-market",
  defaultTier: "artifact",
  phases: [
    {
      id: "week-1", title: "Week 1 — Situation and foundation",
      milestones: [
        { id: "FUND.M1.1", title: "Situation read", actor: "novva-drafts", estimateMinutes: 20, tier: "artifact",
          description: "Conversational, never a form: what exists today, money available, credit position, audience, timeline, business shape." },
        { id: "FUND.M1.2", title: "Route stack", actor: "user-decides", estimateMinutes: 20, tier: "artifact",
          description: "Nova proposes two or three routes toward your goal with the case for each. Nothing here is a prerequisite and \"you don't qualify\" is never an endpoint — every situation has a live route.",
          variants: {
            startup_equity: { description: "Equity fits scalable, high-growth. Nova will still show presale and revenue routes alongside — the fastest cash and the best evidence are usually the ones nobody considered." },
            local_community: { description: "Community, presale and merch routes, weighted to a story and a face. Local, visible, story-driven." },
            loan_grant: { description: "Grant and loan routes need a complete plan with quoted costs. Deadline mode: from here Nova counts backward from the submission date, not forward from pace." },
          } },
        { id: "FUND.M1.3", title: "Tier 0 research", actor: "novva-builds", estimateMinutes: h(1), tier: "artifact", sharedId: "SH-06",
          description: "Zero effort from you. Comparable revenue nearby, demographics and foot traffic, cost benchmarks, equipment pricing, competitor pricing, break-even at realistic capacity. Takes a plan from guessed to researched on day one, while you watch it populate." },
        { id: "FUND.M1.4", title: "Plan v1 generated", actor: "novva-builds", estimateMinutes: h(1), tier: "artifact",
          description: "Full draft from the situation read plus the research. The first score appears here. A living document: every piece of evidence gathered anywhere updates and re-scores it." },
        { id: "FUND.M1.5", title: "Financial model", actor: "novva-builds", estimateMinutes: h(1), tier: "artifact", sharedId: "SH-04",
          description: "Driver-based. You adjust drivers; Nova handles the math." },
        { id: "FUND.M1.6", title: "Read the score", actor: "novva-drafts", estimateMinutes: 15, tier: "artifact",
          description: "Five sub-scores — completeness, consistency, evidence backing, assumption risk, viability math — and the top three actions that would raise it, each with what it's worth. It measures the strength of the case, never the odds of the business." },
      ],
    },
    {
      id: "week-2", title: "Week 2 — Evidence and materials",
      milestones: [
        { id: "FUND.M2.1", title: "Tier 1 outreach pack", actor: "novva-drafts", estimateMinutes: 30, tier: "artifact",
          description: "Emails and call scripts for rent, suppliers, insurance, permits. Ready to send." },
        { id: "FUND.M2.2", title: "Make the calls", actor: "user-does", estimateMinutes: h(3), tier: "claimed",
          description: "Your afternoon on the phone — the one that moves the score most. Guessed becomes quoted." },
        { id: "FUND.M2.3", title: "Plan updated with quotes", actor: "novva-builds", estimateMinutes: 0, tier: "artifact",
          description: "Automatic. The score moves. This is the moment the system proves itself." },
        { id: "FUND.M2.4", title: "Assumption risk pass", actor: "novva-drafts", estimateMinutes: 30, tier: "artifact",
          description: "Nova names the two or three assumptions that break the model if wrong by 30%, and drafts the mitigation for each. High risk isn't failure; unexamined risk is." },
        { id: "FUND.M2.5", title: "Materials", actor: "novva-builds", estimateMinutes: h(2), tier: "artifact",
          description: "Route-dependent.",
          variants: {
            startup_equity: { description: "The deck, and a target list of 40–60 with warm-intro mapping, tiered so practice targets come first." },
            local_community: { description: "Campaign page, tiers, and the story." },
            loan_grant: { description: "Application pack, submission checklist, deadline calendar." },
          } },
        { id: "FUND.M2.6", title: "The five hard questions", actor: "novva-drafts", estimateMinutes: 30, tier: "artifact",
          description: "Generated from the actual weak spots in the numbers, not a generic list. Nova drafts answers; you sharpen them." },
      ],
    },
    {
      id: "week-3", title: "Week 3 — Set up the route",
      milestones: [
        { id: "FUND.M3.1", title: "Showcase page", actor: "novva-builds", estimateMinutes: 45, tier: "artifact",
          description: "Pulls from the plan, build progress and check-ins automatically, so it stays current without maintenance. A public record of someone shipping is the most compelling thing on it." },
        { id: "FUND.M3.2", title: "Route setup", actor: "novva-builds", estimateMinutes: h(2), tier: "artifact",
          description: "Whatever the route stack chose: presale pricing and deposits, a campaign page, what can be sold now at small scale, an application pack, or the investor target list.",
          variants: {
            startup_equity: { description: "Target list live, intros mapped, practice targets first. Plus the revenue route: a paid beta before launch is the most overlooked evidence." },
            local_community: { description: "Campaign page, tiers, story. Founding-member pricing, gift cards, prepaid packages." },
            loan_grant: { description: "Application pack finished, submission checklist, deadline calendar with days remaining." },
          } },
        { id: "FUND.M3.3", title: "Tier 2 evidence, if wanted", actor: "user-does", estimateMinutes: null, tier: "evidence",
          description: "Something you'd enjoy doing anyway: the tasting, the signup page, the photos. Optional, and Nova will say plainly what it's worth — a backer who tastes the food and sees a coherent cost model is most of the way there." },
        { id: "FUND.M3.4", title: "Score check before going out", actor: "novva-drafts", estimateMinutes: 15, tier: "artifact",
          description: "Last chance to raise it cheaply. Nova names anything still guessed that could be quoted today." },
      ],
    },
    {
      id: "week-4", title: "Week 4 — In market",
      checkpoint: "From here the dashboard switches to pipeline mode: conversations, stages, follow-ups. Projecting a date would be dishonest once outcomes depend on other people.",
      milestones: [
        { id: "FUND.M4.1", title: "Launch the route", actor: "user-does", estimateMinutes: h(2), tier: "claimed",
          description: "Send, submit, publish, open presales. Yours to do — this is the day." },
        { id: "FUND.M4.2", title: "Response log", actor: "novva-drafts", estimateMinutes: null, tier: "artifact",
          description: "Nova structures your notes after every meeting, call, or rejection." },
        { id: "FUND.M4.3", title: "Objection tracking", actor: "novva-drafts", estimateMinutes: null, tier: "artifact",
          description: "What keeps coming up." },
        { id: "FUND.M4.4", title: "Revise from objections", actor: "novva-builds", estimateMinutes: h(2), tier: "artifact",
          description: "Materials and plan updated. The score recalculates." },
        { id: "FUND.M4.5", title: "Pipeline view", actor: "novva-drafts", estimateMinutes: 30, tier: "artifact",
          description: "Conversations, stages, and follow-ups. The 7-day absence clock keeps running — momentum is the thing that fails here." },
      ],
    },
  ],
};
