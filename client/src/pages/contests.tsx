import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Gamepad2, HandCoins, Layers, Loader2, Rocket, Sparkles, Store, Trophy, Upload, User, Users, type LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { money } from "@shared/sprints/budget";
import { CONTEST_SCORERS } from "@shared/contests";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

interface Community {
  id: string; slug: string; name: string; tagline: string; description: string;
  icon: string; color: string; members: number; joined: boolean;
}

interface Contest {
  id: string; title: string; description: string; category: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  status: "upcoming" | "active" | "judging" | "completed";
  prize: string | null;
  startDate: string; endDate: string;
  maxParticipants: number | null;
  promoted: boolean;
  participantCount: number;
  isParticipant: boolean;
  /**
   * The viewer's own entry, once they have filed one; null while they have only
   * joined. Added when filing was built: `isParticipant` alone is why entering
   * dead-ended on both clients — nothing could tell a joiner from an entrant, so
   * nothing offered to file.
   */
  submission: { url: string | null; note: string | null } | null;
  /** Set when the product scores this contest itself; see CONTEST_SCORERS. */
  scoredBy: string | null;
}

/** One row of a scored contest's table, as `GET /api/contests/:id/standings` returns it. */
interface Standing {
  userId: string;
  name: string;
  avatarUrl: string | null;
  best: number | null;
  gameId: string | null;
  company: string | null;
  played: number;
  rank: number | null;
}

interface Standings {
  from: string;
  to: string;
  open: boolean;
  standings: Standing[];
  played: number;
  entrants: number;
}

/** Open to entries, which is what belongs on a page people come to to enter something. */
const OPEN: Contest["status"][] = ["active", "upcoming"];

const ICONS: Record<string, LucideIcon> = { user: User, sparkles: Sparkles, layers: Layers, rocket: Rocket, "hand-coins": HandCoins, store: Store };

/**
 * Contests and Communities: the contests that are open to entries, and below
 * them, communities people can join around what they're building.
 *
 * The contests here are rows in `contests`, created from `/admin/contests`.
 * Until now this page rendered only the hardcoded $50 Billion Challenge
 * announcement and never called `/api/contests` at all — so a contest created
 * in the admin tool existed, was served by the API, and appeared nowhere. That
 * is what was reported, and it was the page rather than the contest.
 *
 * The $50B announcement is on hold: `FeaturedContestCard` and
 * `lib/featured-contest.ts` are untouched and its page still answers on its own
 * slug, so bringing it back is one line here. It is not in the list because it
 * is not a row — it is announcement copy, by its own comment.
 *
 * Only `active` and `upcoming` are listed. `judging` and `completed` are
 * history, and the join route refuses them anyway, so showing them here would
 * be offering a door that answers 400.
 *
 * ## Filing the work
 *
 * Entering used to be the end of the road here: the button turned into a
 * disabled "Entered" and there was nowhere to put what you built.
 * `POST /api/contests/:id/submit` had existed the whole time with no caller on
 * any client. The dialog below is that caller.
 *
 * Joining takes an `upcoming` contest and submitting does not, so an entrant in
 * one that has not opened is told they are in and can file later, rather than
 * being given a button the server would refuse.
 */
/**
 * The server's own sentence out of a thrown `apiRequest` error.
 *
 * `apiRequest` throws with the status and the raw body in the message, so the
 * useful part is JSON somewhere inside a string. Both contest mutations want it:
 * every refusal they can get is specific enough to act on, and "try again" would
 * throw that away.
 */
function serverMessage(err: unknown, fallback = "Try again in a moment."): string {
  const raw = String((err as any)?.message ?? "");
  const start = raw.indexOf("{");
  if (start < 0) return fallback;
  try { return JSON.parse(raw.slice(start)).message || fallback; } catch { return fallback; }
}

