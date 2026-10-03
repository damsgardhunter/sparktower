import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Heart, Crown, Eye, EyeOff, Award, Download } from "lucide-react";
import { formatBelieverNumber } from "@shared/backing";

interface PublicBacking {
  projectId: string;
  projectTitle: string;
  believerNumber: number | null;
  tierName: string | null;
  foundingBeliever: boolean;
  createdAt: string;
}

interface MyBacking {
  id: string;
  projectId: string;
  projectTitle: string;
  believerNumber: number | null;
  tierNameAtBacking: string | null;
  isAnonymous: boolean;
  status: string;
  createdAt: string;
}

/**
 * "I believe'd in them", as a permanent mark on a profile.
 *
 * The whole reason believer numbers and founding credit work is that they're
 * visible to other people — a reward nobody can see is just a database row.
 * Renders nothing when the person hasn't backed anything, so the profile can
 * include it unconditionally.
 */
/** One reward a creator has actually delivered, from `GET /api/me/rewards`. */
interface MyReward {
  projectId: string;
  projectTitle: string;
  rewardKey: string;
  label: string;
  note: string | null;
  deliveredAt: string;
  /** Null when there is nothing to watch — early access has no file. */
  videoUrl: string | null;
}

export function BackerCredits({ userId, isOwnProfile = false }: { userId: string; isOwnProfile?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data } = useQuery<PublicBacking[]>({
    queryKey: ["/api/users", userId, "backings"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/backings`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: !!userId,
    retry: false,
  });

  /*
   * The owner's own list includes anonymous pledges, which the public one
   * deliberately excludes — otherwise you couldn't find the pledge you wanted
   * to un-hide.
   */
  const { data: mine } = useQuery<MyBacking[]>({
    queryKey: ["/api/me/backings"],
    enabled: isOwnProfile,
  });

  const setPrivacy = useMutation({
    mutationFn: async ({ id, isAnonymous }: { id: string; isAnonymous: boolean }) => {
      const res = await apiRequest("PATCH", `/api/backings/${id}/privacy`, { isAnonymous });
      return res.json();
    },
    onSuccess: (_r, vars) => {
      toast({
        title: vars.isAnonymous ? "Hidden from the backer wall" : "Now shown on the backer wall",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/me/backings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "backings"] });
    },
    onError: () => toast({ title: "Couldn't change that", variant: "destructive" }),
  });

  const visible = mine?.filter((b) => b.status === "held" || b.status === "released") ?? [];
  /*
   * What came of it. Separate from the pledges above because the two answer
   * different questions — that is what I paid, this is what I was given — and
   * because until now a creator could record somebody a personal video and the
   * backer had nowhere at all to watch it.
   */
  const { data: rewards } = useQuery<MyReward[]>({
    queryKey: ["/api/me/rewards"],
    enabled: isOwnProfile,
  });

  /*
   * A delivered reward is reason enough on its own. `visible` deliberately
   * leaves out a pledge that has converted to equity, and the video somebody
   * recorded for that pledge is still theirs to watch.
   */
  const delivered = isOwnProfile ? rewards ?? [] : [];
  if (!data?.length && !visible.length && !delivered.length) return null;

  return (
    <Card className="border-border/50" data-testid="backer-credits">
      <CardHeader>
        <CardTitle className="text-sm font-semibold uppercase text-muted-foreground flex items-center gap-2">
          <Heart className="h-3.5 w-3.5 fill-current text-primary" /> Believed in
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/*
          * Delivered rewards first, and only on your own profile: a video somebody
          * recorded for you is the most interesting thing on this card, and it is
          * nobody else's business.
          */}
        {delivered.length > 0 && (
          <div className="space-y-1.5 pb-1" data-testid="my-rewards">
            {delivered.map((r) => (
              <div
                key={`${r.projectId}-${r.rewardKey}`}
                className="rounded-md border border-primary/30 bg-primary/5 p-2.5 space-y-1"
                data-testid={`my-reward-${r.rewardKey}`}
              >
                <p className="text-sm">
                  <span className="font-medium">{r.label}</span>
                  {" from "}
                  <Link href={`/projects/${r.projectId}`} className="hover:underline">{r.projectTitle}</Link>
                </p>
                {r.note && <p className="text-xs text-muted-foreground italic">“{r.note}”</p>}
                {r.videoUrl && (
                  <div className="space-y-1">
                    {/*
                      * Played here rather than linked away. It was made for this
                      * person; opening a bare file in a new tab is a worse way to
                      * receive it than a player in place.
                      */}
                    <video
                      src={r.videoUrl}
                      controls
                      preload="metadata"
                      className="w-full rounded border bg-black"
                      data-testid={`reward-video-${r.rewardKey}`}
                    />
                    <a
                      href={`${r.videoUrl}?download=1`}
                      download
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                      data-testid={`reward-video-download-${r.rewardKey}`}
                    >
                      <Download className="h-3 w-3" /> Keep a copy
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {/*
          * The owner's view lists every live pledge with a visibility toggle,
          * because deciding to be anonymous a week later is a normal thing to
          * want and the only alternative is emailing support.
          */}
        {isOwnProfile ? visible.map((b) => (
          <div
            key={b.id}
            className="rounded-md border border-border/60 p-2.5 space-y-1.5"
            data-testid={`my-backing-${b.id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <Link href={`/projects/${b.projectId}`} className="text-sm font-medium hover:underline min-w-0 break-words">
                {b.projectTitle}
              </Link>
              {b.believerNumber != null && (
                <span className="text-xs font-mono text-muted-foreground shrink-0">
                  {formatBelieverNumber(b.believerNumber)}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex flex-wrap items-center gap-1">
                {b.tierNameAtBacking && (
                  <Badge variant="secondary" className="text-[10px]">{b.tierNameAtBacking}</Badge>
                )}
                <Badge variant="outline" className="text-[10px] gap-1">
                  {b.isAnonymous
                    ? <><EyeOff className="h-2.5 w-2.5" /> Hidden</>
                    : <><Eye className="h-2.5 w-2.5" /> On the wall</>}
                </Badge>
              </div>
              <div className="flex items-center gap-1">
                {/*
                  * A plain link, not a fetch: the route answers with a PNG and a
                  * Content-Disposition, so the browser's own download is both
                  * simpler and better behaved than pulling the bytes into memory
                  * to make a blob URL out of them.
                  *
                  * Shown on every settled backing rather than only where the tier
                  * promised one. The certificate costs nothing to draw and says
                  * something true about any pledge; gating it on a reward the
                  * creator happened to tick would be withholding a fact.
                  */}
                <Button asChild variant="ghost" size="sm" className="h-6 text-[11px] px-2 gap-1">
                  <a
                    href={`/api/projects/${b.projectId}/backing/certificate`}
                    download
                    data-testid={`download-certificate-${b.id}`}
                  >
                    <Award className="h-3 w-3" /> Certificate
                  </a>
                </Button>
                <Button
                  variant="ghost" size="sm" className="h-6 text-[11px] px-2"
                  disabled={setPrivacy.isPending}
                  onClick={() => setPrivacy.mutate({ id: b.id, isAnonymous: !b.isAnonymous })}
                  data-testid={`toggle-privacy-${b.id}`}
                >
                  {b.isAnonymous ? "Show my name" : "Hide my name"}
                </Button>
              </div>
            </div>
          </div>
        )) : data!.map((b) => (
          <Link
            key={`${b.projectId}-${b.createdAt}`}
            href={`/projects/${b.projectId}`}
            className="block rounded-md border border-border/60 p-2.5 hover:border-primary/50 transition-colors"
            data-testid={`backed-${b.projectId}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium min-w-0 break-words">{b.projectTitle}</span>
              {b.believerNumber != null && (
                <span className="text-xs font-mono text-muted-foreground shrink-0">
                  {formatBelieverNumber(b.believerNumber)}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1 mt-1">
              {b.foundingBeliever && (
                <Badge className="text-[10px] gap-1">
                  <Crown className="h-2.5 w-2.5" /> Founding believer
                </Badge>
              )}
              {b.tierName && (
                <Badge variant="secondary" className="text-[10px]">{b.tierName}</Badge>
              )}
              <span className="text-[10px] text-muted-foreground">
                since {new Date(b.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
              </span>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
