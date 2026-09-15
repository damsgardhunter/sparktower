/**
 * The founder feed's vocabulary, for the app: post types, reactions, limits
 * and the shapes the feed endpoints return.
 *
 * Restated from shared/feed.ts, shared/feedback-loop.ts and shared/moderation.ts
 * rather than imported — Metro can't resolve the web app's `@shared` alias, and
 * those files pull in Drizzle. Keep in sync when a type or reaction is added.
 */
import type { IconName } from "./ui";

export type PostType =
  | "project_update" | "looking_for_help" | "looking_for_cofounder" | "seeking_feedback"
  | "milestone" | "idea_validation" | "launch" | "investor_update";

export type Reaction = "like" | "celebrate" | "support" | "insightful" | "funny";

export interface PostTypeDef {
  type: PostType;
  label: string;
  hint: string;
  placeholder: string;
  starters: string[];
  icon: IconName;
}

export const POST_TYPES: PostTypeDef[] = [
  {
    type: "project_update", label: "Project Update", icon: "rocket-outline",
    hint: "Share what you shipped or learned this week",
    placeholder: "Finished our onboarding flow — signups now take 40 seconds instead of four minutes.",
    starters: ["This week we shipped…", "We just finished…", "Something we learned the hard way…"],
  },
  {
    type: "looking_for_help", label: "Looking for Help", icon: "hand-left-outline",
    hint: "Ask for a specific skill or a hand with something",
    placeholder: "Need someone with React experience to help untangle our matching UI — a couple of hours would unblock us.",
    starters: ["Need someone with … experience", "Stuck on … — has anyone solved this?", "Looking for a hand with…"],
  },
  {
    type: "looking_for_cofounder", label: "Looking for Cofounder", icon: "people-outline",
    hint: "You want someone to build this with you, properly",
    placeholder: "Looking for a technical cofounder for a campus study-matching app. I've got 20 user interviews and a design; I need someone who wants to own the build.",
    starters: ["Looking for a cofounder who…", "I've got … and I need someone who…", "Want to build … with me?"],
  },
  {
    type: "seeking_feedback", label: "Seeking Feedback", icon: "chatbox-ellipses-outline",
    hint: "Put something in front of people and ask what's wrong with it",
    placeholder: "Here's our landing page. Would you sign up? If not, what stopped you?",
    starters: ["Would you use this? Why not?", "Which of these two is clearer?", "Tearing this apart would genuinely help…"],
  },
  {
    type: "milestone", label: "Milestone", icon: "flag-outline",
    hint: "Something real just happened — say it out loud",
    placeholder: "100 students signed up in the first week. We expected 20.",
    starters: ["We just hit…", "First … ever!", "Six weeks ago this didn't exist. Today…"],
  },
  {
    type: "idea_validation", label: "Idea Validation", icon: "bulb-outline",
    hint: "Test an idea before you build it",
    placeholder: "Thinking about a tool that tells you which of your classes has the most people looking for study partners. Would that be useful, or is it a solution to a non-problem?",
    starters: ["Would you pay for…", "Does this problem exist for you?", "Thinking about building … — talk me out of it"],
  },
  {
    type: "launch", label: "Launch", icon: "sparkles-outline",
    hint: "It's live. Tell everyone",
    placeholder: "StudyBuddy Match is live for anyone at three campuses. Find a study partner in under two minutes.",
    starters: ["It's live 🚀", "After … months, we're launching…", "You can finally try…"],
  },
  {
    type: "investor_update", label: "Investor Update", icon: "trending-up-outline",
    hint: "The numbers and the honest state of things",
    placeholder: "Month 3: 420 weekly actives (+38%), 12% paid conversion, 9 months runway. Biggest risk is retention past week four.",
    starters: ["Month …: here's where we are", "Numbers this month…", "What went well, what didn't…"],
  },
];

/** What a person picks when writing: milestones post themselves, and feedback asks are part of any project post. */
export const COMPOSER_POST_TYPES = POST_TYPES.filter((t) => t.type !== "milestone" && t.type !== "seeking_feedback");
export const QUICK_POST_TYPES = COMPOSER_POST_TYPES.slice(0, 3);
export const postTypeDef = (type: string): PostTypeDef =>
  POST_TYPES.find((t) => t.type === type) ?? POST_TYPES[0];

/**
 * The card badge colours from shared/feed.ts `accent` (Tailwind's -600 text,
 * a 15% tint behind it and a 30% border), as plain values.
 */
export const POST_TYPE_ACCENTS: Record<PostType, { text: string; bg: string; border: string }> = {
  project_update: { text: "#2563EB", bg: "rgba(59,130,246,0.15)", border: "rgba(59,130,246,0.30)" },
  looking_for_help: { text: "#D97706", bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.30)" },
  looking_for_cofounder: { text: "#7C3AED", bg: "rgba(139,92,246,0.15)", border: "rgba(139,92,246,0.30)" },
  seeking_feedback: { text: "#0891B2", bg: "rgba(6,182,212,0.15)", border: "rgba(6,182,212,0.30)" },
  milestone: { text: "#059669", bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.30)" },
  idea_validation: { text: "#CA8A04", bg: "rgba(234,179,8,0.15)", border: "rgba(234,179,8,0.30)" },
  launch: { text: "#E11D48", bg: "rgba(244,63,94,0.15)", border: "rgba(244,63,94,0.30)" },
  investor_update: { text: "#475569", bg: "rgba(100,116,139,0.15)", border: "rgba(100,116,139,0.30)" },
};
export const postTypeAccent = (type: string) => POST_TYPE_ACCENTS[type as PostType] ?? POST_TYPE_ACCENTS.project_update;

