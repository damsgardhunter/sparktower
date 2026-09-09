import type { PathTree } from "./types";

const h = (n: number) => n * 60;

/** Part 2 — Ship an MVP. The flagship path; the month promise rests on it. */
export const SHIP_TREE: PathTree = {
  goal: "ship_mvp",
  promise: "Get a first version in front of real people and learn from what they do",
  target: "4 weeks",
  defaultTier: "verified",
  phases: [
    {
      id: "week-1",
      title: "Week 1 — Concept locked, project scaffolded, loop begun",
      checkpoint: "Running, deployed, scope locked. First pace read.",
      milestones: [
        {
          id: "SHIP.M1.1", title: "Product statement", actor: "nova-drafts", estimateMinutes: 10, tier: "artifact", sharedId: "SH-01",
          description: "Nova reads the setup description and generates three statements with different emphases — not rewordings. You pick or edit. Feeds the landing page, store copy, and every pitch later.",
          variants: {
            game: { description: "Three pitches instead: what the player does, what makes it feel good, why they return. Genre named explicitly — it drives every later default." },
            website: { description: "Who it's for, what they should do on it, what happens when they do." },
          },
        },
        {
          id: "SHIP.M1.2", title: "The core loop", actor: "nova-drafts", estimateMinutes: 20, tier: "artifact",
          description: "The highest-variance milestone in the path; everything downstream orders off it. The 3–5 step sequence that delivers value.",
          variants: {
            game: { description: "The loop at two scales: moment-to-moment (seconds — what the player does over and over) and session (minutes — what makes a session feel complete). Week 2 builds moment-to-moment first: a game whose second-to-second action isn't fun can't be rescued by content." },
            website: { description: "The visitor path: land, understand, act. Usually three steps." },
          },
        },
        {
          id: "SHIP.M1.3", title: "Scope cut", actor: "user-decides", estimateMinutes: 25, tier: "artifact",
          description: "Nova generates the full feature list the vision implies and splits it into in-the-month and deferred. Deferred goes to a visible roadmap, not a graveyard. Drag items across the line and watch the projected date move. Done when the in-scope list projects inside your target date.",
        },
        {
          id: "SHIP.M1.4", title: "Stack decision", actor: "nova-drafts", estimateMinutes: 5, tier: "artifact",
          description: "Locked for the month; revisiting costs days.",
          variants: {
            app: { description: "Native vs cross-platform. Nova names the store review timeline here, since it lands in week 4 and surprises people." },
            game: { description: "Engine, weighted to what you know and the genre from the pitch. 2D vs 3D is the bigger decision and gets its own choice." },
            website: { description: "Platform and hosting. Bias hard toward the fastest path to live." },
          },
        },
        {
          id: "SHIP.M1.5", title: "Scaffold", actor: "nova-builds", estimateMinutes: 30, tier: "verified",
          description: "Repo, framework, routing, styling baseline, deploy config. Runs locally. Auto-verified on first commit.",
          variants: { game: { description: "Engine project with one controllable thing on screen. That's the equivalent of \"it boots\"." } },
        },
        {
          id: "SHIP.M1.6", title: "Data model", actor: "nova-drafts", estimateMinutes: 20, tier: "artifact",
          description: "Nova derives the schema from the core loop. You review entity names — those leak into the UI forever.",
          variants: {
            game: { description: "Game state and save structure: what persists between sessions." },
            website: { description: "Content model, if there's content. Skip if static." },
          },
        },
        {
          id: "SHIP.M1.7", title: "Loop step one", actor: "nova-builds", estimateMinutes: h(2), tier: "verified",
          description: "First step of the core loop, running against real data.",
        },
        {
          id: "SHIP.M1.8", title: "Deploy", actor: "nova-builds", estimateMinutes: 30, tier: "verified",
          description: "Deploy in week 1, not at the end. Removes deploy risk from the critical path and makes the project feel real immediately. Live URL.",
          variants: {
            app: { description: "TestFlight or internal track, installed on your own device." },
            game: { description: "Playable build running outside the editor. Web build is usually fastest." },
          },
        },
      ],
    },
    {
      id: "week-2",
      title: "Week 2 — Core loop complete",
      checkpoint: "The product does its main thing. The build extension is first offered here.",
      milestones: [
        {
          id: "SHIP.M2.1", title: "Loop steps", actor: "nova-builds", estimateMinutes: h(3), tier: "verified", expandsFrom: "SHIP.M1.2",
          description: "One milestone per step of the core loop. Nova builds against the schema; you run it. Broken into 1–3h units deliberately — this is the densest pace signal in the path and also the week people quit.",
          variants: { game: { description: "One milestone per verb in the moment-to-moment loop — move, act, respond, feedback — then a feel checkpoint that only you can judge. If it doesn't feel good, the milestone is iterating on feel, not moving on." } },
        },
        {
          id: "SHIP.M2.2", title: "Feel checkpoint", actor: "user-does", estimateMinutes: 30, tier: "claimed",
          description: "Nova can build the mechanic; it cannot judge the feel. Play it yourself. If it doesn't feel good, iterate before moving on.",
          skipFor: ["app", "saas", "website", "other"],
        },
        {
          id: "SHIP.M2.3", title: "Loop closes", actor: "user-does", estimateMinutes: 30, tier: "claimed",
          description: "Complete the full loop yourself, start to finish, without touching the database. The first moment the thing is real.",
        },
        {
          id: "SHIP.M2.4", title: "Persistence and auth", actor: "nova-builds", estimateMinutes: h(2), tier: "verified",
          description: "Accounts and saved state.",
          variants: { game: { description: "Save/load and progression state." } },
          skipFor: ["website"],
        },
      ],
    },
    {
      id: "branch-build",
      title: "Keep building (optional)",
      optional: true,
      milestones: [
        {
          id: "SHIP.B.1", title: "Choose what to build", actor: "user-decides", estimateMinutes: 20, tier: "artifact",
          description: "Nova sorts the deferred roadmap into two groups: supports the core loop (makes the main loop work better or happen more often) and adjacent to it (starts its own sequence). The test is mechanical: does it modify a step already in the loop, or begin its own? Nova recommends from the first group; everything stays pickable — it's your product.",
        },
        {
          id: "SHIP.B.2", title: "Set extension length", actor: "user-decides", estimateMinutes: 5, tier: "artifact",
          description: "One, two, or three weeks. The projected ship date updates live. If it passes your target, you see that as a date, not a warning.",
        },
        {
          id: "SHIP.B.3", title: "Build the selected loops", actor: "nova-builds", estimateMinutes: h(3), tier: "verified", expandsFrom: "SHIP.B.1",
          description: "Same structure as week 2, own estimates. Extending is activity: no decay, no penalty.",
        },
        {
          id: "SHIP.B.4", title: "Go to users, or extend again", actor: "user-decides", estimateMinutes: 5, tier: "artifact",
          description: "No cap, no lecture. Each extension is its own dated decision, so continuing is chosen repeatedly rather than drifted into.",
        },
      ],
    },
    {
      id: "week-3",
      title: "Week 3 — Usable by someone else",
      milestones: [
        {
          id: "SHIP.M3.1", title: "Empty, loading, error states", actor: "nova-drafts", estimateMinutes: h(1), tier: "verified",
          description: "Nova writes them all and flags any it wasn't sure about.",
          variants: {
            game: { description: "Failure and edge states: death, quit mid-action, bad input, empty save." },
            website: { description: "404, form failure, empty search." },
          },
        },
        {
          id: "SHIP.M3.2", title: "Visual pass", actor: "nova-builds", estimateMinutes: h(2), tier: "verified",
          description: "Nova applies a coherent pass; you pick a direction from two or three options rather than describing what you want.",
          variants: { game: { title: "Game feel pass", description: "Distinct from visual polish and more important: hit feedback, timing, transitions, audio cues. Nova implements, you judge." } },
        },
        {
          id: "SHIP.M3.3", title: "Onboarding", actor: "nova-builds", estimateMinutes: h(1), tier: "verified",
          description: "The first thirty seconds to the loop.",
          variants: {
            game: { description: "The first ninety seconds, taught through play rather than text." },
            website: { description: "What a visitor from a cold link sees and does." },
          },
        },
        {
          id: "SHIP.M3.4", title: "Landing page", actor: "nova-drafts", estimateMinutes: 45, tier: "artifact",
          description: "Headline from the product statement, three lines, one action.",
        },
        {
          id: "SHIP.M3.5", title: "Analytics on the loop", actor: "nova-builds", estimateMinutes: 30, tier: "verified", sharedId: "SH-03",
          description: "Loop starts and completions visible. Powers week 4.",
        },
        {
          id: "SHIP.M3.6", title: "Feedback channel", actor: "nova-builds", estimateMinutes: 15, tier: "verified",
          description: "One click to reach you.",
        },
        {
          id: "SHIP.M3.7", title: "Pricing", actor: "nova-drafts", estimateMinutes: 20, tier: "artifact", sharedId: "SH-02",
          description: "Nova proposes three models with reasoning. Free is a valid pick, offered as one rather than treated as avoidance.",
          variants: {
            app: { description: "Three models with reasoning, store constraints stated." },
            game: { description: "Premium, free-to-play, or demo-plus-paid. Free-to-play changes what gets built, so if you lean that way Nova will have raised it at the pitch." },
          },
        },
      ],
    },
    {
      id: "week-4",
      title: "Week 4 — Real users, real signal",
      milestones: [
        {
          id: "SHIP.M4.1", title: "The first ten", actor: "user-does", estimateMinutes: 30, tier: "claimed", sharedId: "SH-05",
          description: "Nova drafts the list structure and the outreach message. You supply ten actual names — only you know who these people are.",
          variants: { game: { description: "Ten playtesters, sourced from the genre's communities. People who don't like the genre give misleading feedback." } },
        },
        { id: "SHIP.M4.2", title: "Send", actor: "user-does", estimateMinutes: 45, tier: "claimed", description: "Send the message to the ten. From your own address — a note from a person is opened; a note from a product is not." },
        {
          id: "SHIP.M4.3", title: "Watch three people use it", actor: "user-does", estimateMinutes: h(2), tier: "claimed",
          description: "No coaching. Note every hesitation. Nova provides the observation template and afterwards turns your notes into a ranked friction list.",
          variants: { game: { description: "Watch silently and note where they stop having fun, not where they get confused. Different failures, different fixes." } },
        },
        { id: "SHIP.M4.4", title: "Fix the top three frictions", actor: "nova-builds", estimateMinutes: h(4), tier: "verified", description: "From the ranked list." },
        {
          id: "SHIP.M4.5", title: "Read the signal", actor: "nova-drafts", estimateMinutes: 20, tier: "artifact",
          description: "Nova pulls the analytics and reports what they mean rather than asking you to interpret.",
          variants: { game: { description: "Session length, session-loop completion, and whether anyone played twice. Playing twice is the signal; everything else is secondary." } },
        },
        {
          id: "SHIP.M4.6", title: "Decide what's next", actor: "user-decides", estimateMinutes: 15, tier: "artifact",
          description: "Continue, adjust the loop, or move to another path. Nova makes the case for each from what the numbers said. The deferred roadmap becomes next month's scope if continuing.",
        },
      ],
    },
  ],
};