export default function Contests() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: communities, isLoading } = useQuery<Community[]>({ queryKey: ["/api/communities"] });
  const { data: contests, isLoading: contestsLoading } = useQuery<Contest[]>({ queryKey: ["/api/contests"] });
  const open = (contests ?? []).filter((c) => OPEN.includes(c.status));

  const enter = useMutation({
    mutationFn: async (c: Contest) => (await apiRequest("POST", `/api/contests/${c.id}/join`)).json(),
    onSuccess: (_r, c) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/contests"] });
      toast({ title: `Entered ${c.title}` });
    },
    /* The route refuses a full contest and a closed one; say which. */
    onError: (err: any) => toast({ title: "Couldn't enter that contest", description: serverMessage(err), variant: "destructive" }),
  });

  /*
   * Filing, and changing what was filed. The link is the entry; the note is for
   * what a judge would otherwise have to guess.
   */
  const [filing, setFiling] = useState<Contest | null>(null);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");

  const openFiling = (c: Contest) => {
    /* Seeded from what is filed, so changing a link is an edit and not a retype. */
    setUrl(c.submission?.url ?? "");
    setNote(c.submission?.note ?? "");
    setFiling(c);
  };

  /*
   * The table for a scored contest, fetched when opened rather than per card: a
   * standings query is a join across every entrant's games and there is no
   * reason to run one for a contest nobody clicked.
   */
  const [viewing, setViewing] = useState<Contest | null>(null);
  const standings = useQuery<Standings>({
    queryKey: [`/api/contests/${viewing?.id}/standings`],
    enabled: !!viewing,
  });

  const submit = useMutation({
    mutationFn: async (c: Contest) => (await apiRequest("POST", `/api/contests/${c.id}/submit`, {
      submissionUrl: url.trim(),
      submissionNote: note.trim() || undefined,
    })).json(),
    onSuccess: (_r, c) => {
      setFiling(null);
      void queryClient.invalidateQueries({ queryKey: ["/api/contests"] });
      toast({ title: c.submission ? "Entry updated" : `Entry filed for ${c.title}` });
    },
    onError: (err: any) => {
      /*
       * The server's own sentence. Every refusal here is specific and actionable
       * — the link is not a link, the contest has not opened, it has closed — and
       * a generic message would leave somebody retyping a good URL.
       */
      toast({ title: "Couldn't file that entry", description: serverMessage(err), variant: "destructive" });
    },
  });

  const toggle = useMutation({
    mutationFn: async (c: Community) => (await apiRequest(c.joined ? "DELETE" : "POST", `/api/communities/${c.slug}/join`)).json() as Promise<Community>,
    onSuccess: (updated) => {
      queryClient.setQueryData<Community[]>(["/api/communities"], (list) => list?.map((c) => (c.id === updated.id ? updated : c)));
      toast({ title: updated.joined ? `Joined ${updated.name}` : `Left ${updated.name}` });
    },
    onError: () => toast({ title: "Couldn't update that community", variant: "destructive" }),
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <header className="pb-4 border-b border-border">
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-contests-title">Contests and Communities</h1>
          <p className="text-sm text-muted-foreground mt-1">Build challenges with prizes and badges, and find people building what you're building.</p>
        </header>

        <section className="pt-6" aria-labelledby="contests-heading">
          <h2 id="contests-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contests</h2>
          {contestsLoading ? (
            <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !open.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground" data-testid="text-no-contests">
              No contests are open right now.
            </p>
          ) : (
            <ul className="mt-4 grid gap-3" data-testid="list-contests">
              {open.map((c) => {
                const full = c.maxParticipants != null && c.participantCount >= c.maxParticipants;
                const busy = enter.isPending && enter.variables?.id === c.id;
                return (
                  <li key={c.id} className="rounded-xl nova-ring-soft p-4 flex flex-col gap-3" data-testid={`contest-${c.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold leading-tight">{c.title}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {c.status === "active" ? "Open now" : "Opening soon"} · {c.category} · {c.difficulty}
                        </p>
                      </div>
                      {c.prize && (
                        <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-amber-300/40 bg-amber-300/10 px-2.5 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-300">
                          <Trophy className="h-3.5 w-3.5" />{c.prize}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{c.description}</p>
                    {/* How it is decided, when it isn't a person reading entries. */}
                    {c.scoredBy && (
                      <p className="text-xs text-muted-foreground inline-flex items-start gap-1.5" data-testid={`text-scored-${c.id}`}>
                        <Gamepad2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        {CONTEST_SCORERS.find((sc) => sc.id === c.scoredBy)?.blurb ?? "Scored from your games."}
                      </p>
                    )}
                    <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        {c.participantCount.toLocaleString()}{c.maxParticipants != null ? ` of ${c.maxParticipants.toLocaleString()}` : ""} entered
                      </span>
                      {user && (
                        /*
                         * A scored contest has nothing to file. The next thing is
                         * to play, and the thing worth seeing is where everybody
                         * stands — so the buttons are those, for entrants and
                         * onlookers alike.
                         */
                        c.scoredBy ? (
                          <span className="flex items-center gap-2">
                            <Button size="sm" variant="outline" onClick={() => setViewing(c)} data-testid={`button-standings-${c.id}`}>
                              <Trophy className="h-4 w-4 mr-1" />Standings
                            </Button>
                            {c.isParticipant ? (
                              <Button size="sm" asChild data-testid={`button-play-${c.id}`}>
                                <Link href="/sprints">Play</Link>
                              </Button>
                            ) : (
                              <Button size="sm" disabled={busy || full} onClick={() => enter.mutate(c)} data-testid={`button-enter-${c.id}`}>
                                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : full ? "Full" : "Enter"}
                              </Button>
                            )}
                          </span>
                        ) : c.isParticipant ? (
                          /*
                           * In, so the next thing is the work. An upcoming contest
                           * takes entrants and not submissions, so it says it is
                           * waiting rather than offering a refused button.
                           */
                          c.status === "active" ? (
                            <Button
                              size="sm"
                              variant={c.submission ? "outline" : "default"}
                              onClick={() => openFiling(c)}
                              data-testid={`button-file-${c.id}`}
                            >
                              {c.submission ? <><Check className="h-4 w-4 mr-1" />Change entry</> : <><Upload className="h-4 w-4 mr-1" />File your entry</>}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground" data-testid={`text-entered-${c.id}`}>
                              Entered — file your work when it opens
                            </span>
                          )
                        ) : (
                          <Button size="sm" disabled={busy || full} onClick={() => enter.mutate(c)} data-testid={`button-enter-${c.id}`}>
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : full ? "Full" : "Enter"}
                          </Button>
                        )
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="pt-6 border-t border-border" aria-labelledby="communities-heading" data-testid="section-communities">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="communities-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Communities</h2>
            {communities && <span className="text-xs text-muted-foreground">{communities.filter((c) => c.joined).length} joined</span>}
          </div>

          {isLoading ? (
            <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !communities?.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No communities yet.</p>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {communities.map((c) => {
                const Icon = ICONS[c.icon] ?? Users;
                const busy = toggle.isPending && toggle.variables?.id === c.id;
                return (
                  <li key={c.id} className="rounded-xl nova-ring-soft p-4 flex flex-col gap-3" data-testid={`community-${c.slug}`}>
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 shrink-0 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${c.color}1A`, color: c.color }}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold leading-tight">{c.name}</h3>
                        <p className="text-sm text-muted-foreground leading-snug">{c.tagline}</p>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />{c.members.toLocaleString()} {c.members === 1 ? "member" : "members"}
                      </span>
                      {user && (
                        <Button size="sm" variant={c.joined ? "outline" : "default"} disabled={busy} onClick={() => toggle.mutate(c)} data-testid={`button-join-${c.slug}`}>
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : c.joined ? <><Check className="h-4 w-4 mr-1" />Joined</> : "Join"}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      {/*
        * The table for a scored contest. Your own row is marked rather than
        * pulled to the top: a leaderboard that moves you out of position is
        * harder to read than one that highlights you in place.
        */}
      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Standings</DialogTitle>
            <DialogDescription>{viewing?.title}</DialogDescription>
          </DialogHeader>
          {standings.isLoading ? (
            <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !standings.data ? (
            <p className="py-6 text-sm text-muted-foreground">Couldn't load the standings.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {standings.data.played} of {standings.data.entrants} entrants have played.
                {standings.data.open ? " Still open." : " Closed — these are final."}
              </p>
              <ul className="overflow-y-auto divide-y" data-testid="list-standings">
                {standings.data.standings.map((row) => (
                  <li
                    key={row.userId}
                    className={`flex items-center gap-3 py-2 ${row.userId === user?.id ? "bg-primary/5 rounded-md px-2 -mx-2" : ""}`}
                    data-testid={`standing-${row.userId}`}
                  >
                    <span className="w-8 shrink-0 text-sm tabular-nums text-muted-foreground">
                      {row.rank ?? "—"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {row.name}{row.userId === user?.id ? " (you)" : ""}
                      </span>
                      {/*
                        * The company, because a row that says what they built
                        * reads like something somebody did rather than a number.
                        */}
                      {row.company && <span className="block truncate text-xs text-muted-foreground">{row.company}</span>}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular-nums">
                        {row.best == null ? "—" : money(row.best)}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {row.played === 0 ? "not played" : `${row.played} ${row.played === 1 ? "game" : "games"}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {/*
                * Two entrants who played each other share one verdict, so they
                * share a number and a rank. Said once here rather than leaving
                * somebody to wonder whether the table is broken.
                */}
              <p className="text-[11px] text-muted-foreground">
                Best ten-year valuation from a game played while the contest is open. The game is
                played in pairs, so partners share a result.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/*
        * Filing the work: a link, and optionally a sentence about it. Mirrors the
        * phone's sheet, including leaving the question of whether something is a
        * link to the server — one opinion, and it is the one that answers.
        */}
      <Dialog open={!!filing} onOpenChange={(open) => !open && setFiling(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{filing?.submission ? "Change your entry" : "File your entry"}</DialogTitle>
            <DialogDescription>{filing?.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="submission-url">Link to what you built</Label>
              <Input
                id="submission-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://"
                autoComplete="off"
                spellCheck={false}
                data-testid="input-submission-url"
              />
              <p className="text-xs text-muted-foreground">
                A live page, a repository, a video. You can change it until entries close.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="submission-note">Anything the judge should know (optional)</Label>
              <Textarea
                id="submission-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                rows={4}
                placeholder="What it does, and what you'd do next."
                data-testid="input-submission-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFiling(null)}>Cancel</Button>
            <Button
              /* Only the obviously-empty case is stopped here; the server judges the rest. */
              disabled={!url.trim() || submit.isPending}
              onClick={() => filing && submit.mutate(filing)}
              data-testid="button-submit-entry"
            >
              {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : filing?.submission ? "Save the change" : "File it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </div>
    </div>
  );
}
