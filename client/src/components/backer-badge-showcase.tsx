import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, Crown, Settings2, ImageIcon, Search } from "lucide-react";
import {
  badgeLevel, formatBelieverNumber, MAX_SHOWCASE_BADGES, BADGE_LEVELS,
} from "@shared/backing";

interface BackerBadgeRow {
  id: string;
  projectId: string;
  projectTitle: string;
  level: string;
  totalCents: number;
  believerNumber: number | null;
  foundingBeliever: boolean;
  imageUrl: string | null;
  status: "pending" | "ready" | "failed";
  showcaseOrder: number | null;
}

/** The metal ring around each badge, so the level reads without the artwork. */
function levelStyle(level: string) {
  const def = badgeLevel(level);
  return {
    borderColor: def?.hex ?? "#a8672a",
    boxShadow: `0 0 0 1px ${def?.accentHex ?? "#e0a15e"}33 inset`,
  };
}

function BadgeTile({ badge, size = "md" }: { badge: BackerBadgeRow; size?: "sm" | "md" }) {
  const def = badgeLevel(badge.level);
  const px = size === "sm" ? "h-14 w-14" : "h-20 w-20";

  return (
    <div className="flex flex-col items-center gap-1 min-w-0">
      <div
        className={`${px} rounded-full border-2 overflow-hidden bg-muted/40 flex items-center justify-center shrink-0`}
        style={levelStyle(badge.level)}
        title={`${def?.label ?? badge.level} · ${badge.projectTitle}`}
      >
        {badge.imageUrl
          ? <img src={badge.imageUrl} alt="" className="w-full h-full object-contain" />
          : <ImageIcon className="h-5 w-5 text-muted-foreground/50" />}
      </div>
      <span className="text-[10px] text-center leading-tight max-w-[5.5rem] truncate">
        {badge.projectTitle}
      </span>
      {badge.believerNumber != null && (
        <span className="text-[9px] font-mono text-muted-foreground">
          {formatBelieverNumber(badge.believerNumber)}
        </span>
      )}
    </div>
  );
}

/**
 * The badges someone has pinned to their profile.
 *
 * Visitors see the pinned set; the owner also gets the picker. Renders nothing
 * for a visitor when nothing is pinned, so an empty showcase isn't a hole in
 * someone else's profile.
 */
