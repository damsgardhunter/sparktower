/**
 * What people have told us is broken.
 *
 * Deliberately not the content-report console (`admin-reports.tsx`): that one
 * is about people and posts and ends in a moderation decision, this is about
 * the product and ends in a fix. They are read by different people looking for
 * different things, and putting a screen that will not load in the same queue
 * as an abuse report is how both get read badly.
 *
 * The queue is a list of sentences with the page each came from. There is no
 * assignment, no priority, no severity — four states and a note, because a
 * triage system with more moving parts than reports is a way of not reading
 * them.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Loading } from "@/components/nova";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import NotFound from "@/pages/not-found";
import { useAuth } from "@/hooks/use-auth";
import {
  PROBLEM_STATUSES, PROBLEM_STATUS_COPY, type ProblemStatus,
} from "@shared/problem-reports";
import { Loader2, MessageSquareWarning, ExternalLink, Monitor } from "lucide-react";

interface ProblemRow {
  id: string;
  message: string;
  path: string | null;
  userAgent: string | null;
  status: ProblemStatus;
  note: string | null;
  createdAt: string;
  handledAt: string | null;
  userId: string | null;
  email: string | null;
}

const KEY = ["/api/admin/problem-reports"] as const;

/** A browser, in the two words anybody actually wants from a user-agent. */
function browserOf(ua: string | null): string | null {
  if (!ua) return null;
  const engine = /Edg\//.test(ua) ? "Edge"
    : /Chrome\//.test(ua) && !/Chromium/.test(ua) ? "Chrome"
    : /Safari\//.test(ua) && !/Chrome\//.test(ua) ? "Safari"
    : /Firefox\//.test(ua) ? "Firefox" : null;
  const platform = /iPhone|iPad/.test(ua) ? "iOS"
    : /Android/.test(ua) ? "Android"
    : /Macintosh/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows" : null;
  return [engine, platform].filter(Boolean).join(" on ") || null;
}

export default function AdminProblems() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ProblemStatus | "all">("new");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const { data, isLoading, isError } = useQuery<{ reports: ProblemRow[]; counts: Record<ProblemStatus, number> }>({
    queryKey: [...KEY, filter],
    queryFn: async () => {
      const q = filter === "all" ? "" : `?status=${filter}`;
      const res = await fetch(`/api/admin/problem-reports${q}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
  });

  const move = useMutation({
    mutationFn: async (b: { id: string; status?: ProblemStatus; note?: string }) =>
      (await apiRequest("PATCH", `/api/admin/problem-reports/${b.id}`, { status: b.status, note: b.note })).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      toast({ title: "Updated" });
    },
    onError: (e) => toast({ title: "Couldn't update that", description: errorText(e), variant: "destructive" }),
  });

  /* The API answers 404 to anyone who shouldn't know this exists; the page agrees. */
  if (isError || (user && user.platformRole !== "admin" && user.platformRole !== "owner")) return <NotFound />;

  const counts = data?.counts;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 space-y-4" data-testid="page-admin-problems">
        <header>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <MessageSquareWarning className="h-6 w-6 text-primary" /> Problems reported
          </h1>
          <p className="mt-1 text-muted-foreground">
            What people said was broken, newest first, with the page they were on.
          </p>
        </header>

        <div className="flex flex-wrap gap-2">
          {(["all", ...PROBLEM_STATUSES] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={filter === s ? "default" : "outline"}
              onClick={() => setFilter(s)}
              data-testid={`filter-${s}`}
            >
              {s === "all" ? "All" : PROBLEM_STATUS_COPY[s].label}
              {s !== "all" && counts && counts[s] > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 px-1.5 text-[10px]">{counts[s]}</Badge>
              )}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <Loading what="Reading the queue" />
        ) : !data?.reports.length ? (
          <Card className="nova-ring-soft border-0">
            <CardContent className="py-12 text-center space-y-1">
              <p className="font-medium">Nothing here</p>
              <p className="text-sm text-muted-foreground">
                {filter === "new" ? "No unread reports. That is the good version of an empty page." : "Nothing in this state."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3" data-testid="list-problems">
            {data.reports.map((r) => {
              const browser = browserOf(r.userAgent);
              return (
                <li key={r.id}>
                  <Card className="nova-ring-soft border-0" data-testid={`problem-${r.id}`}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant={r.status === "new" ? "default" : "secondary"} className="text-[10px]">
                          {PROBLEM_STATUS_COPY[r.status].label}
                        </Badge>
                        <span title={new Date(r.createdAt).toLocaleString()}>
                          {new Date(r.createdAt).toLocaleString()}
                        </span>
                        {r.path && (
                          <Link href={r.path} className="inline-flex items-center gap-1 text-primary hover:underline" data-testid={`problem-path-${r.id}`}>
                            <ExternalLink className="h-3 w-3" />{r.path}
                          </Link>
                        )}
                        {browser && <span className="inline-flex items-center gap-1"><Monitor className="h-3 w-3" />{browser}</span>}
                        {/* Who, when there is a who — a signed-out report is still a report. */}
                        <span>{r.email ?? "signed out"}</span>
                      </div>

                      <p className="whitespace-pre-wrap text-sm" data-testid={`problem-message-${r.id}`}>{r.message}</p>

                      {r.note && (
                        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs" data-testid={`problem-note-${r.id}`}>
                          <span className="font-medium">Note:</span> {r.note}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        {PROBLEM_STATUSES.filter((s) => s !== r.status).map((s) => (
                          <Button
                            key={s}
                            size="sm"
                            variant="outline"
                            disabled={move.isPending}
                            onClick={() => move.mutate({ id: r.id, status: s })}
                            title={PROBLEM_STATUS_COPY[s].blurb}
                            data-testid={`button-set-${s}-${r.id}`}
                          >
                            {move.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                            {PROBLEM_STATUS_COPY[s].label}
                          </Button>
                        ))}
                      </div>

                      <div className="flex gap-2">
                        <Textarea
                          value={notes[r.id] ?? ""}
                          onChange={(e) => setNotes((p) => ({ ...p, [r.id]: e.target.value }))}
                          placeholder="A note for whoever reads this next…"
                          className="min-h-[38px] text-sm"
                          data-testid={`input-note-${r.id}`}
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!notes[r.id]?.trim() || move.isPending}
                          onClick={() => move.mutate({ id: r.id, note: notes[r.id] })}
                          data-testid={`button-save-note-${r.id}`}
                        >
                          Save
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
