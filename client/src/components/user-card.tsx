import { isSeen } from "@/lib/seen";
import { updateLabel, type ExploreUpdate } from "@/hooks/use-explore-updates";
import { useAuth } from "@/hooks/use-auth";
import { BuilderActions, type ConnectionState } from "@/components/discover-actions";
import { useExploreImpression } from "@/hooks/use-explore-impression";
import { trackExplore } from "@/lib/explore";
import { EXPLORE_EVENTS, type ExploreSource } from "@shared/explore-events";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { UserAvatar } from "@/components/user-avatar";
import { SkillBadge } from "@/components/skill-badge";
import { useLocation } from "wouter";
import type { UserProfile } from "@shared/schema";
import { Badge } from "@/components/ui/badge";

interface UserCardProps {
  profile: UserProfile;
  userName?: string;
  matchScore?: number;
  matchReasons?: string[];
  /** Set on Explore surfaces — Discover, Matches — so seeing and opening the card are counted. */
  explore?: { source: ExploreSource; rankPosition?: number };
  /** Where you stand with this person, from the page's one batched lookup. Shows Connect / Message on Explore surfaces. */
  connection?: ConnectionState;
  /** New posts from them since you last looked, when there are any. */
  update?: ExploreUpdate;
}

export function UserCard({ profile, userName, matchScore, matchReasons, explore, connection, update }: UserCardProps) {
  const { user: me } = useAuth();
  const [, setLocation] = useLocation();
  const target = explore && profile
    ? { matchType: "builder" as const, targetId: profile.userId, source: explore.source, rankPosition: explore.rankPosition }
    : null;
  const impressionRef = useExploreImpression(target);

  if (!profile) return null;

  const displayLabel = profile.displayName || userName || profile.headline || "Unknown User";

  return (
    <Card
      ref={impressionRef}
      className="hover-elevate cursor-pointer overflow-visible"
      onClick={() => {
        if (target) trackExplore(EXPLORE_EVENTS.openProfile, target);
        setLocation(`/profile/${profile.userId}`);
      }}
      data-testid={`card-user-${profile.userId}`}
      // "Continue exploring" looks for the first of these you haven't looked at.
      data-explore-card={explore ? "" : undefined}
      data-seen={explore && isSeen("builder", profile.userId) ? "" : undefined}
      tabIndex={explore ? -1 : undefined}
    >
      <CardHeader className="flex flex-row items-center gap-4 pb-2">
        <UserAvatar src={profile.avatarUrl} name={displayLabel} className="h-12 w-12" />
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg">{displayLabel}</h3>
            {update && (
              <Badge variant="secondary" className="bg-primary/15 text-primary border-transparent" data-testid={`badge-update-${profile.userId}`}>
                {updateLabel(update)}
              </Badge>
            )}
            {matchScore !== undefined && (
              <Badge variant="default" className="bg-primary/20 text-primary border-transparent">
                {matchScore}% Match
              </Badge>
            )}
          </div>
          {profile.username && (
            <p className="text-xs text-muted-foreground">@{profile.username}</p>
          )}
          {profile.headline && (
            <p className="text-sm text-secondary line-clamp-1">{profile.headline}</p>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {profile.bio && (
          <p className="text-sm text-secondary line-clamp-2 mb-4">
            {profile.bio}
          </p>
        )}
        <div className="flex flex-wrap gap-1 mb-4">
          {profile.skills?.slice(0, 5).map((skill) => (
            <SkillBadge key={skill} skill={skill} />
          ))}
        </div>
        {matchReasons && matchReasons.length > 0 && (
          <div className="mt-2 space-y-1">
            <p className="text-xs font-semibold text-tertiary">Why matched:</p>
            <ul className="text-xs text-tertiary list-disc pl-4">
              {matchReasons.slice(0, 2).map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
        {explore && me?.id !== profile.userId && (
          <BuilderActions
            userId={profile.userId}
            name={displayLabel}
            reason={matchReasons?.[0]}
            headline={profile.headline}
            connection={connection}
            explore={explore}
            moreLikeThis={profile.skills?.[0] ? `/discover?q=${encodeURIComponent(profile.skills[0])}` : undefined}
          />
        )}
      </CardContent>
    </Card>
  );
}