export function BackerBadgeShowcase({ userId, isOwnProfile }: { userId: string; isOwnProfile: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [, setLocation] = useLocation();

  const { data: pinned } = useQuery<BackerBadgeRow[]>({
    queryKey: ["/api/users", userId, "badges/backer"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/badges/backer`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: !!userId,
    retry: false,
  });

  const { data: mine } = useQuery<BackerBadgeRow[]>({
    queryKey: ["/api/me/badges"],
    enabled: isOwnProfile,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "badges/backer"] });
    queryClient.invalidateQueries({ queryKey: ["/api/me/badges"] });
  };

  const generate = useMutation({
    mutationFn: async (badgeId: string) => {
      const res = await apiRequest("POST", `/api/backer-badges/${badgeId}/generate`);
      return res.json();
    },
    onSuccess: () => { toast({ title: "Badge made" }); refresh(); },
    onError: (err: any) => {
      const raw = err?.message || "";
      const start = raw.indexOf("{");
      let description = "Try again in a moment.";
      if (start >= 0) {
        try { description = JSON.parse(raw.slice(start)).message || description; } catch { /* keep */ }
      }
      toast({ title: "Couldn't make that badge", description, variant: "destructive" });
    },
  });

  const saveShowcase = useMutation({
    mutationFn: async (badgeIds: string[]) => {
      const res = await apiRequest("PUT", "/api/me/badges/showcase", { badgeIds });
      return res.json();
    },
    onSuccess: () => { toast({ title: "Profile updated" }); setPicking(false); refresh(); },
    onError: () => toast({ title: "Couldn't save that", variant: "destructive" }),
  });

  const hasAny = (pinned?.length ?? 0) > 0;
  const earned = mine?.length ?? 0;

  /*
   * A visitor sees nothing when nothing is pinned — an empty showcase isn't
   * news on someone else's profile. The owner always sees the card, including
   * when they have no badges: the first version returned null in that case,
   * which made the entire feature undiscoverable rather than merely empty.
   */
  if (!hasAny && !isOwnProfile) return null;

  return (
    <>
      <Card className="border-border/50" data-testid="badge-showcase">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-2">
          <CardTitle className="text-sm font-semibold uppercase text-muted-foreground flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Believer badges
          </CardTitle>
          {isOwnProfile && earned > 0 && (
            <Button
              variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
              onClick={() => setPicking(true)}
              data-testid="button-pick-badges"
            >
              <Settings2 className="h-3.5 w-3.5" /> Choose
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {hasAny ? (
            <div className="flex flex-wrap gap-3">
              {pinned!.map((b) => (
                <Link key={b.id} href={`/projects/${b.projectId}`} data-testid={`pinned-badge-${b.id}`}>
                  <BadgeTile badge={b} />
                </Link>
              ))}
            </div>
          ) : earned > 0 ? (
            <p className="text-xs text-muted-foreground">
              You've earned {earned} badge{earned === 1 ? "" : "s"} — pick which to show.
            </p>
          ) : (
            /* Says where badges come from instead of leaving a blank card.
               Badges are proof you backed someone, so there is nothing to
               "create" here — they're earned, and this explains how. */
            <div className="space-y-2" data-testid="badge-empty-state">
              <div className="flex gap-2">
                {BADGE_LEVELS.map((l) => (
                  <div key={l.key} className="flex flex-col items-center gap-1">
                    <div
                      className="h-10 w-10 rounded-full border-2 opacity-40"
                      style={{ borderColor: l.hex, background: `${l.accentHex}22` }}
                    />
                    <span className="text-[9px] text-muted-foreground">{l.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Back a project and you earn a badge for it — bronze at ${BADGE_LEVELS[0].minCents / 100},
                up to platinum at ${BADGE_LEVELS[3].minCents / 100}. Nova builds the artwork from that
                project's logo. Pin up to {MAX_SHOWCASE_BADGES} here.
              </p>
              <Button
                variant="outline" size="sm" className="gap-1.5"
                onClick={() => setLocation("/discover")}
                data-testid="button-find-projects-to-back"
              >
                <Search className="h-3.5 w-3.5" /> Find a project to back
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {isOwnProfile && (
        <BadgePicker
          open={picking}
          onClose={() => setPicking(false)}
          badges={mine || []}
          onGenerate={(id) => generate.mutate(id)}
          generatingId={generate.isPending ? (generate.variables as string) : null}
          onSave={(ids) => saveShowcase.mutate(ids)}
          saving={saveShowcase.isPending}
        />
      )}
    </>
  );
}

function BadgePicker({
  open, onClose, badges, onGenerate, generatingId, onSave, saving,
}: {
  open: boolean;
  onClose: () => void;
  badges: BackerBadgeRow[];
  onGenerate: (badgeId: string) => void;
  generatingId: string | null;
  onSave: (badgeIds: string[]) => void;
  saving: boolean;
}) {
  // Seeded from what's already pinned, in its existing order.
  const [selected, setSelected] = useState<string[]>(() =>
    badges.filter((b) => b.showcaseOrder != null)
      .sort((a, b) => (a.showcaseOrder ?? 0) - (b.showcaseOrder ?? 0))
      .map((b) => b.id),
  );

  const toggle = (id: string) => {
    setSelected((cur) =>
      cur.includes(id)
        ? cur.filter((x) => x !== id)
        : cur.length >= MAX_SHOWCASE_BADGES ? cur : [...cur, id],
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Badges on your profile</DialogTitle>
          <DialogDescription>
            Pick up to {MAX_SHOWCASE_BADGES}. They show in the order you tap them.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 -mx-1 px-1">
          {badges.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Back a project and its badge appears here.
            </p>
          ) : (
            badges.map((b) => {
              const def = badgeLevel(b.level);
              const rank = selected.indexOf(b.id);
              return (
                <div
                  key={b.id}
                  className={`flex items-center gap-3 rounded-lg border p-2.5 transition-colors ${
                    rank >= 0 ? "border-primary" : "border-border/60"
                  }`}
                  data-testid={`badge-option-${b.id}`}
                >
                  <button
                    type="button"
                    className="shrink-0"
                    onClick={() => toggle(b.id)}
                  >
                    <BadgeTile badge={b} size="sm" />
                  </button>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium truncate">{b.projectTitle}</p>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="outline" className="text-[10px]" style={{ borderColor: def?.hex }}>
                        {def?.label ?? b.level}
                      </Badge>
                      {b.foundingBeliever && (
                        <Badge className="text-[10px] gap-1"><Crown className="h-2.5 w-2.5" /> Founding</Badge>
                      )}
                      {rank >= 0 && (
                        <Badge variant="secondary" className="text-[10px]">#{rank + 1} on profile</Badge>
                      )}
                    </div>
                    {b.status !== "ready" && (
                      <Button
                        variant="outline" size="sm" className="h-7 gap-1.5 text-xs"
                        disabled={generatingId === b.id}
                        onClick={() => onGenerate(b.id)}
                        data-testid={`button-generate-badge-${b.id}`}
                      >
                        {generatingId === b.id
                          ? <><Loader2 className="h-3 w-3 animate-spin" /> Making it…</>
                          : <><Sparkles className="h-3 w-3" /> {b.status === "failed" ? "Try again" : "Make the artwork"}</>}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={() => onSave(selected)} data-testid="button-save-showcase">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : `Show ${selected.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
