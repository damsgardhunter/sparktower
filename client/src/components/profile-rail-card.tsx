import { useRef } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { UserAvatar } from "@/components/user-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { RailCard, RailRow, RailDivider } from "@/components/rail-card";
import {
  Camera, Eye, Users, Bookmark, FolderKanban, Award, Loader2,
  MapPin, TrendingUp, Sparkles,
} from "lucide-react";
import type { UserProfile } from "@shared/schema";

interface ProfileSummary {
  profile: UserProfile | null;
  stats: {
    projects: number;
    projectViews: number;
    following: number;
    connections: number;
    tasksCompleted: number;
    reputationScore: number | null;
    badges: number;
  };
}

/**
 * A deterministic gradient for a profile with no cover photo.
 *
 * Seeded from the user's own id so it's stable across reloads and different
 * between people — a shared placeholder would make every rail look identical,
 * which is the opposite of what a cover photo is for.
 */
function coverGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${hash} 62% 42%), hsl(${(hash + 48) % 360} 68% 55%))`;
}

/**
 * The profile module at the top of the home rail.
 *
 * Modelled on LinkedIn's left-rail card: a cover band, the avatar overlapping
 * its lower edge, identity beneath, then the counts that tell you your work is
 * being seen, then the links into your own stuff. That last part is the point —
 * before this there was nowhere on the home page to get to your own profile,
 * projects or connections without going through the nav.
 */
export function ProfileRailCard() {
  const { toast } = useToast();
  const coverInput = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading } = useUpload();

  const { data, isLoading } = useQuery<ProfileSummary>({
    queryKey: ["/api/profile/summary"],
  });

  const coverMutation = useMutation({
    mutationFn: async (coverUrl: string) => {
      const res = await apiRequest("POST", "/api/profile", { coverUrl });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      toast({ title: "Cover photo updated" });
    },
    onError: () => toast({ title: "Couldn't save that cover photo", variant: "destructive" }),
  });

  const handleCover = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Images only", description: "Pick a JPG or PNG.", variant: "destructive" });
      return;
    }
    try {
      const result = await uploadFile(file);
      if (!result?.objectPath) throw new Error("no path");
      coverMutation.mutate(result.objectPath);
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <RailCard padded={false}>
        <Skeleton className="h-14 w-full rounded-none" />
        <div className="p-3 pt-0 -mt-6 space-y-2">
          <Skeleton className="h-14 w-14 rounded-full" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-40" />
        </div>
      </RailCard>
    );
  }

  const profile = data?.profile;
  const stats = data?.stats;
  const name = profile?.displayName || "Your profile";
  const seed = profile?.userId || name;

  return (
    <RailCard padded={false} className="group">
      {/* Cover band. Click to replace, the way LinkedIn does. */}
      <div className="relative">
        <div
          className="h-14 w-full bg-cover bg-center"
          style={
            profile?.coverUrl
              ? { backgroundImage: `url(${profile.coverUrl})` }
              : { background: coverGradient(seed) }
          }
          data-testid="profile-cover"
        />
        <button
          type="button"
          onClick={() => coverInput.current?.click()}
          className="absolute top-1.5 right-1.5 h-7 w-7 rounded-full bg-background/85 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          title="Change cover photo"
          data-testid="button-change-cover"
        >
          {isUploading || coverMutation.isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Camera className="h-3.5 w-3.5" />}
        </button>
        <input
          ref={coverInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCover(f); }}
        />
      </div>

      <div className="px-3 pb-3">
        {/* The avatar straddles the cover's lower edge. */}
        <Link href="/profile" className="block -mt-7 mb-2 w-fit" data-testid="link-rail-avatar">
          <UserAvatar
            src={profile?.avatarUrl}
            name={name}
            /* Ring matches the box surface, not `card` — the box opts out of
               the theme's card colour, so ring-card left a grey halo. */
            className="h-14 w-14 ring-4 ring-background dark:ring-card"
          />
        </Link>

        <Link href="/profile" className="block group/name" data-testid="link-rail-name">
          <p className="font-semibold text-sm leading-tight group-hover/name:underline">{name}</p>
        </Link>
        {profile?.headline && (
          <p className="text-xs text-muted-foreground leading-snug mt-0.5 line-clamp-2">{profile.headline}</p>
        )}
        {profile?.location && (
          <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
            <MapPin className="h-3 w-3 shrink-0" /> {profile.location}
          </p>
        )}

        {!profile && (
          <Link href="/onboarding" className="text-xs text-primary hover:underline mt-1 inline-block">
            Finish setting up your profile
          </Link>
        )}

        {stats && (
          <>
            <RailDivider />
            {/* The "is anyone seeing this" numbers, LinkedIn's stat rows. */}
            <RailRow
              href="/projects"
              label="Project views"
              value={stats.projectViews.toLocaleString()}
              icon={Eye}
              testId="rail-stat-views"
            />
            <RailRow
              href="/matches"
              label="Connections"
              value={stats.connections}
              icon={Users}
              testId="rail-stat-connections"
            />
            {stats.reputationScore !== null && (
              <RailRow
                href="/leaderboard"
                label="Builder index"
                value={stats.reputationScore}
                icon={TrendingUp}
                testId="rail-stat-reputation"
              />
            )}

            <RailDivider />
            <RailRow
              href="/profile"
              label="My projects"
              sublabel={`${stats.projects} owned · ${stats.tasksCompleted} tasks shipped`}
              icon={FolderKanban}
              testId="rail-link-projects"
            />
            <RailRow
              href="/discover"
              label="Following"
              sublabel={`${stats.following} project${stats.following === 1 ? "" : "s"}`}
              icon={Bookmark}
              testId="rail-link-following"
            />
            {stats.badges > 0 && (
              <RailRow
                href="/profile"
                label="Badges earned"
                value={stats.badges}
                icon={Award}
                testId="rail-link-badges"
              />
            )}
          </>
        )}

        <RailDivider />
        <RailRow href="/profile" label="View full profile" icon={Sparkles} testId="rail-link-profile" />
      </div>
    </RailCard>
  );
}
