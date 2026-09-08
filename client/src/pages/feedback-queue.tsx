import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { Loader2, MessageSquare, ArrowRight, AlertTriangle, Inbox } from "lucide-react";
import { weekLabel, checkInPath } from "@shared/check-in";

interface QueueEntry {
  id: string;
  projectId: string;
  projectTitle: string;
  projectLogo: string | null;
  author: { name: string; avatarUrl: string | null };
  weekStart: string;
  goal: string;
  proof: string;
  blocker: string | null;
  nextStep: string;
  createdAt: string;
}

/** Hours since posting, so the 24-hour SLA is visible rather than implied. */
function hoursSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
}

/**
 * Check-ins whose author asked for a read — step 5 of the weekly loop.
 *
 * Pull-based on purpose. The spec rules out outbound pings, so this page is
 * the only route by which a check-in finds a responder, which makes it the
 * mechanism the whole "≥1 comment within 24h" promise rests on.
 *
 * Ordered oldest-first: the point is to clear the queue, and a stack that
 * shows the newest first leaves the people who've waited longest at the bottom.
 */
export default function FeedbackQueue() {
  const { data, isLoading } = useQuery<QueueEntry[]>({
    queryKey: ["/api/check-ins/queue/needs-feedback"],
    queryFn: async () => {
      const res = await fetch("/api/check-ins/queue/needs-feedback", { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const queue = [...(data ?? [])].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const overdue = queue.filter((c) => hoursSince(c.createdAt) >= 24).length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Inbox className="h-5 w-5 text-primary" /> Needs feedback
        </h1>
        <p className="text-sm text-muted-foreground">
          Builders who asked someone to read their week. One comment is enough — say what's
          working and what you'd push on.
        </p>
      </header>

      {!isLoading && queue.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="gap-1.5">
            {queue.length} waiting
          </Badge>
          {overdue > 0 && (
            <Badge className="gap-1.5 bg-amber-600 hover:bg-amber-600">
              <AlertTriangle className="h-3 w-3" /> {overdue} over 24h
            </Badge>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : queue.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center space-y-2">
            <MessageSquare className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="font-medium">Queue is clear</p>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Nobody is waiting on a read right now. Check back after the next round of check-ins.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {queue.map((c) => {
            const hours = hoursSince(c.createdAt);
            return (
              <Card key={c.id} data-testid={`queue-${c.id}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      {c.projectLogo ? (
                        <img
                          src={c.projectLogo} alt=""
                          className="h-8 w-8 rounded-md object-contain border border-border/60 bg-background p-0.5 shrink-0"
                        />
                      ) : (
                        <UserAvatar src={c.author.avatarUrl} name={c.author.name} className="h-8 w-8" />
                      )}
                      <div className="min-w-0">
                        <Link
                          href={`/projects/${c.projectId}`}
                          className="text-sm font-medium hover:underline break-words"
                        >
                          {c.projectTitle}
                        </Link>
                        <p className="text-[11px] text-muted-foreground">
                          {c.author.name} · {weekLabel(c.weekStart)}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={hours >= 24 ? "default" : "outline"}
                      className={`text-[10px] shrink-0 ${hours >= 24 ? "bg-amber-600 hover:bg-amber-600" : ""}`}
                    >
                      {hours < 1 ? "just now" : hours < 24 ? `${hours}h waiting` : `${Math.floor(hours / 24)}d waiting`}
                    </Badge>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-sm font-medium leading-snug">{c.goal}</p>
                    <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">{c.proof}</p>
                    {c.blocker && (
                      <p className="text-sm flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span className="leading-relaxed">{c.blocker}</span>
                      </p>
                    )}
                    <p className="text-sm flex items-start gap-1.5">
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
                      <span className="leading-relaxed">{c.nextStep}</span>
                    </p>
                  </div>

                  <Button
                    size="sm" variant="outline" className="gap-1.5"
                    onClick={() => { window.location.href = checkInPath(c.id); }}
                    data-testid={`button-read-${c.id}`}
                  >
                    <MessageSquare className="h-3.5 w-3.5" /> Read and reply
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
