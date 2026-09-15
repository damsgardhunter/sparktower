# 0001 — The path loops first

**Status:** decided · **Date:** 2026-09-15 · **Revisit:** when the wedge proof below is met, or after four cohorts if it isn't

## The decision

The three path loops — **Ship an MVP, Systemize a business, Raise funding** — are SparkTower's wedge. They are the default experience and the primary navigation, and new work goes to them and to what they directly need. Every other surface stays built, tested and switchable, but is **secondary** in the UI and **gets no new work** until the wedge is proven.

## What "proven" means

**Proposed thresholds — replace them with the numbers you'd actually bet on.**

> Path loops retain: of builders who start a path, **40% finish a step in week 2** and **25% publish a step or update in week 4**, for **four cohorts running**.

(Also in code as `WEDGE_PROOF` in `shared/surfaces.ts`, and shown on `/admin/surfaces`.) Until then, the answer to "should we build X in contests / messages / backing…" is no — unless it's a fix, a safety issue, or it directly moves one of those two numbers.

## How it's enforced

| Rule | Where | Checked by |
|---|---|---|
| Every surface has a `sequence` (`wedge`, `supports`, `after-wedge`), and every after-wedge surface says what unlocks it | `shared/surfaces.ts` (`sequence`, `unlocksWhen`) | `test/unit/route-guards.test.ts` ("the sequencing decision") |
| Every API route of an after-wedge surface is behind its flag, so turning it off turns it off | `SURFACE_API_PREFIXES` | `test/unit/route-guards.test.ts` — recognises each family by name, so a new merch or messages route fails until it's flagged |
| The primary nav is the path loops only; after-wedge surfaces are secondary and named by their flag | `client/src/lib/navigation.ts` (`PRIMARY_NAV`, `SECONDARY_NAV`), `client/src/components/app-sidebar.tsx` | `test/unit/navigation.test.ts` |
| Entry points to after-wedge surfaces disappear with their flag | Home rail (leaderboard, matches), project page (backing, investor, storyboards), project tabs (`surface` on `TabDef`) | the flags, read with `useSurfaces()` |
| The decision is visible where switches are flipped | `/admin/surfaces` | — |

## The sequence

| Sequence | Surfaces | Why |
|---|---|---|
| **Wedge** | projects, signup, uploads, tasks, milestones, Nova, feed (publishing steps and artifacts, feedback) | The path loops can't run without them |
| **Supports** | roadmap, codebase audit, editor bridge (MCP), documents, personas, investor tools, launch/legal/pricing, Discover | A path step asks for them (the Fund path's personas, documents, legal and pitch deck; pricing on Ship and Systemize), or they close a path loop (the audit, Discover as where a published step lands) |
| **After the wedge** | backing & merch, storyboards & video, matches, sprints, connections, messages, leaderboard, contests, communities, live chat | Real, but they need people, money or marketing the wedge hasn't earned yet. Each lists its own unlock condition |

## Consequences

- The web home leads with Create Project and your paths; your projects' paths lead the right rail; the network cards follow, only while their flags are on.
- The sidebar's **Build** group is Home and Projects; everything else is under **More**.
- Mobile follows the same flags in its More screen; its tab bar (Home, Network, +, Alerts, Projects) is unchanged by this decision.
- Moving a surface out of `after-wedge` is a change to this file and to `shared/surfaces.ts` in the same commit, with the evidence that its unlock condition was met.
