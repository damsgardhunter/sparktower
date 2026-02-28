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
}

export function UserCard({ profile, userName, matchScore, matchReasons }: UserCardProps) {
  const [, setLocation] = useLocation();

  return (
    <Card
      className="hover-elevate cursor-pointer overflow-visible"
      onClick={() => setLocation(`/profile/${profile.userId}`)}
      data-testid={`card-user-${profile.userId}`}
    >
      <CardHeader className="flex flex-row items-center gap-4 pb-2">
        <UserAvatar src={profile.avatarUrl} name={userName} className="h-12 w-12" />
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg">{userName}</h3>
            {matchScore !== undefined && (
              <Badge variant="default" className="bg-primary/20 text-primary border-transparent">
                {matchScore}% Match
              </Badge>
            )}
          </div>
          <p className="text-sm text-secondary line-clamp-1">{profile.headline}</p>
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
      </CardContent>
    </Card>
  );
}