export interface ReactionDef { reaction: Reaction; label: string; emoji: string; icon: IconName; color: string }

/** The same emoji as the website, and the colour a reaction's label takes when it's yours. */
export const REACTIONS: ReactionDef[] = [
  { reaction: "like", label: "Like", emoji: "👍", icon: "thumbs-up", color: "#2563EB" },
  { reaction: "celebrate", label: "Celebrate", emoji: "🎉", icon: "sparkles", color: "#059669" },
  { reaction: "support", label: "Support", emoji: "🙌", icon: "heart", color: "#7C3AED" },
  { reaction: "insightful", label: "Insightful", emoji: "💡", icon: "bulb", color: "#D97706" },
  { reaction: "funny", label: "Funny", emoji: "😄", icon: "happy", color: "#E11D48" },
];
export const reactionDef = (r?: string | null): ReactionDef | undefined => REACTIONS.find((x) => x.reaction === r);

export const MAX_POST_LENGTH = 3000;
export const MAX_COMMENT_LENGTH = 1000;
export const MAX_POST_MEDIA = 6;
export const MAX_ASKS = 4;
export const ASK_MAX = 200;

export interface Mention { userId: string; name: string }

export interface FeedPost {
  id: string;
  authorId: string;
  projectId: string | null;
  postType: PostType;
  content: string;
  mediaUrls: string[] | null;
  mentions: Mention[] | null;
  asks?: string[] | null;
  reactionCount: number;
  commentCount: number;
  isSystemGenerated: boolean;
  createdAt: string;
  author: { id: string; firstName?: string | null; lastName?: string | null; email?: string | null; profileImageUrl?: string | null };
  profile?: { displayName?: string | null; headline?: string | null; avatarUrl?: string | null } | null;
  project: { id: string; title: string; isPrivate: boolean } | null;
  viewerReaction: Reaction | null;
  reactionBreakdown: { reaction: string; count: number }[];
  viewerIsTeam?: boolean;
  credits?: { commentId: string; authorId: string; name: string }[];
  pathStep?: { taskId: string; title: string } | null;
  /** A weekly progress update: the path steps it shared. */
  pathWeek?: { steps: { taskId: string; title: string }[] } | null;
}

export interface FeedPage { posts: FeedPost[]; nextCursor: string | null; followingCount?: number }

export interface FeedComment {
  id: string;
  postId: string;
  authorId: string;
  content: string;
  mentions: Mention[] | null;
  parentCommentId: string | null;
  createdAt: string;
  author?: FeedPost["author"];
  profile?: FeedPost["profile"];
  reactionCount: number;
  viewerReaction: Reaction | null;
  reactionBreakdown: { reaction: string; count: number }[];
  hidden: boolean;
  hiddenReason?: string | null;
  deleted: boolean;
  byTeam?: boolean;
  appliedAt?: string | null;
  closedByPostId?: string | null;
}

export const authorName = (p: { author?: FeedPost["author"]; profile?: FeedPost["profile"] }) =>
  p.profile?.displayName || [p.author?.firstName, p.author?.lastName].filter(Boolean).join(" ") || p.author?.email || "Someone";
export const authorAvatar = (p: { author?: FeedPost["author"]; profile?: FeedPost["profile"] }) =>
  p.profile?.avatarUrl || p.author?.profileImageUrl || null;

/** "Acts on feedback from Ann and Ben." — shared/feedback-loop.ts creditLine. */
export function creditLine(names: string[]): string {
  const unique = [...new Set(names.filter(Boolean))];
  if (!unique.length) return "";
  const who = unique.length === 1 ? unique[0]
    : unique.length === 2 ? `${unique[0]} and ${unique[1]}`
    : `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
  return `Acts on feedback from ${who}.`;
}

// --- Reports (shared/moderation.ts) --------------------------------------

export type ReportTarget = "feed_post" | "feed_comment" | "comment";
export const REPORT_NOTE_MAX = 500;
export const REPORT_REASONS = [
  { id: "spam", label: "Spam or advertising" },
  { id: "abuse", label: "Harassment or abuse" },
  { id: "misleading", label: "Misleading or fake" },
  { id: "inappropriate", label: "Sexual or graphic content" },
  { id: "other", label: "Something else" },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["id"];
export const REPORT_REASON_DETAILS: Record<ReportReason, { id: string; label: string }[]> = {
  spam: [
    { id: "selling", label: "Selling or advertising something" },
    { id: "repeated", label: "The same post over and over" },
    { id: "scam_link", label: "A link to a scam or malware" },
  ],
  abuse: [
    { id: "targets_me", label: "It's aimed at me" },
    { id: "targets_other", label: "It's aimed at someone else" },
    { id: "hate", label: "Hate based on who someone is" },
  ],
  misleading: [
    { id: "fake_project", label: "The project or progress is made up" },
    { id: "impersonation", label: "Pretending to be someone else" },
    { id: "fraud", label: "Asking for money under false pretences" },
  ],
  inappropriate: [
    { id: "sexual", label: "Sexual content" },
    { id: "violent", label: "Violence or gore" },
  ],
  other: [
    { id: "off_topic", label: "Not about building anything" },
    { id: "private_info", label: "Shares someone's private information" },
    { id: "something_else", label: "Something else — I'll explain" },
  ],
};

