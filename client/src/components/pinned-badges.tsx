import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { badgeLevel, badgeRingStyle, isCreatorBadge, NOVA_GRADIENT_CSS } from "@shared/backing";

export interface PinnedBadge {
  id: string;
  projectId: string;
  projectTitle: string;
  projectLogo?: string | null;
  level: string;
  imageUrl: string | null;
}

/**
 * The same list as the profile's showcase, read under the same key, so a
 * change in the picker shows up on every card at once.
 */
export function usePinnedBadges(userId: string | null | undefined) {
  return useQuery<PinnedBadge[]>({
    queryKey: ["/api/users", userId, "badges/backer"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/badges/backer`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!userId,
    staleTime: 60_000,
  });
}

/**
 * One badge as a round medal. A creator badge sits in Nova's gradient ring;
 * a backer badge in its metal. Until its artwork is made, a creator badge is a
 * gradient disc with the project's initials — never just the logo, which reads
 * as the project rather than the badge.
 */
export function BadgeMedal({ level, imageUrl, projectTitle, className }: {
  level: string; imageUrl: string | null; projectTitle: string; className: string;
}) {
  const creator = isCreatorBadge(level);
  const def = badgeLevel(level);
  const initials = projectTitle.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  if (creator) {
    return (
      <span className={`${className} rounded-full p-[2px] shrink-0 inline-flex`} style={{ background: NOVA_GRADIENT_CSS }}>
        <span className="h-full w-full rounded-full overflow-hidden bg-background flex items-center justify-center">
          {imageUrl
            ? <img src={imageUrl} alt="" className="w-full h-full object-contain" />
            : <span className="h-full w-full flex items-center justify-center text-white font-bold text-[0.55em] leading-none" style={{ background: NOVA_GRADIENT_CSS }}>{initials}</span>}
        </span>
      </span>
    );
  }
  return (
    <span className={`${className} rounded-full border-2 overflow-hidden bg-background flex items-center justify-center shrink-0`} style={badgeRingStyle(level)}>
      {imageUrl
        ? <img src={imageUrl} alt="" className="w-full h-full object-contain" />
        : <span className="font-semibold text-[0.5em]" style={{ color: def?.hex }}>{initials}</span>}
    </span>
  );
}

/**
 * Someone's chosen badges — projects they created and projects they back — as
 * a row of small medals, wherever they appear: the home rail, the sidebar, a
 * match or a person in Discover. Each opens its project. Renders nothing when
 * nothing is pinned.
 */
export function PinnedBadges({ userId, size = "sm", max = 5, className = "" }: {
  userId: string | null | undefined;
  size?: "xs" | "sm";
  max?: number;
  className?: string;
}) {
  const { data } = usePinnedBadges(userId);
  const badges = (data ?? []).slice(0, max);
  if (!badges.length) return null;
  const px = size === "xs" ? "h-5 w-5 text-[18px]" : "h-7 w-7 text-[24px]";

  return (
    <div className={`flex items-center gap-1 ${className}`} data-testid={`pinned-badges-${userId}`}>
      {badges.map((b) => {
        const def = badgeLevel(b.level);
        return (
          <Link
            key={b.id}
            href={`/projects/${b.projectId}`}
            onClick={(e) => e.stopPropagation()}
            title={`${def?.label ?? b.level} · ${b.projectTitle}`}
            aria-label={`${def?.label ?? ""} badge for ${b.projectTitle}`}
            data-testid={`pinned-badge-link-${b.id}`}
          >
            <BadgeMedal level={b.level} imageUrl={b.imageUrl} projectTitle={b.projectTitle} className={px} />
          </Link>
        );
      })}
    </div>
  );
}
