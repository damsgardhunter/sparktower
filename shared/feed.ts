/**
 * Founder feed presentation config.
 *
 * Single source of truth for post types — the composer's suggestion chips, the
 * placeholder prompts, and the label/colour on each post card all read from
 * here, so adding a type wires it into the whole feed.
 */
import type { FeedPostType, FeedReaction } from "./schema";

export interface PostTypeDef {
  type: FeedPostType;
  /** Short label on the card badge and composer chip. */
  label: string;
  /** One line explaining when to use it, shown in the composer picker. */
  hint: string;
  /** Placeholder in the textarea — a concrete example, not "write something". */
  placeholder: string;
  /** Prompts shown as clickable starters when the box is empty. */
  starters: string[];
  /** lucide-react icon name, resolved client-side. */
  icon: string;
  /** Tailwind classes for the card badge. */
  accent: string;
}

export const POST_TYPES: PostTypeDef[] = [
  {
    type: "project_update",
    label: "Project Update",
    hint: "Share what you shipped or learned this week",
    placeholder: "Finished our onboarding flow — signups now take 40 seconds instead of four minutes.",
    starters: [
      "This week we shipped…",
      "We just finished…",
      "Something we learned the hard way…",
    ],
    icon: "Rocket",
    accent: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  },
  {
    type: "looking_for_help",
    label: "Looking for Help",
    hint: "Ask for a specific skill or a hand with something",
    placeholder: "Need someone with React experience to help untangle our matching UI — a couple of hours would unblock us.",
    starters: [
      "Need someone with … experience",
      "Stuck on … — has anyone solved this?",
      "Looking for a hand with…",
    ],
    icon: "HelpingHand",
    accent: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  {
    type: "looking_for_cofounder",
    label: "Looking for Cofounder",
    hint: "You want someone to build this with you, properly",
    placeholder: "Looking for a technical cofounder for a campus study-matching app. I've got 20 user interviews and a design; I need someone who wants to own the build.",
    starters: [
      "Looking for a cofounder who…",
      "I've got … and I need someone who…",
      "Want to build … with me?",
    ],
    icon: "Handshake",
    accent: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
  },
  {
    type: "seeking_feedback",
    label: "Seeking Feedback",
    hint: "Put something in front of people and ask what's wrong with it",
    placeholder: "Here's our landing page. Would you sign up? If not, what stopped you?",
    starters: [
      "Would you use this? Why not?",
      "Which of these two is clearer?",
      "Tearing this apart would genuinely help…",
    ],
    icon: "MessageSquareQuote",
    accent: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30",
  },
  {
    type: "milestone",
    label: "Milestone",
    hint: "Something real just happened — say it out loud",
    placeholder: "100 students signed up in the first week. We expected 20.",
    starters: [
      "We just hit…",
      "First … ever!",
      "Six weeks ago this didn't exist. Today…",
    ],
    icon: "Flag",
    accent: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  {
    type: "idea_validation",
    label: "Idea Validation",
    hint: "Test an idea before you build it",
    placeholder: "Thinking about a tool that tells you which of your classes has the most people looking for study partners. Would that be useful, or is it a solution to a non-problem?",
    starters: [
      "Would you pay for…",
      "Does this problem exist for you?",
      "Thinking about building … — talk me out of it",
    ],
    icon: "Lightbulb",
    accent: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  },
  {
    type: "launch",
    label: "Launch",
    hint: "It's live. Tell everyone",
    placeholder: "StudyBuddy Match is live for anyone at three campuses. Find a study partner in under two minutes.",
    starters: [
      "It's live 🚀",
      "After … months, we're launching…",
      "You can finally try…",
    ],
    icon: "PartyPopper",
    accent: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
  },
  {
    type: "investor_update",
    label: "Investor Update",
    hint: "The numbers and the honest state of things",
    placeholder: "Month 3: 420 weekly actives (+38%), 12% paid conversion, 9 months runway. Biggest risk is retention past week four.",
    starters: [
      "Month …: here's where we are",
      "Numbers this month…",
      "What went well, what didn't…",
    ],
    icon: "TrendingUp",
    accent: "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30",
  },
];

export const POST_TYPES_BY_KEY: Record<FeedPostType, PostTypeDef> = Object.fromEntries(
  POST_TYPES.map((p) => [p.type, p])
) as Record<FeedPostType, PostTypeDef>;

export interface ReactionDef {
  reaction: FeedReaction;
  label: string;
  emoji: string;
  /** Tailwind text colour when this is the viewer's own reaction. */
  color: string;
}

export const REACTIONS: ReactionDef[] = [
  { reaction: "like", label: "Like", emoji: "👍", color: "text-blue-600 dark:text-blue-400" },
  { reaction: "celebrate", label: "Celebrate", emoji: "🎉", color: "text-emerald-600 dark:text-emerald-400" },
  { reaction: "support", label: "Support", emoji: "🙌", color: "text-violet-600 dark:text-violet-400" },
  { reaction: "insightful", label: "Insightful", emoji: "💡", color: "text-amber-600 dark:text-amber-400" },
  { reaction: "funny", label: "Funny", emoji: "😄", color: "text-rose-600 dark:text-rose-400" },
];

export const REACTIONS_BY_KEY: Record<FeedReaction, ReactionDef> = Object.fromEntries(
  REACTIONS.map((r) => [r.reaction, r])
) as Record<FeedReaction, ReactionDef>;

export const MAX_POST_LENGTH = 3000;
export const MAX_COMMENT_LENGTH = 1000;
export const MAX_POST_MEDIA = 6;

/**
 * Extracts @mention handles from text. Matches `@` followed by word chars,
 * dots, or hyphens — the client resolves these against real users before
 * posting, and the resolved list is what gets stored.
 */
export function extractMentionHandles(text: string): string[] {
  const matches = text.match(/@([\w.-]{2,40})/g) || [];
  return Array.from(new Set(matches.map((m) => m.slice(1))));
}
