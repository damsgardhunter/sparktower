/**
 * What the home feed shows first.
 *
 * The feed used to be strictly newest-first, which is the right default for
 * ten posts and the wrong one for ten thousand: a designer's first week on the
 * platform is a wall of infrastructure updates from projects they have nothing
 * to do with. This ranks each page by how much a post has to do with *you* —
 * your skills, your interests, what you've worked on before, and who you
 * already pay attention to — against how recent it is.
 *
 * Two deliberate constraints:
 *
 *   - Ranking happens *within a page*, never across the whole table. The feed
 *     is cursor-paginated on `created_at`; if ranking could pull a post from
 *     three months ago to the top, the cursor would no longer describe where
 *     you are and pages would repeat and skip. So each page is still a
 *     chronological window — it's the order inside the window that changes.
 *
 *   - Recency is a multiplier, not a term. Relevance scales a post's freshness
 *     rather than being added to it, which bounds what relevance can buy: at
 *     most `MAX_AFFINITY_MULTIPLIER`, and so at most `log2` of that many
 *     half-lives of extra life — a shade over two days. A perfectly matched
 *     post from last week therefore cannot outrank an ordinary one from this
 *     morning, no matter how well the feed knows you. Added weights had
 *     exactly that failure, and the unit test for it is what caught them.
 *
 * Pure, so the weights are testable: see test/unit/feed-ranking.test.ts.
 */
import { tokenize } from "./matching";

/** What we know about the person reading, gathered once per request. */
export interface ViewerAffinity {
  /** Skills, interests and résumé terms, already tokenized and lowercased. */
  terms: ReadonlySet<string>;
  /** Categories of projects they own or are on. */
  categories: ReadonlySet<string>;
  /** Builders they follow. */
  followedAuthorIds: ReadonlySet<string>;
  /** Projects they follow. */
  followedProjectIds: ReadonlySet<string>;
  /** People they're connected to. */
  connectedUserIds: ReadonlySet<string>;
  /** Projects they own or are a member of — their own posts and teammates'. */
  ownProjectIds: ReadonlySet<string>;
}

export const emptyAffinity = (): ViewerAffinity => ({
  terms: new Set(),
  categories: new Set(),
  followedAuthorIds: new Set(),
  followedProjectIds: new Set(),
  connectedUserIds: new Set(),
  ownProjectIds: new Set(),
});

/** The parts of a post ranking looks at. Structural, so the server passes rows straight in. */
export interface RankablePost {
  id: string;
  authorId: string;
  projectId?: string | null;
  postType?: string | null;
  content?: string | null;
  reactionCount?: number | null;
  commentCount?: number | null;
  createdAt: Date | string;
  /** The post's project, for its category and title. */
  project?: { id: string; title?: string | null; category?: string | null } | null;
  /** The author's profile, for their skills and headline. */
  profile?: { skills?: string[] | null; interests?: string[] | null; headline?: string | null } | null;
}

// ─── Weights ─────────────────────────────────────────────────────────────────

/**
 * What each affinity signal adds to a post's multiplier.
 *
 * A post with no connection to you at all scores its recency and nothing more
 * (multiplier 1). Every signal below stacks on top, to a ceiling of
 * `MAX_AFFINITY_MULTIPLIER`.
 */
export const FEED_WEIGHTS = {
  /** Words in the post and its project that match what you work on. */
  topic: 0.45,
  /** Same project category as something you build. */
  category: 0.25,
  /** You follow the author, or the project. */
  following: 0.35,
  /** You're connected to the author. */
  connection: 0.2,
  /** Other people are reacting and replying. */
  engagement: 0.2,
} as const;

/** Posts on your own projects always sit at the top of their page — they're yours. */
export const OWN_PROJECT_BONUS = 0.6;

/**
 * System posts are announcements, not conversation. A constant discount so a
 * burst of automated milestone posts can't crowd out the things people wrote.
 */
export const SYSTEM_POST_PENALTY = 0.25;

/**
 * The most relevance can multiply a post's freshness by.
 *
 * This is the whole "don't bury today" guarantee, as a number: a post can be
 * lifted past at most log2(2.5) ≈ 1.3 half-lives of newer posts. With a
 * two-day half-life that's a little over two and a half days — long enough for
 * the right post to find you on a Monday, short enough that last week stays
 * last week.
 */
export const MAX_AFFINITY_MULTIPLIER = 2.5;

/** How long a post takes to lose half its freshness. Two days: long enough to carry a weekend. */
export const RECENCY_HALF_LIFE_MS = 48 * 60 * 60 * 1000;

// ─── Scoring ─────────────────────────────────────────────────────────────────

const asMs = (value: Date | string): number => {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
};

/** 1 for right now, 0.5 at one half-life, approaching 0 after that. Never negative. */
export function recencyScore(createdAt: Date | string, now: number): number {
  const ageMs = Math.max(0, now - asMs(createdAt));
  return Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS);
}

/**
 * Reactions and replies, flattened.
 *
 * Logarithmic, and replies count double: a post with twenty comments is a
 * conversation, a post with twenty likes is a nod. Saturates so one viral post
 * can't own the page for a week.
 */
