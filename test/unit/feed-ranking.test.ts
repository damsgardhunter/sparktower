/**
 * Feed ranking, on its own.
 *
 * The tests here are the promises the ranked feed makes: it knows what you
 * work on, it knows who you follow, and it still shows you today's news first.
 */
import { describe, it, expect } from "vitest";
import {
  rankFeed, scorePost, recencyScore, engagementScore, topicScore, viewerTerms,
  emptyAffinity, RECENCY_HALF_LIFE_MS, MAX_AFFINITY_MULTIPLIER, type RankablePost, type ViewerAffinity,
} from "@shared/feed-ranking";

const NOW = Date.parse("2026-09-16T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000);

const post = (over: Partial<RankablePost> & { id: string }): RankablePost => ({
  authorId: "someone",
  content: "",
  reactionCount: 0,
  commentCount: 0,
  createdAt: hoursAgo(1),
  ...over,
});

const viewer = (over: Partial<ViewerAffinity> = {}): ViewerAffinity => ({ ...emptyAffinity(), ...over });

describe("recency", () => {
  it("is 1 right now and a half at one half-life", () => {
    expect(recencyScore(new Date(NOW), NOW)).toBeCloseTo(1);
    expect(recencyScore(new Date(NOW - RECENCY_HALF_LIFE_MS), NOW)).toBeCloseTo(0.5);
  });

  it("treats a post from the future as new rather than as negative", () => {
    expect(recencyScore(new Date(NOW + 10_000), NOW)).toBeCloseTo(1);
  });

  it("reads an ISO string as well as a Date — that's what arrives over JSON", () => {
    expect(recencyScore(new Date(NOW).toISOString(), NOW)).toBeCloseTo(1);
  });
});

describe("engagement", () => {
  it("counts a reply for more than a reaction", () => {
    expect(engagementScore(post({ id: "a", commentCount: 5 })))
      .toBeGreaterThan(engagementScore(post({ id: "b", reactionCount: 5 })));
  });

  it("saturates, so one viral post can't own the page", () => {
    expect(engagementScore(post({ id: "a", reactionCount: 10_000 }))).toBeLessThanOrEqual(1);
  });

  it("is 0 for a post nobody has touched", () => {
    expect(engagementScore(post({ id: "a" }))).toBe(0);
  });
});

describe("topic", () => {
  const me = viewer({ terms: viewerTerms({ skills: ["Payments", "Postgres"], interests: ["fintech"] }) });

  it("matches on what the post says", () => {
    expect(topicScore(post({ id: "a", content: "Shipped the payments ledger on Postgres today" }), me))
      .toBeGreaterThan(0);
  });

  it("matches on the author's stack even when the post says nothing useful", () => {
    expect(topicScore(post({ id: "a", content: "shipped it 🚀", profile: { skills: ["Payments", "Postgres"] } }), me))
      .toBeGreaterThan(0);
  });

  it("is 0 when we know nothing about the viewer", () => {
    expect(topicScore(post({ id: "a", content: "payments postgres fintech" }), emptyAffinity())).toBe(0);
  });

  /* Otherwise every long post matches everything, just by having more words in it. */
  it("doesn't reward a wall of text for being long", () => {
    const padded = post({ id: "a", content: "x ".repeat(2000) + "payments postgres fintech" });
    expect(topicScore(padded, me)).toBe(0);
  });
});

describe("ranking a page", () => {
  it("leaves a signed-out reader with something very close to the timeline", () => {
    const posts = [post({ id: "new", createdAt: hoursAgo(1) }), post({ id: "old", createdAt: hoursAgo(72) })];
    expect(rankFeed(posts, emptyAffinity(), NOW).map((p) => p.id)).toEqual(["new", "old"]);
  });

  it("puts a relevant post above an irrelevant one from the same hour", () => {
    const posts = [
      post({ id: "irrelevant", content: "thoughts on sourdough", createdAt: hoursAgo(2) }),
      post({ id: "relevant", content: "our payments ledger on postgres", createdAt: hoursAgo(2) }),
    ];
    const me = viewer({ terms: viewerTerms({ skills: ["payments", "postgres"] }) });
    expect(rankFeed(posts, me, NOW)[0].id).toBe("relevant");
  });

  it("lifts people you follow above strangers", () => {
    const posts = [
      post({ id: "stranger", authorId: "nobody", createdAt: hoursAgo(3) }),
      post({ id: "followed", authorId: "friend", createdAt: hoursAgo(4) }),
    ];
    const me = viewer({ followedAuthorIds: new Set(["friend"]) });
    expect(rankFeed(posts, me, NOW)[0].id).toBe("followed");
  });

  it("puts your own project's posts first", () => {
    const posts = [
      post({ id: "theirs", createdAt: hoursAgo(1) }),
      post({ id: "mine", projectId: "p1", createdAt: hoursAgo(5) }),
    ];
    const me = viewer({ ownProjectIds: new Set(["p1"]) });
    expect(rankFeed(posts, me, NOW)[0].id).toBe("mine");
  });

  /*
   * The line the whole design rests on: relevance reorders a page, it does not
   * turn the feed into a greatest-hits list. A perfect match from last week
   * must not beat a decent post from an hour ago.
   */
  it("does not let a week-old perfect match outrank an hour-old ordinary post", () => {
    const me = viewer({
      terms: viewerTerms({ skills: ["payments", "postgres", "ledgers"] }),
      followedAuthorIds: new Set(["friend"]),
      connectedUserIds: new Set(["friend"]),
      categories: new Set(["fintech"]),
    });
    const perfectButOld = post({
      id: "old", authorId: "friend", createdAt: hoursAgo(24 * 7),
      content: "payments postgres ledgers", reactionCount: 50,
      project: { id: "p9", title: "Ledger", category: "fintech" },
    });
    const ordinaryButNew = post({ id: "new", authorId: "nobody", createdAt: hoursAgo(1), content: "hello" });

    expect(rankFeed([perfectButOld, ordinaryButNew], me, NOW)[0].id).toBe("new");
  });

  it("is stable: posts that score the same keep the order they arrived in", () => {
    const at = hoursAgo(2);
    const posts = ["a", "b", "c", "d"].map((id) => post({ id, createdAt: at }));
    expect(rankFeed(posts, emptyAffinity(), NOW).map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("returns every post it was given — ranking reorders, it never filters", () => {
    const posts = Array.from({ length: 20 }, (_, i) => post({ id: `p${i}`, createdAt: hoursAgo(i) }));
    const ranked = rankFeed(posts, viewer({ terms: viewerTerms({ skills: ["go"] }) }), NOW);
    expect(ranked).toHaveLength(20);
    expect(new Set(ranked.map((p) => p.id)).size).toBe(20);
  });

  it("discounts automated posts against a person's own words from the same moment", () => {
    const at = hoursAgo(2);
    const posts = [
      { ...post({ id: "system", createdAt: at }), isSystemGenerated: true },
      post({ id: "written", createdAt: at }),
    ];
    expect(rankFeed(posts, emptyAffinity(), NOW)[0].id).toBe("written");
  });

  it("does not discount your own project's automated posts — that's your progress", () => {
    const at = hoursAgo(2);
    const mine = { ...post({ id: "mine", projectId: "p1", createdAt: at }), isSystemGenerated: true };
    const me = viewer({ ownProjectIds: new Set(["p1"]) });
    expect(scorePost(mine, me, NOW).score).toBeGreaterThan(scorePost(post({ id: "other", createdAt: at }), me, NOW).score);
  });
});

describe("the bound on relevance", () => {
  it("caps how far affinity can lift a post", () => {
    const me = viewer({
      terms: viewerTerms({ skills: ["payments", "postgres", "ledgers", "stripe", "fintech"] }),
      followedAuthorIds: new Set(["friend"]),
      connectedUserIds: new Set(["friend"]),
      categories: new Set(["fintech"]),
      ownProjectIds: new Set(["p9"]),
    });
    const best = post({
      id: "best", authorId: "friend", projectId: "p9", createdAt: new Date(NOW),
      content: "payments postgres ledgers stripe fintech", reactionCount: 500, commentCount: 500,
      project: { id: "p9", title: "Ledger", category: "fintech" },
    });
    expect(scorePost(best, me, NOW).affinity).toBeLessThanOrEqual(MAX_AFFINITY_MULTIPLIER);
  });

  it("gives a post with no connection to you its freshness and nothing else", () => {
    const plain = post({ id: "a", createdAt: hoursAgo(3) });
    const { score, affinity } = scorePost(plain, emptyAffinity(), NOW);
    expect(affinity).toBe(1);
    expect(score).toBeCloseTo(recencyScore(hoursAgo(3), NOW));
  });

  /*
   * The guarantee, stated as the thing it protects: relevance buys a post
   * roughly log2(MAX_AFFINITY_MULTIPLIER) half-lives of extra life, and no
   * more. Past that window, newer wins however good the match.
   */
  it("cannot lift a post past more than ~1.5 half-lives of fresher ones", () => {
    const halfLivesBought = Math.log2(MAX_AFFINITY_MULTIPLIER);
    expect(halfLivesBought).toBeLessThan(1.5);
  });
});
