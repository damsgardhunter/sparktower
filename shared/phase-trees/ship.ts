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
            physical: { description: "Three statements: what it is, who it is for, and why they would buy it instead of the thing they already buy. Name that thing explicitly — a physical product is always replacing something, even if the something is \"nothing\"." },
            food: { description: "Three statements: what it is, who eats it, and when. The occasion matters more than the ingredients — \"a snack for the car\" and \"a gift\" are different products out of the same jar, and they price differently." },
            channel: { description: "Three positioning statements: who it is for, what they get out of one video, and why they would subscribe rather than just watch that one. The subscribe reason is the one most new channels cannot answer, and it is the one that compounds." },
          },
        },
        {
          id: "SHIP.M1.2", title: "The core loops", actor: "nova-drafts", estimateMinutes: 45, tier: "artifact",
          description: "The highest-variance milestone in the path; everything downstream orders off it. A business runs on five loops, each a 3–5 step sequence whose last step restarts its first: product (what a user repeats — add more than one if the product has several), growth (how strangers find it), retention (why they come back), revenue (how use becomes money) and referral (how users bring users). Once all five are written, Nova audits them against the competition.",
          supersedes: [
            "The highest-variance milestone in the path; everything downstream orders off it. The 3–5 step sequence that delivers value.",
            "The loop at two scales: moment-to-moment (seconds — what the player does over and over) and session (minutes — what makes a session feel complete). Week 2 builds moment-to-moment first: a game whose second-to-second action isn't fun can't be rescued by content.",
            "The visitor path: land, understand, act. Usually three steps.",
          ],
          variants: {
            game: { description: "Five loops. Product at two scales — moment-to-moment (seconds: what the player does over and over) and session (minutes: what makes a session feel complete) — then growth (clips, streams, word of mouth), retention (why they play tomorrow), revenue (premium, demo-to-paid, or free-to-play) and referral (bringing a friend in). Week 2 builds moment-to-moment first: a game whose second-to-second action isn't fun can't be rescued by content." },
            website: { description: "Five loops. Product is the visitor path — land, understand, act — then growth (how a visitor arrives), retention (why they return), revenue (what they pay for, or what earns) and referral (why they send it on). Short loops are fine; missing ones are not." },
            physical: { description: "Five loops. Product is what a buyer repeats — buy, use, run out or wear out, buy again — then growth (how a stranger finds it), retention (why they reorder), revenue (margin on one unit) and referral (why they mention it). Be honest about the reorder loop: a product nobody buys twice is a one-off sale, which is a real business but a different one, and knowing that in week 1 changes everything after it." },
            food: { description: "Five loops. Product is make → sell → make again, and the thing to be honest about is batch size. Then growth (where somebody finds you — a market, a shelf, a feed), retention (why they buy a second jar), revenue (what is left after ingredients, packaging and waste) and referral. Food's revenue loop is the one that catches people: the margin hides inside the ingredient cost, so Nova will do that arithmetic before you price anything." },
            channel: { description: "Five loops. Product is watch → finish → watch another. Growth is how a stranger arrives, which means the title and the thumbnail are part of the loop rather than decoration. Then retention (why they come back next week), revenue (how attention becomes money) and referral (why one viewer sends a video to another). Pick the revenue loop now even if it is months from paying: sponsorship, affiliate and your own product each change what you film." },
          },
        },
        {
          id: "SHIP.M1.3", title: "Scope cut", actor: "user-decides", estimateMinutes: 25, tier: "artifact",
          description: "Nova generates the full feature list the vision implies and splits it into in-the-month and deferred. Deferred goes to a visible roadmap, not a graveyard. Drag items across the line and watch the projected date move. Done when the in-scope list projects inside your target date.",
          variants: {
            physical: { description: "The whole product line the idea implies, cut to one thing you can make this month: one size, one colour, one finish. Variants are the commonest reason a first physical product never ships — each one multiplies the materials, the packaging and the decisions. Deferred goes on a visible roadmap." },
            food: { description: "Every recipe, size and flavour the idea implies, cut to one product in one size in one package. A range is a later problem and a menu is a much later one. Deferred goes on a visible roadmap." },
            channel: { description: "Every format and series the idea implies, cut to the one you can make every week without dreading it. Done when the in-scope list projects inside your target date — and for a channel the scarce thing is your hours, so the estimate is the whole decision." },
          },
        },
        {
          id: "SHIP.M1.4", title: "Stack decision", actor: "nova-drafts", estimateMinutes: 5, tier: "artifact",
          description: "Locked for the month; revisiting costs days.",
          variants: {
            app: { description: "Native vs cross-platform. Nova names the store review timeline here, since it lands in week 4 and surprises people." },
            game: { description: "Engine, weighted to what you know and the genre from the pitch. 2D vs 3D is the bigger decision and gets its own choice." },
            website: { description: "Platform and hosting. Bias hard toward the fastest path to live." },
            physical: {
              title: "How it gets made",
              description: "Make it yourself, pay a maker, or go to a contract manufacturer — and the minimum order that comes with each. Locked for the month; changing it costs weeks rather than days. Nova names the lead times, because they land in week 3 and surprise people who have only built software.",
              estimateMinutes: 30,
            },
            food: {
              title: "Where it gets made",
              description: "A home kitchen, a shared commercial kitchen, or a co-packer. This is a legal question before it is a practical one — what you may sell, and to whom, depends on it, and cottage food rules differ by state and country. Nova will name the rules where you are rather than guess at them. Locked for the month.",
              estimateMinutes: 30,
            },
            channel: {
              title: "Kit and format",
              description: "What you film on, how long an episode runs, and how often you publish. Bias hard toward what you already own: a channel waiting on a camera does not start. The cadence is the real decision — pick one you can hold for eight weeks on a bad week, not a good one.",
              estimateMinutes: 20,
            },
          },
        },
        {
          id: "SHIP.M1.5", title: "Scaffold", actor: "nova-builds", estimateMinutes: 30, tier: "verified",
          description: "Repo, framework, routing, styling baseline, deploy config. Runs locally. Auto-verified on first commit.",
          variants: {
            game: { description: "Engine project with one controllable thing on screen. That's the equivalent of \"it boots\"." },
            /*
             * Actor changed, not just the words. Nova cannot make a physical
             * thing, and `nova-builds` promises a step Nova finishes and
             * closes — so leaving it would put "Nova builds it" on the card
             * for making a prototype by hand.
             */
            physical: {
              title: "First rough prototype", actor: "user-does", estimateMinutes: h(4),
              description: "Something that exists in your hand, however ugly — cardboard, a 3D print, one sewn badly. This is the equivalent of \"it boots\": it is not for showing anybody, it is for proving the thing can exist at all. Nova drafts the steps and the materials list; only you can make it.",
            },
            food: {
              title: "First batch", actor: "user-does", estimateMinutes: h(3),
              description: "Make it once, in a real kitchen, and taste it. Write down what you actually did rather than what you meant to do — that note is the first draft of the recipe, and the difference between the two is where the product lives. Nova drafts the method and the shopping list.",
            },
            channel: {
              title: "Channel set up, one test video", actor: "user-does", estimateMinutes: h(3),
              description: "Channel created, and one video filmed, cut and uploaded unlisted — end to end, badly, on purpose. The point is to find out what the process actually costs you in hours before you promise yourself a weekly cadence.",
            },
          },
        },
        {
          id: "SHIP.M1.6", title: "Data model", actor: "nova-drafts", estimateMinutes: 20, tier: "artifact",
          description: "Nova derives the schema from the core loop. You review entity names — those leak into the UI forever.",
          variants: {
            game: { description: "Game state and save structure: what persists between sessions." },
            website: { description: "Content model, if there's content. Skip if static." },
            physical: {
              title: "Bill of materials and unit cost",
              description: "Every part, what each costs, and what one finished unit costs you including the packaging. This single number decides the price, the margin and whether the business works at all, which is why it is week 1 and not week 3.",
              estimateMinutes: 45,
            },
            food: {
              title: "Recipe, costed per serving",
              description: "The recipe written so somebody else could follow it, with the cost of one serving: ingredients, packaging, and a waste allowance you believe. Allergens listed, because the label will need them and so does anyone you hand it to before the label exists.",
              estimateMinutes: 45,
            },
            channel: {
              title: "The first ten titles",
              description: "Ten titles, not ten topics. If the title is not interesting the video is not interesting, and that is far cheaper to find out in a list than after filming. Nova drafts twenty; you keep ten.",
              estimateMinutes: 30,
            },
          },
        },
        {
          id: "SHIP.M1.7", title: "Loop step one", actor: "nova-builds", estimateMinutes: h(2), tier: "verified",
          description: "First step of the core loop, running against real data.",
          variants: {
            physical: {
              title: "Make one properly", actor: "user-does", estimateMinutes: h(4),
              description: "The same thing again, but made the way you would make it to sell. Time yourself while you do it: those hours are most of your real unit cost, and they are the number people leave out.",
            },
            food: {
              title: "Make it twice the same way", actor: "user-does", estimateMinutes: h(3),
              description: "Follow your own recipe twice and get the same result. A dish you can only make once is not a product, and finding that out now is the cheapest it will ever be.",
            },
            channel: {
              title: "Film and cut one episode", actor: "user-does", estimateMinutes: h(4),
              description: "A real one, to the format you chose. Keep a note of how long it took end to end — that number decides whether your cadence is real.",
            },
          },
        },
        {
          id: "SHIP.M1.8", title: "Deploy", actor: "nova-builds", estimateMinutes: 30, tier: "verified",
          description: "Deploy in week 1, not at the end. Removes deploy risk from the critical path and makes the project feel real immediately. Live URL.",
          variants: {
            app: { description: "TestFlight or internal track, installed on your own device." },
            game: { description: "Playable build running outside the editor. Web build is usually fastest." },
            /*
             * Nova can build the page that takes an order, so this one keeps
             * `nova-builds`. Food and a channel cannot be deployed by anybody
             * but the person — selling a jar and publishing a video are acts.
             */
            physical: {
              title: "A way to take an order",
              description: "In week 1, not at the end. A page, a form, even a direct message — something a stranger could use to buy one. Nova builds it. This takes \"how would I even sell it\" off the critical path, which is where it quietly sits for most first products.",
            },
            food: {
              title: "Sell one, to a stranger", actor: "user-does", estimateMinutes: h(2),
              description: "Not a friend. A market stall, a pre-order, one shop that will take six jars. Money changing hands in week 1 is the whole point of putting this here: it is the line between a product and a hobby, and it is a different conversation after somebody has paid.",
            },
            channel: {
              title: "Publish one, publicly", actor: "user-does", estimateMinutes: 30,
              description: "Public, not unlisted, in week 1. A channel with nothing on it cannot teach you anything, and the first video is never the good one — which is exactly why it should be behind you rather than ahead.",
            },
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
          variants: {
            game: { description: "One milestone per verb in the moment-to-moment loop — move, act, respond, feedback — then a feel checkpoint that only you can judge. If it doesn't feel good, the milestone is iterating on feel, not moving on." },
            physical: {
              actor: "user-does", estimateMinutes: h(4),
              description: "One milestone per step of the buying loop: how somebody finds it, how they order, how it reaches them, what would make them order again. Nova drafts each step and what it needs; the making and the posting are yours.",
            },
            food: {
              actor: "user-does", estimateMinutes: h(4),
              description: "One per step: make, package, label, sell, restock. Broken into small units deliberately — this is the week most people discover that packaging takes longer than cooking, and it is better to discover it against a plan than against a deadline.",
            },
            channel: {
              actor: "user-does", estimateMinutes: h(4),
              description: "One milestone per episode, on the cadence you chose. Publishing on schedule *is* the loop here — the discipline is the product, and the second and third videos are where almost every channel stops.",
            },
          },
        },
        {
          /*
           * Game-only until now, and that was an accident of which paths had
           * been written: a thing you hold, a thing you eat and a thing you
           * watch all have a judgement in them that nobody but the maker can
           * make. It stays skipped for software, where the equivalent
           * judgement is spread across the polish week.
           */
          id: "SHIP.M2.2", title: "Feel checkpoint", actor: "user-does", estimateMinutes: 30, tier: "claimed",
          description: "Nova can build the mechanic; it cannot judge the feel. Play it yourself. If it doesn't feel good, iterate before moving on.",
          skipFor: ["app", "saas", "website", "other"],
          variants: {
            physical: {
              title: "Live with it for a week",
              description: "Nova can plan it and cannot tell you how it feels in the hand. Use the thing yourself for a week. Whatever mildly annoys you on day three will be the first thing a customer mentions, and it is far cheaper to fix now than after a production run.",
              estimateMinutes: 20,
            },
            food: {
              title: "Taste it properly",
              description: "Eat it. Then eat it again three days later — cold, out of the fridge, standing up, the way somebody actually will rather than the way you served it to yourself. Nova cannot taste anything, and this is the judgement the whole product rests on.",
              estimateMinutes: 20,
            },
            channel: {
              title: "Watch your own episode back",
              description: "All the way through, without skipping, without stopping to fix anything. If you are bored at ninety seconds, so is everybody — and you are the most sympathetic viewer this video will ever have.",
              estimateMinutes: 20,
            },
          },
        },
        {
          id: "SHIP.M2.3", title: "Loop closes", actor: "user-does", estimateMinutes: 30, tier: "claimed",
          description: "Complete every loop yourself, start to finish, without touching the database — and check each one brings you back to its first step. The first moment the thing is real. A codebase audit that finds all five closed confirms it.",
          supersedes: ["Complete the full loop yourself, start to finish, without touching the database. The first moment the thing is real."],
          variants: {
            physical: { description: "Walk the whole loop yourself as a stranger would: order one, receive it, use it, and work out what would make you order a second. The first moment it is a business rather than an object." },
            food: { description: "Make, package, sell, restock — once, end to end, with real money at the sell step. The first moment it is a business rather than a recipe." },
            channel: { description: "Publish, then publish again on schedule. Two is the smallest number that proves a cadence exists, and the gap between them is the thing you are actually testing." },
          },
        },
        {
          id: "SHIP.M2.4", title: "Persistence and auth", actor: "nova-builds", estimateMinutes: h(2), tier: "verified",
          description: "Accounts and saved state.",
          variants: {
            game: { description: "Save/load and progression state." },
            physical: {
              title: "Taking money and tracking an order",
              description: "Payment, a record of who ordered what, and a way to tell them it has gone out. Nova builds it — this part genuinely is software, even when the product is not.",
            },
            food: {
              title: "Taking money, and a record of what you made",
              description: "Payment, plus a note of each batch and when it was made. The second half is not bureaucracy: it is what you need the day somebody asks which batch they bought, and it is the first thing an inspector asks for.",
            },
          },
          /*
           * A channel has no accounts and no orders — the platform holds all
           * of it. Skipped rather than reworded into something that sounds
           * like work.
           */
          skipFor: ["website", "channel"],
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
          variants: {
            /*
             * Same reason as week 2: Nova drafts each step and the person
             * makes the thing. An allow-list entry would have been easier and
             * would have left "Nova builds it" on the card.
             */
            physical: { title: "Make the selected additions", actor: "user-does", description: "Same structure as week 2, own estimates. Nova drafts each; the making is yours. Extending is activity: no decay, no penalty." },
            food: { title: "Make the selected additions", actor: "user-does", description: "Same structure as week 2, own estimates. Nova drafts each; the cooking and packing are yours. Extending is activity: no decay, no penalty." },
            channel: { title: "Film the selected episodes", actor: "user-does", description: "Same structure as week 2, own estimates. Extending is activity: no decay, no penalty — and for a channel the extension is simply more weeks of the cadence." },
          },
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
            physical: {
              title: "What happens when it goes wrong",
              description: "The damaged arrival, the return, the out-of-stock, the wrong size. Nova writes the policy and the replies; you decide how generous to be. Deciding it now, calmly, is much better than deciding it in a reply to an angry stranger.",
            },
            food: {
              title: "When it goes wrong",
              description: "A bad batch, a refund, a complaint — and an allergy question. Nova drafts the policy and the replies. Get the allergy answer right before you sell anything: it is the one where \"I think so\" is not an acceptable answer.",
            },
            channel: {
              title: "The comment you dread, and the claim",
              description: "A copyright claim, a video that has to come down, and the first genuinely nasty comment. Nova drafts the replies and a line on what you will and will not engage with. Having decided in advance is the difference between a bad afternoon and a bad week.",
            },
          },
        },
        {
          id: "SHIP.M3.2", title: "Visual pass", actor: "nova-builds", estimateMinutes: h(2), tier: "verified",
          description: "Nova applies a coherent pass; you pick a direction from two or three options rather than describing what you want.",
          variants: {
            game: { title: "Game feel pass", description: "Distinct from visual polish and more important: hit feedback, timing, transitions, audio cues. Nova implements, you judge." },
            physical: {
              title: "Packaging and how it looks", actor: "nova-drafts",
              description: "Nova drafts the packaging copy and two or three directions for the look; you pick one. What it arrives in is most of what people remember and almost all of what they photograph.",
            },
            food: {
              title: "Packaging and the label", actor: "nova-drafts",
              description: "Nova drafts the label and two directions for the look. A food label is partly a legal document — name, net weight, ingredients in order, allergens, who made it and where — and Nova will say which of those your rules require rather than leaving you to find out at the shelf.",
            },
            channel: {
              title: "Thumbnail, title, and the first fifteen seconds", actor: "nova-drafts",
              description: "The three things that decide whether a video gets watched, and the only polish on a channel that pays for itself immediately. Nova drafts five title and thumbnail pairs; you pick. Everything else about how it looks can wait.",
            },
          },
        },
        {
          id: "SHIP.M3.3", title: "Onboarding", actor: "nova-builds", estimateMinutes: h(1), tier: "verified",
          description: "The first thirty seconds to the loop.",
          variants: {
            game: { description: "The first ninety seconds, taught through play rather than text." },
            website: { description: "What a visitor from a cold link sees and does." },
            physical: {
              title: "What happens when it arrives", actor: "nova-drafts",
              description: "Opening it, working out what to do with it, and the first five minutes of use. Nova drafts the insert. For a physical product this is the whole of onboarding and it costs one printed card.",
            },
            food: {
              title: "How they know what to do with it", actor: "nova-drafts",
              description: "Serving suggestion, how to store it, how long it keeps once opened. Nova drafts it for the label or the insert. Somebody who does not know what to do with it does not buy a second one.",
            },
            channel: {
              title: "The channel page a new viewer lands on", actor: "user-does",
              description: "Banner, a trailer, one playlist, and a sentence saying what the channel is for. Somebody who liked one video decides here whether to subscribe, and most channels leave it empty for months.",
            },
          },
        },
        {
          id: "SHIP.M3.4", title: "Landing page", actor: "nova-drafts", estimateMinutes: 45, tier: "artifact",
          description: "Headline from the product statement, three lines, one action.",
          variants: {
            physical: { description: "A page that explains it and takes an order: headline from the product statement, three lines, one action, and a photograph of the real thing rather than a render." },
            food: { description: "A page that says what it is, what is in it, and how to buy it. Ingredients and allergens on it, because somebody will look for them before they order." },
            channel: { description: "Not a website: the channel's About section and the one link in your bio. Same job as a landing page — a headline, three lines, one action — in the two places a new viewer actually looks." },
          },
        },
        {
          id: "SHIP.M3.5", title: "Analytics on the loop", actor: "nova-builds", estimateMinutes: 30, tier: "verified", sharedId: "SH-03",
          description: "Loop starts and completions visible. Powers week 4.",
          variants: {
            physical: {
              title: "What you'll count", actor: "nova-drafts", estimateMinutes: 20,
              description: "Four numbers, written somewhere you will actually update: units made, units sold, cost per unit, and reorders. A spreadsheet is fine. Reorders is the one that matters and the one nobody tracks.",
            },
            food: {
              title: "What you'll count", actor: "nova-drafts", estimateMinutes: 20,
              description: "Units made, units sold, units wasted, and what is left after everything. Waste is the number people avoid writing down and the one that decides whether this works.",
            },
            channel: {
              title: "The four numbers", actor: "nova-drafts", estimateMinutes: 20,
              description: "Impressions, click-through rate, average view duration, and subscribers gained per video. Nova explains what each one means when it moves — three of the four are easy to read backwards, and acting on a misread number is worse than ignoring it.",
            },
          },
        },
        {
          id: "SHIP.M3.6", title: "Feedback channel", actor: "nova-builds", estimateMinutes: 15, tier: "verified",
          description: "One click to reach you.",
          variants: {
            physical: { description: "One obvious way to reach you, on the insert and on the page. A product that arrives with no way to complain gets the complaint in a review instead.", actor: "nova-drafts" },
            food: { description: "One obvious way to reach you, on the label. For food this is not optional — it is the first thing somebody looks for when something is wrong with what they ate.", actor: "nova-drafts" },
            channel: {
              title: "Reply to every comment", actor: "user-does", estimateMinutes: 30,
              description: "Comments are the feedback channel, so this is a habit rather than a build: reply to every comment on the first ten videos. It is also the cheapest growth loop a new channel has.",
            },
          },
        },
        {
          id: "SHIP.M3.7", title: "Pricing", actor: "nova-drafts", estimateMinutes: 20, tier: "artifact", sharedId: "SH-02",
          description: "Nova proposes three models with reasoning. Free is a valid pick, offered as one rather than treated as avoidance.",
          variants: {
            app: { description: "Three models with reasoning, store constraints stated." },
            game: { description: "Premium, free-to-play, or demo-plus-paid. Free-to-play changes what gets built, so if you lean that way Nova will have raised it at the pitch." },
            physical: { description: "Three prices built up from your unit cost, each showing what is left after shipping and fees. Nova shows the arithmetic rather than asserting a number, and will say why the cheapest option is usually the wrong one." },
            food: { description: "Three prices from your cost per serving, each showing what is left after ingredients, packaging, waste, and the cut a stall or a shelf takes. Food margins are thinner than almost everybody expects, which is exactly why this one comes with the sums shown." },
            channel: {
              title: "How it earns",
              description: "Not a price but a route: sponsorship, affiliate, your own product, or ad share — and what each needs before it pays anything at all. Nova gives the realistic threshold for each, because \"ad revenue\" at a thousand views a month is not income and planning around it is how people quit.",
            },
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
          variants: {
            game: { description: "Ten playtesters, sourced from the genre's communities. People who don't like the genre give misleading feedback." },
            physical: { description: "Ten people who would actually buy it, by name — not ten people who will say something nice. The second list is easy to write and tells you nothing." },
            food: { description: "Ten people who already eat this kind of thing, by name. A friend being kind is worse than no data at all, because you will believe it." },
            channel: { description: "Ten people in the audience you are aiming at, by name — not ten friends. Friends watch out of loyalty, which looks like a signal on the graph and is not one." },
          },
        },
        {
          id: "SHIP.M4.2", title: "Send", actor: "user-does", estimateMinutes: 45, tier: "claimed",
          description: "Send the message to the ten. From your own address — a note from a person is opened; a note from a product is not.",
          variants: {
            physical: { title: "Get one into ten hands", description: "Posted, dropped off, or handed over. Note what each one cost you to get there — that number is part of the price whether or not you charge for it.", estimateMinutes: h(2) },
            food: { title: "Get it to the ten", description: "And be there when at least three of them eat it. Posting food to somebody and asking later loses the only part of the reaction that is honest.", estimateMinutes: h(2) },
            channel: { description: "Publish, then send it to the ten personally — not a post saying \"new video up\". From you, to them, one at a time. A note from a person is opened; an announcement is not." },
          },
        },
        {
          id: "SHIP.M4.3", title: "Watch three people use it", actor: "user-does", estimateMinutes: h(2), tier: "claimed",
          description: "No coaching. Note every hesitation. Nova provides the observation template and afterwards turns your notes into a ranked friction list.",
          variants: {
            game: { description: "Watch silently and note where they stop having fun, not where they get confused. Different failures, different fixes." },
            physical: { description: "Watch three people open it and use it for the first time, without helping. The first thirty seconds tell you most of it, and every hesitation is a thing to fix — somebody turning the box over looking for instructions is data." },
            food: { description: "Watch three people eat it. The face before the words is the honest part; a polite \"it's nice\" after a pause is a no, and the pause is the finding. Ask what they would change only after they have finished." },
            channel: { description: "Two things: watch the retention graph on your first episodes, and watch three people watch one. The graph says where they left, the people say why — and you need both, because the graph is confident and silent." },
          },
        },
        {
          id: "SHIP.M4.4", title: "Fix the top three frictions", actor: "nova-builds", estimateMinutes: h(4), tier: "verified",
          description: "From the ranked list.",
          variants: {
            physical: { actor: "user-does", description: "From the ranked list. Nova drafts each change and what it costs; the remaking is yours. Three is the cap on purpose — a first product can absorb three changes and not thirty." },
            food: { actor: "user-does", description: "From the ranked list — usually the recipe, the portion, or the packaging, in that order of how much it hurts to change." },
            channel: { actor: "user-does", description: "From the ranked list — usually the first fifteen seconds, the title, or the length. Fix them on the next video rather than re-cutting the old one." },
          },
        },
        {
          id: "SHIP.M4.5", title: "Read the signal", actor: "nova-drafts", estimateMinutes: 20, tier: "artifact",
          description: "Nova pulls the analytics and reports what they mean rather than asking you to interpret.",
          variants: {
            game: { description: "Session length, session-loop completion, and whether anyone played twice. Playing twice is the signal; everything else is secondary." },
            physical: { description: "Units sold, reorders, and cost per unit against the price you set. Nova reports what they mean. One reorder from a stranger is worth more than ten compliments, and the arithmetic is the part people skip." },
            food: { description: "Units sold, repeat buyers, and what was actually left after everything. Nova reports what they mean. A repeat buyer is the signal; a busy market day is not." },
            channel: { description: "Average view duration and whether anybody came back for a second video. Returning viewers are the signal — views are the thing that feels like the signal and is not." },
          },
        },
        {
          id: "SHIP.M4.6", title: "Decide what's next", actor: "user-decides", estimateMinutes: 15, tier: "artifact",
          description: "Continue, adjust the loop, or move to another path. Nova makes the case for each from what the numbers said. The deferred roadmap becomes next month's scope if continuing.",
          variants: {
            physical: { description: "Continue, change the product, or stop. Nova makes the case for each from what sold. For a physical product there is a fourth option worth naming: the same thing made cheaper, which is often the one that turns a near-miss into a business." },
            food: { description: "Continue, change the recipe, change where you sell it, or stop. Nova makes the case for each from the numbers. Changing where you sell is the move people consider last and it is frequently the right one." },
            channel: { description: "Continue the cadence, change the format, or stop. Nova makes the case from retention rather than from subscribers. Four weeks is too early to judge a channel and exactly right to judge whether you can keep doing it." },
          },
        },
      ],
    },
  ],
};
