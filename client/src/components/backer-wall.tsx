import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Heart, Users } from "lucide-react";
import { BADGE_LEVELS, badgeLevel, formatBelieverNumber, type BadgeLevelKey } from "@shared/backing";
import { BadgeMedal } from "@/components/pinned-badges";

/**
 * Everybody who backed this project, as a page rather than a sidebar list.
 *
 * This was the Media tab. The wall already existed — the backing panel has shown
 * it since there were backers — but inside a card beside a pledge form, scrolling
 * inside a 16rem box, which is a credits list rather than somewhere to go and
 * look. The people who paid for a project are more interesting to a visitor than
 * its screenshots, and the names were the one thing on that panel nobody could
 * get to without opening the thing that asks for money.
 *
 * ## The badge
 *
 * Beside the name, and it is the point of the tab. It is the badge itself — the
 * same medal that hangs on the backer's profile — and not only a tinted ring
 * around their face, which was what the first version of this tab showed. A
 * coloured ring is information nobody decodes: a visitor seeing it has no way to
 * learn that a warmer ring means somebody went further, and the backer whose
 * reward it is cannot see what they earned. So the medal is shown, named, and in
 * its metal.
 *
 * The level comes from the server: the badge actually minted where one exists,
 * and otherwise the level the pledge clears, because a badge is drawn
 * asynchronously and somebody who paid a minute ago has earned gold with no row
 * to show for it yet. `badgeImage` is the struck artwork and is only sent once it
 * is really drawn; until then the medal wears the project's own logo inside that
 * level's rim, which is already recognisably this project's badge and is the same
 * stand-in the pledge panel has always used.
 *
 * ## Anonymous backers
 *
 * Still here, still counted, still wearing their badge — and named "Anonymous"
 * with no picture. Anonymity hides who they are rather than that somebody at that
 * level backed the project, which is the same line the tier name has always
 * drawn.
 */

interface WallEntry {
  believerNumber: number | null;
  name: string;
  image: string | null;
  message: string | null;
  tierName: string | null;
  createdAt: string;
  badgeLevel: BadgeLevelKey | string | null;
  badgeReady?: boolean;
  /** The struck artwork, once it exists. Null while it is still being drawn. */
  badgeImage?: string | null;
}

interface PublicBacking {
  wall: WallEntry[];
  backers: number;
  raisedCents: number;
  /** The project's logo as the badge wears it — the medal's stand-in until the art is made. */
  badgeLogoUrl?: string | null;
}

/** The ring, in the metal that level is made of. */
function BadgeRing({ level, ready, children }: { level: string | null; ready?: boolean; children: React.ReactNode }) {
  const def = BADGE_LEVELS.find((l) => l.key === level);
  if (!def) return <>{children}</>;
  return (
    <span
      className="relative inline-flex shrink-0 rounded-full p-[2px]"
      style={{ background: `linear-gradient(135deg, ${def.hex}, ${def.accentHex})` }}
      /*
       * Decoration now. It was the only thing carrying the level, so it was
       * named and labelled; the medal beside the name says it in words, and two
       * announcements of the same fact is one too many.
       */
      aria-hidden
    >
      {children}
    </span>
  );
}

/**
 * The badge, beside the name: the medal and what it is called.
 *
 * Named in words as well as struck in metal. The level is the whole point of
 * the thing — it is what the backer paid for and what they get to wear — and a
 * colour alone leaves it legible only to somebody who already knows the scale.
 */
function WallBadge({ entry, logoUrl, projectTitle }: {
  entry: WallEntry; logoUrl: string | null; projectTitle: string;
}) {
  const def = badgeLevel(String(entry.badgeLevel ?? ""));
  if (!def) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 align-middle"
      title={entry.badgeReady
        ? `${def.label} believer — their badge for ${projectTitle}`
        : `${def.label} believer — the artwork is still being drawn`}
      data-testid={`wall-badge-${def.key}`}
    >
      <BadgeMedal
        level={def.key}
        imageUrl={entry.badgeImage ?? logoUrl}
        projectTitle={projectTitle}
        className="h-[1.15rem] w-[1.15rem] text-[16px]"
      />
      <span className="text-[11px] font-semibold leading-none" style={{ color: def.hex }}>
        {def.label}
      </span>
    </span>
  );
}

export function BackerWall({ projectId, projectTitle }: { projectId: string; projectTitle: string }) {
  /*
   * The same endpoint the pledge panel reads, so the wall cannot disagree with
   * itself in two places on one page. It 404s when a project is not taking
   * backing, which is not an error here — it is the empty state.
   */
  const { data, isLoading, isError } = useQuery<PublicBacking>({
    queryKey: ["/api/projects", projectId, "backing/public"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/backing/public`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="backer-wall-loading">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  /*
   * A 404 and an empty wall are the same thing to a visitor — nobody has backed
   * this yet — and saying "not accepting backing" would be telling a stranger
   * about the campaign's settings rather than answering what they came for.
   */
  if (isError || !data?.wall?.length) {
    return (
      <Card data-testid="backer-wall-empty">
        <CardContent className="p-8 text-center space-y-2">
          <Users className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="font-medium">No backers yet</p>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            When people back this project, their names and badges appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="backer-wall">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Heart className="h-4 w-4 text-primary" />
          The backer wall
        </h3>
        <p className="text-xs text-muted-foreground" data-testid="backer-wall-count">
          {data.backers.toLocaleString()} {data.backers === 1 ? "believer" : "believers"}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border/60">
            {data.wall.map((w, i) => (
              <li key={i} className="flex items-start gap-3 p-3" data-testid={`wall-entry-${i}`}>
                <BadgeRing level={w.badgeLevel} ready={w.badgeReady}>
                  <Avatar className="h-9 w-9">
                    {w.image && <AvatarImage src={w.image} />}
                    <AvatarFallback className="text-[11px]">{w.name.slice(0, 2)}</AvatarFallback>
                  </Avatar>
                </BadgeRing>
                <div className="min-w-0 flex-1">
                  <p className="text-sm flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span className="font-medium">{w.name}</span>
                    <WallBadge entry={w} logoUrl={data.badgeLogoUrl ?? null} projectTitle={projectTitle} />
                    {w.believerNumber != null && (
                      <span className="text-muted-foreground font-mono text-xs">
                        {formatBelieverNumber(w.believerNumber)}
                      </span>
                    )}
                    {w.tierName && <span className="text-muted-foreground text-xs">· {w.tierName}</span>}
                  </p>
                  {w.message && (
                    <p className="text-sm text-muted-foreground leading-relaxed mt-0.5">{w.message}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* The wall is capped server-side; say so rather than implying this is everyone. */}
      {data.wall.length >= 200 && (
        <p className="text-xs text-muted-foreground text-center">
          Showing the first 200 believers, by backer number.
        </p>
      )}
    </div>
  );
}