export function engagementScore(post: RankablePost): number {
  const weighted = (post.reactionCount ?? 0) + (post.commentCount ?? 0) * 2;
  return Math.min(1, Math.log1p(weighted) / Math.log1p(30));
}

/**
 * How much the post is about things you work on.
 *
 * Read from what the post says, what its project is called and categorized as,
 * and the author's own stated skills — a post from someone whose stack is
 * yours is relevant even when its text happens to be "shipped it 🚀".
 */
export function topicScore(post: RankablePost, viewer: ViewerAffinity): number {
  if (!viewer.terms.size) return 0;

  const postTerms = new Set([
    // Only the first stretch of a post: past that it's a blog entry, and
    // every long post would match everything.
    ...tokenize((post.content ?? "").slice(0, 600)),
    ...tokenize(post.project?.title ?? ""),
    ...tokenize(post.project?.category ?? ""),
    ...tokenize(post.profile?.headline ?? ""),
    ...(post.profile?.skills ?? []).flatMap(tokenize),
    ...(post.profile?.interests ?? []).flatMap(tokenize),
  ]);
  if (!postTerms.size) return 0;

  const shared = [...postTerms].filter((t) => viewer.terms.has(t)).length;
  // Five shared terms is already "this is my field"; the curve saturates there
  // so a keyword-stuffed post gains nothing from the sixth.
  return Math.min(1, shared / 5);
}

/** Whether this post's project is the kind of thing you build. */
export function categoryScore(post: RankablePost, viewer: ViewerAffinity): number {
  const category = post.project?.category?.toLowerCase().trim();
  return category && viewer.categories.has(category) ? 1 : 0;
}

/** Your relationship to whoever wrote it: followed, connected, or neither. */
export function networkScore(post: RankablePost, viewer: ViewerAffinity): { following: number; connection: number } {
  const following =
    viewer.followedAuthorIds.has(post.authorId) ||
    (post.projectId ? viewer.followedProjectIds.has(post.projectId) : false)
      ? 1
      : 0;
  return { following, connection: viewer.connectedUserIds.has(post.authorId) ? 1 : 0 };
}

export interface FeedScore {
  score: number;
  /** The freshness the score is built on, and what relevance multiplied it by. */
  recency: number;
  affinity: number;
  parts: { recency: number; topic: number; category: number; following: number; connection: number; engagement: number };
}

/**
 * One post's score: its freshness, scaled by how much it has to do with you.
 *
 * Scores are not percentages and aren't comparable between requests — only the
 * order within one page is meaningful.
 */
export function scorePost(post: RankablePost, viewer: ViewerAffinity, now = Date.now()): FeedScore {
  const parts = {
    recency: recencyScore(post.createdAt, now),
    topic: topicScore(post, viewer),
    category: categoryScore(post, viewer),
    ...networkScore(post, viewer),
    engagement: engagementScore(post),
  };

  const ownProject = !!post.projectId && viewer.ownProjectIds.has(post.projectId);

  let affinity =
    1 +
    parts.topic * FEED_WEIGHTS.topic +
    parts.category * FEED_WEIGHTS.category +
    parts.following * FEED_WEIGHTS.following +
    parts.connection * FEED_WEIGHTS.connection +
    parts.engagement * FEED_WEIGHTS.engagement;

  if (ownProject) affinity += OWN_PROJECT_BONUS;
  // Not for your own project's automated posts — those are your progress.
  if ((post as { isSystemGenerated?: boolean }).isSystemGenerated && !ownProject) {
    affinity -= SYSTEM_POST_PENALTY;
  }

  // Clamped at both ends: the ceiling is the guarantee above, and the floor
  // keeps a penalised post behind its peers rather than behind everything.
  affinity = Math.max(0.5, Math.min(MAX_AFFINITY_MULTIPLIER, affinity));

  return { score: parts.recency * affinity, recency: parts.recency, affinity, parts };
}

/**
 * A page of posts, most relevant first.
 *
 * Stable: equal scores keep the order they came in, which is newest-first from
 * the database, so ranking never shuffles a tie at random between two loads.
 * With nothing known about the viewer every post scores on recency and
 * engagement alone, and the result is very close to the chronological feed —
 * which is what a signed-out reader should get.
 */
export function rankFeed<T extends RankablePost>(posts: T[], viewer: ViewerAffinity, now = Date.now()): T[] {
  const scored = posts.map((post, index) => ({ post, index, score: scorePost(post, viewer, now).score }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.post);
}

/**
 * The vocabulary a viewer's feed is matched against: their skills, their
 * interests, their project categories, and the words from their own headline.
 */
export function viewerTerms(profile: {
  skills?: string[] | null;
  interests?: string[] | null;
  headline?: string | null;
} | null | undefined, extra: string[] = []): Set<string> {
  if (!profile && !extra.length) return new Set();
  return new Set([
    ...(profile?.skills ?? []).flatMap(tokenize),
    ...(profile?.interests ?? []).flatMap(tokenize),
    ...tokenize(profile?.headline ?? ""),
    ...extra.flatMap(tokenize),
  ]);
}
