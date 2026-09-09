import type { PathTree } from "./types";

const h = (n: number) => n * 60;

/** Part 3 — Systemize a business. Evidence tier: no codebase to check. */
export const SYSTEMIZE_TREE: PathTree = {
  goal: "systemize_business",
  promise: "Turn something that already works into something that runs without you in every step",
  target: "4 weeks to owner-independence tested",
  defaultTier: "evidence",
  phases: [
    {
      id: "week-1", title: "Week 1 — See it clearly",
      milestones: [
        { id: "SYS.M1.1", title: "Time capture", actor: "user-does", estimateMinutes: 10, tier: "claimed",
          description: "Nova asks you once a day what took your time and categorizes the answer. Deliberately tiny — a full time audit is the kind of homework that ends a path in week one." },
        { id: "SYS.M1.2", title: "Only-me list", actor: "nova-drafts", estimateMinutes: 20, tier: "artifact",
          description: "Generated from the time log: every task that currently requires you. You correct it.",
          variants: {
            restaurant: { description: "Expect open/close, ordering, scheduling, recipe consistency, vendor calls." },
            service: { description: "Expect scoping, client comms, delivery, invoicing." },
            retail: { description: "Expect buying, merchandising, inventory, staffing." },
          } },
        { id: "SYS.M1.3", title: "Financial baseline", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact", sharedId: "SH-04",
          description: "Connect an account or upload statements; Nova reads and summarizes. No manual entry." },
        { id: "SYS.M1.4", title: "Bottleneck ranking", actor: "nova-drafts", estimateMinutes: 15, tier: "artifact",
          description: "Which only-me task costs the most, with the arithmetic shown — hours times your effective rate, plus what it blocks." },
        { id: "SYS.M1.5", title: "Pick the first three", actor: "user-decides", estimateMinutes: 10, tier: "artifact",
          description: "The three to systemize this month." },
      ],
    },
    {
      id: "week-2", title: "Week 2 — Write it down",
      milestones: [
        { id: "SYS.M2.1", title: "Delivery SOP", actor: "nova-drafts", estimateMinutes: h(1), tier: "artifact",
          description: "Nova interviews you conversationally, then writes the document. This is the week that would otherwise never happen, because nobody writes their own SOPs.",
          variants: {
            restaurant: { description: "Prep, service, close. Recipes as specs with quantities and timings." },
            service: { description: "Intake through delivery through handoff." },
            retail: { description: "Open, floor, restock, close, cash handling." },
          } },
        { id: "SYS.M2.2", title: "Intake and sales SOP", actor: "nova-drafts", estimateMinutes: h(1), tier: "artifact", description: "How work comes in and how it's sold." },
        { id: "SYS.M2.3", title: "Onboarding SOP", actor: "nova-drafts", estimateMinutes: 45, tier: "artifact",
          description: "What happens after someone buys, or after a new staff member starts." },
        { id: "SYS.M2.4", title: "SOP test", actor: "user-does", estimateMinutes: h(1), tier: "evidence",
          description: "Someone else follows one unaided while you watch. Every question they have to ask is a gap." },
        { id: "SYS.M2.5", title: "Close the gaps", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact", description: "From the test." },
      ],
    },
    {
      id: "week-3", title: "Week 3 — Instrument and delegate",
      milestones: [
        { id: "SYS.M3.1", title: "Operating metrics", actor: "nova-drafts", estimateMinutes: 20, tier: "artifact", sharedId: "SH-03",
          description: "Nova proposes the three to five numbers that matter for this shape of business.",
          variants: {
            restaurant: { description: "Covers, average check, food cost %, labor %." },
            service: { description: "Utilization, realized rate, pipeline, repeat rate." },
            retail: { description: "Units per transaction, margin, sell-through, shrink." },
          } },
        { id: "SYS.M3.2", title: "Where each number comes from", actor: "nova-drafts", estimateMinutes: 20, tier: "artifact",
          description: "Source mapping. Nova pulls what it can automatically." },
        { id: "SYS.M3.3", title: "Dashboard", actor: "nova-builds", estimateMinutes: h(1), tier: "artifact", description: "The metrics, live." },
        { id: "SYS.M3.4", title: "Review cadence", actor: "user-does", estimateMinutes: 5, tier: "claimed",
          description: "A recurring slot that exists in your calendar." },
        { id: "SYS.M3.5", title: "Role definition", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact",
          description: "Built from the only-me list. What this person owns, what they decide, what escalates." },
        { id: "SYS.M3.6", title: "Hire, contract, or automate", actor: "user-decides", estimateMinutes: 20, tier: "artifact",
          description: "Nova costs all three against the bottleneck ranking." },
        { id: "SYS.M3.7", title: "Job post or automation spec", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact", description: "Whichever you chose." },
        { id: "SYS.M3.8", title: "First handoff", actor: "user-does", estimateMinutes: null, tier: "evidence",
          description: "One process handed to one person, SOP attached, by you." },
      ],
    },
    {
      id: "week-4", title: "Week 4 — Remove the owner",
      milestones: [
        { id: "SYS.M4.1", title: "Automate the top two repetitive tasks", actor: "nova-builds", estimateMinutes: h(3), tier: "artifact",
          description: "The two that cost the most.",
          variants: {
            restaurant: { description: "Ordering triggers, scheduling, prep lists." },
            service: { description: "Proposals, invoicing, follow-up sequences." },
            retail: { description: "Reorder points, stock alerts." },
          } },
        { id: "SYS.M4.2", title: "Runbook for when automation breaks", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact", description: "Because it will." },
        { id: "SYS.M4.3", title: "Pricing review", actor: "nova-drafts", estimateMinutes: 30, tier: "artifact", sharedId: "SH-02",
          description: "Systemizing usually surfaces that pricing hasn't moved in years." },
        { id: "SYS.M4.4", title: "Absence test", actor: "user-does", estimateMinutes: null, tier: "evidence",
          description: "You leave. Three days minimum, shortened from two weeks to fit the month. The three-day version is a first proof, not the finish line; the full test is a follow-on." },
        { id: "SYS.M4.5", title: "Gap list and fixes", actor: "nova-drafts", estimateMinutes: h(1), tier: "artifact", description: "What broke while you were out." },
        { id: "SYS.M4.6", title: "What's next", actor: "user-decides", estimateMinutes: 10, tier: "artifact",
          description: "Deeper systemizing, or Fund it to finance growth." },
      ],
    },
  ],
};
