/**
 * The surfaces Nova can act on, and the one-tap asks each offers.
 *
 * Shared so the button labels the user sees and the guidance the model
 * receives can't drift apart, and so adding a surface is one entry here plus
 * one block of guidance on the server rather than a new route and a new
 * component.
 *
 * Presets are phrased as the outcome the builder wants, not as a feature name:
 * "Suggest pricing tiers for my customer" is something you can picture,
 * "pricing analysis" isn't.
 */

export const NOVA_SURFACE_IDS = [
  "milestones", "roadmap", "research", "strategy", "pricing", "analytics", "tasks",
] as const;

export type NovaSurfaceId = (typeof NOVA_SURFACE_IDS)[number];

export interface NovaPreset {
  label: string;
  ask: string;
  /** Only offered when the builder has something selected. */
  needsEntity?: boolean;
}

export interface NovaSurfaceConfig {
  label: string;
  /** Sits under the dialog title, framing what this surface can do. */
  blurb: string;
  /** Placeholder for the free-text box. */
  placeholder: string;
  presets: NovaPreset[];
  /** Query keys to refresh after applying. */
  invalidates: string[];
}

export const NOVA_SURFACES: Record<NovaSurfaceId, NovaSurfaceConfig> = {
  milestones: {
    label: "Milestones",
    blurb: "Nova turns your plan into checkpoints with a real definition of done, and links the tasks that serve each one.",
    placeholder: "e.g. Turn my roadmap into milestones with a definition of done for each, and tell me which one is next.",
    presets: [
      {
        label: "Build milestones from my roadmap",
        ask: "Turn my roadmap phases into project milestones. Give each one an observable definition of done in its description, and link the existing tasks that serve it.",
      },
      {
        label: "Write a definition of done for each milestone",
        ask: "For every milestone I already have, write a real definition of done — the observable thing that proves it's finished — and save it to the milestone.",
      },
      {
        label: "Which milestone should I work on next?",
        ask: "Look at what's actually built and tell me the single milestone to focus on next. Set it in progress and make sure its tasks are ordered.",
      },
      {
        label: "Set realistic target dates",
        ask: "Set target dates across my milestones based on the estimates on my tasks and my available hours. Say plainly if the sequence doesn't fit the time.",
      },
    ],
    invalidates: ["milestones", "kanban", "roadmap"],
  },

  roadmap: {
    label: "Roadmap",
    blurb: "Nova sharpens your phases — clearer outcomes, honest status, and milestones pulled out of the phases that are ready.",
    placeholder: "e.g. Give every phase concrete outcomes with numbers, and mark the ones that are actually finished.",
    presets: [
      {
        label: "Give every phase concrete outcomes",
        ask: "Go through my roadmap phases and rewrite their outcomes so each one is a finished thing I could point at, with a number where a number sharpens it.",
      },
      {
        label: "Correct the phase statuses against reality",
        ask: "Compare my roadmap phases to what's actually been built and set each phase's status honestly.",
      },
      {
        label: "Turn the ready phases into milestones",
        ask: "For each roadmap phase that's in progress or next up, create a matching project milestone with a definition of done.",
      },
      {
        label: "Sharpen this phase",
        ask: "Rewrite the selected phase: a clearer title, a description that says how I'll know it's done, and real outcomes.",
        needsEntity: true,
      },
    ],
    invalidates: ["roadmap", "milestones"],
  },

  research: {
    label: "Customer research",
    blurb: "Nova designs the interviews and experiments that would settle your riskiest assumption — with the actual questions written out.",
    placeholder: "e.g. Design the interviews that would tell me whether solo builders will actually post a weekly update.",
    presets: [
      {
        label: "Plan interviews for my riskiest assumption",
        ask: "Work out the riskiest assumption in my brief, then plan the customer interviews that would settle it. For each one name the role to talk to and write the actual questions — about past behaviour, not hypotheticals.",
      },
      {
        label: "Design an experiment to test the core loop",
        ask: "Design an experiment that would tell me whether my core loop works. Give me a falsifiable hypothesis, the method, and the exact number and threshold that decides it.",
      },
      {
        label: "What am I assuming without evidence?",
        ask: "List the assumptions my plan depends on that I have no evidence for, ranked by how much damage being wrong would do. Then create the interviews or experiments that would test the top ones.",
      },
      {
        label: "Turn what I've learned into next steps",
        ask: "Read the interviews and experiments I've already recorded and tell me what they actually establish, what they don't, and what to do next as a result.",
      },
    ],
    invalidates: ["interviews", "experiments", "kanban", "personas"],
  },

  strategy: {
    label: "Strategy & investors",
    blurb: "Nova plays the sceptical investor: the question your plan avoids, and what would answer it.",
    placeholder: "e.g. What's the hardest question an investor would ask me, and what evidence would I need to answer it?",
    presets: [
      {
        label: "What would an investor attack first?",
        ask: "Read my brief as a sceptical investor. Name the questions I can't currently answer, ranked by how badly they'd damage a meeting, and create the work that would let me answer them.",
      },
      {
        label: "Sharpen my positioning",
        ask: "My positioning is too broad or too vague. Rewrite the one-liner, value proposition and target customer so they're specific enough to be arguable, and save them to my brief.",
      },
      {
        label: "Where's my moat, honestly?",
        ask: "Tell me honestly what would stop a competent competitor copying this in a month, and what I'd have to do to build a real advantage. Don't flatter me.",
      },
      {
        label: "What has to be true for this to work?",
        ask: "List the things that must be true for this business to work, mark which ones I have evidence for, and create the work to test the rest.",
      },
    ],
    invalidates: ["kanban", "interviews", "experiments"],
  },

  pricing: {
    label: "Pricing",
    blurb: "Nova prices against the value to your customer and what comparable products charge — and shows its reasoning.",
    placeholder: "e.g. Suggest three tiers for solo builders, and tell me what to charge and why.",
    presets: [
      {
        label: "Suggest pricing tiers for my customer",
        ask: "Propose pricing tiers for my target customer. For each one: the price, who it's for, the reason to upgrade from the tier below, and your reasoning for the number.",
      },
      {
        label: "What should I actually charge?",
        ask: "Based on the value to my target customer and what comparable products charge, tell me what to charge. Show your reasoning and say what would make you revise it.",
      },
      {
        label: "Pressure-test my current pricing",
        ask: "Look at the tiers I already have and tell me what's wrong with them: gaps, tiers with no reason to exist, missing upgrade triggers, prices that don't match the value.",
      },
      {
        label: "Design a free tier that converts",
        ask: "Design a free tier that shows real value but leaves a clear reason to upgrade, and say exactly which limit does the converting.",
      },
    ],
    invalidates: ["pricing-tiers", "kanban"],
  },

  analytics: {
    label: "Measurement",
    blurb: "Nova defines the smallest set of events that would tell you whether the product works.",
    placeholder: "e.g. Which events should I track to know whether my weekly loop is working?",
    presets: [
      {
        label: "Which metrics should I track?",
        ask: "Define the smallest set of events that would tell me whether this product works, mapped to the success metrics in my brief. For each one say the decision it would inform.",
      },
      {
        label: "Build me a funnel I can act on",
        ask: "Define the funnel for my core loop, step by step, with the event at each step and a realistic target conversion. Create the tasks to instrument it.",
      },
      {
        label: "Are my success metrics any good?",
        ask: "Critique the success metrics in my brief. Say which are vanity, which aren't measurable as written, and rewrite them into ones I could actually report on.",
      },
    ],
    invalidates: ["analytics-events", "kanban"],
  },

  tasks: {
    label: "Tasks",
    blurb: "Nova plans the work: ordered, estimated, and attached to the milestone it serves.",
    placeholder: "e.g. Plan the next two weeks of work and tell me what to drop to make it fit.",
    presets: [
      {
        label: "Plan my next two weeks",
        ask: "Look at where the project actually is and plan the next two weeks of work: which tasks, in what order, with hour estimates that fit the time. Flag anything I should drop.",
      },
      {
        label: "Break this task into steps",
        ask: "Break the selected task into concrete ordered steps I can actually finish, with hour estimates.",
        needsEntity: true,
      },
      {
        label: "Estimate everything on my board",
        ask: "Give every task on my board a realistic whole-hour estimate, and split anything bigger than about eight hours.",
      },
    ],
    invalidates: ["kanban", "milestones", "task-history"],
  },
};
