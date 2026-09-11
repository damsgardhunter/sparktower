/**
 * The Discover feed, as data: what to show, in what order, and what's new.
 *
 * Kept free of React and React Native so it can be tested on its own — the
 * rules here are the part worth pinning down, and none of them need a screen.
 *
 * The rules:
 *  - Matched builders and projects, interleaved two to one. Builders lead
 *    because matches are ranked for this person; projects keep the feed from
 *    being only people.
 *  - Every card says why it's here. A match carries Nova's own reason; a
 *    project gets one from what it needs and what this person can do, so a
 *    card is never a bare name.
 *  - "New" means newer than when this person last said they'd seen the feed.
 *    A first visit has nothing new — everything is new, which is the same as
 *    nothing being. New items go first, so the banner points at the top.
 *  - Your own projects and private ones never appear.
 */

export interface MatchRow {
  id: string;
  matchedUserId: string;
  score: number;
  reasons?: string[] | null;
  createdAt: string;
  matchedUser?: { id: string; firstName?: string | null; email?: string | null } | null;
  matchedProfile?: { displayName?: string | null; headline?: string | null; skills?: string[] | null; avatarUrl?: string | null } | null;
}

export interface ProjectRow {
  id: string;
  title: string;
  description?: string | null;
  oneLiner?: string | null;
  ownerId: string;
  isPrivate?: boolean | null;
  rolesNeeded?: string[] | null;
  category?: string | null;
  createdAt: string;
  owner?: { firstName?: string | null; email?: string | null } | null;
  profile?: { displayName?: string | null } | null;
}

export type FeedItem =
  | {
      kind: "builder"; key: string; userId: string; name: string; headline?: string;
      avatarUrl?: string; score: number; reason?: string; skills: string[]; at: string; isNew: boolean;
    }
  | {
      kind: "project"; key: string; projectId: string; title: string; blurb?: string; owner: string;
      reason: string; roles: string[]; at: string; following: boolean; isNew: boolean;
    };

export interface FeedInput {
  matches: MatchRow[];
  projects: ProjectRow[];
  meId?: string | null;
  mySkills?: string[] | null;
  followed?: ReadonlySet<string>;
  /** When this person last marked the feed seen. Null on a first visit. */
  lastSeen?: string | null;
  now?: number;
}

/** How many projects the feed carries, newest first. A feed is not the whole catalogue. */
const MAX_PROJECTS = 30;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const time = (iso: string) => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** Why a project is in this person's feed, in words they can check. */
export function projectReason(project: ProjectRow, mySkills: string[] = [], now = Date.now()): string {
  const mine = new Set(mySkills.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const fit = (project.rolesNeeded ?? []).find((role) => mine.has(role.trim().toLowerCase()));
  if (fit) return `Needs ${fit} — one of your skills`;
  if (now - time(project.createdAt) < WEEK_MS) return "New this week";
  if (project.rolesNeeded?.length) return `Looking for ${project.rolesNeeded[0]}`;
  return "Building in public";
}

export function buildDiscoverFeed(input: FeedInput): { items: FeedItem[]; newCount: number } {
  const now = input.now ?? Date.now();
  const seen = input.lastSeen ? time(input.lastSeen) : null;
  const isNew = (at: string) => seen !== null && time(at) > seen;

  const builders: FeedItem[] = input.matches
    .filter((m) => m.matchedUser?.id)
    .sort((a, b) => b.score - a.score || time(b.createdAt) - time(a.createdAt))
    .map((m) => {
      const profile = m.matchedProfile ?? {};
      const user = m.matchedUser!;
      return {
        kind: "builder" as const,
        key: `builder:${user.id}`,
        userId: user.id,
        name: profile.displayName || user.firstName || user.email || "Builder",
        headline: profile.headline || undefined,
        avatarUrl: profile.avatarUrl || undefined,
        score: m.score,
        reason: m.reasons?.find((r) => r && r.trim()) || undefined,
        skills: (profile.skills ?? []).slice(0, 4),
        at: m.createdAt,
        isNew: isNew(m.createdAt),
      };
    });

  const projects: FeedItem[] = input.projects
    .filter((p) => !p.isPrivate && p.ownerId !== input.meId)
    .sort((a, b) => time(b.createdAt) - time(a.createdAt))
    .slice(0, MAX_PROJECTS)
    .map((p) => ({
      kind: "project" as const,
      key: `project:${p.id}`,
      projectId: p.id,
      title: p.title,
      blurb: p.oneLiner || p.description || undefined,
      owner: p.profile?.displayName || p.owner?.firstName || p.owner?.email || "A builder",
      reason: projectReason(p, input.mySkills ?? [], now),
      roles: (p.rolesNeeded ?? []).slice(0, 3),
      at: p.createdAt,
      following: input.followed?.has(p.id) ?? false,
      isNew: isNew(p.createdAt),
    }));

  // Two builders, then a project, until one side runs out; then the rest.
  const mixed: FeedItem[] = [];
  let b = 0, p = 0;
  while (b < builders.length || p < projects.length) {
    for (let i = 0; i < 2 && b < builders.length; i++) mixed.push(builders[b++]);
    if (p < projects.length) mixed.push(projects[p++]);
  }

  const fresh = mixed.filter((item) => item.isNew).sort((x, y) => time(y.at) - time(x.at));
  const rest = mixed.filter((item) => !item.isNew);
  return { items: [...fresh, ...rest], newCount: fresh.length };
}

/** "just now", "5m", "3h", "2d", "6w" — short enough for the corner of a card. */
export function timeAgo(iso: string | number, now = Date.now()): string {
  const t = typeof iso === "number" ? iso : time(iso);
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}
