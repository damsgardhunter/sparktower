import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import NotFound from "@/pages/not-found";
import {
  Activity, Loader2, Users, MousePointerClick, FileWarning, Radio, Eye, Clock,
} from "lucide-react";
import { ONLINE_WINDOW_MINUTES, isFailure, timeAgo } from "@shared/analytics";

interface FeedEvent {
  id: string;
  seq: number;
  at: string;
  kind: "page" | "action" | "session";
  label: string;
  path: string;
  method: string | null;
  status: number | null;
  durationMs: number | null;
  visitorId: string;
  sessionId: string;
  userId: string | null;
  who: string | null;
  email: string | null;
}

interface OnlineRow {
  visitorId: string; sessionId: string; userId: string | null;
  who: string | null; email: string | null; lastSeen: string; doing: string;
}

interface SessionRow {
  sessionId: string; visitorId: string; userId: string | null;
  who: string | null; email: string | null;
  startedAt: string; endedAt: string; events: number; durationMs: number;
}

interface Summary {
  windowDays: number;
  onlineNow: number;
  onlineWindowMinutes: number;
  totals: {
    events: number; visitors: number; sessions: number; accounts: number;
    pageViews: number; actions: number; failures: number;
  } | null;
  topPages: { pattern: string; label: string; n: number; people: number }[];
  topActions: { pattern: string; label: string; method: string | null; n: number; people: number }[];
  failing: { pattern: string; label: string; method: string | null; status: number | null; n: number }[];
  byHour: { hour: string; events: number; people: number }[];
}

/** Anonymous visitors have no name; a short id is still a handle to recognise. */
const nameOf = (e: { who: string | null; visitorId: string }) =>
  e.who || `Visitor ${e.visitorId.slice(0, 6)}`;

const duration = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

/** A colour per person, so one visitor's trail is followable down the feed. */
function hueOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

function Stat({ label, value, sub, icon }: {
  label: string; value: string | number; sub?: string; icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
          {icon}{label}
        </div>
        <p className="text-2xl font-bold tabular-nums leading-none">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

/** Events per hour. Bars rather than a chart library — it's one series. */
function HourBars({ data }: { data: Summary["byHour"] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Nothing yet.</p>;
  }
  const peak = Math.max(...data.map((d) => d.events), 1);
  return (
    <div className="flex items-end gap-[3px] h-24 overflow-x-auto">
      {data.map((d) => (
        <div
          key={d.hour}
          className="flex-1 min-w-[6px] bg-primary/70 hover:bg-primary rounded-t-sm transition-colors"
          style={{ height: `${Math.max(3, (d.events / peak) * 100)}%` }}
          title={`${new Date(d.hour).toLocaleString()} — ${d.events} events, ${d.people} people`}
        />
      ))}
    </div>
  );
}

/**
 * The owner's window onto what people are doing, as they do it.
 *
 * Gated by its own role rather than the reviewer one: handing someone the
 * report queue shouldn't also hand them a live feed of every person's
 * movements. The server enforces that on every route here and answers 404 to
 * anyone else — this page's own check only decides what to render.
 */
export default function AdminAnalytics() {
  const [days, setDays] = useState(7);
  const [live, setLive] = useState<FeedEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [openSession, setOpenSession] = useState<string | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const { data: access, isLoading: accessLoading } = useQuery<{ owner: boolean }>({
    queryKey: ["/api/admin/analytics/access"],
    queryFn: async () => {
      const res = await fetch("/api/admin/analytics/access", { credentials: "include" });
      if (!res.ok) return { owner: false };
      return res.json();
    },
    retry: false,
  });
  const isOwner = !!access?.owner;

  const { data: summary } = useQuery<Summary>({
    queryKey: ["/api/admin/analytics/summary", days],
    queryFn: async () => {
      const res = await fetch(`/api/admin/analytics/summary?days=${days}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: isOwner,
    refetchInterval: 15_000,
  });

  const { data: online } = useQuery<OnlineRow[]>({
    queryKey: ["/api/admin/analytics/online"],
    queryFn: async () => {
      const res = await fetch("/api/admin/analytics/online", { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: isOwner,
    refetchInterval: 10_000,
  });

  const { data: sessions } = useQuery<SessionRow[]>({
    queryKey: ["/api/admin/analytics/sessions"],
    queryFn: async () => {
      const res = await fetch("/api/admin/analytics/sessions?limit=25", { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: isOwner,
    refetchInterval: 20_000,
  });

  const { data: sessionDetail } = useQuery<FeedEvent[]>({
    queryKey: ["/api/admin/analytics/sessions", openSession],
    queryFn: async () => {
      const res = await fetch(`/api/admin/analytics/sessions/${openSession}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: !!openSession,
  });

  /*
   * The live tail. EventSource reconnects on its own after a drop, so there's
   * no retry logic here — but a reconnect replays the backfill, hence the
   * de-duplication by `seq` when merging.
   */
  useEffect(() => {
    if (!isOwner) return;
    const es = new EventSource("/api/admin/analytics/live", { withCredentials: true });

    const merge = (incoming: FeedEvent[]) => {
      if (pausedRef.current) return;
      setLive((prev) => {
        const seen = new Set(prev.map((e) => e.seq));
        const fresh = incoming.filter((e) => !seen.has(e.seq));
        if (fresh.length === 0) return prev;
        // Newest first, and capped: this list runs for as long as the tab is
        // open, and an unbounded one eventually takes the tab with it.
        return [...fresh.reverse(), ...prev].slice(0, 300);
      });
    };

    es.addEventListener("open", () => setConnected(true));
    es.addEventListener("backfill", (ev) => {
      setConnected(true);
      try { merge(JSON.parse((ev as MessageEvent).data)); } catch { /* ignore */ }
    });
    es.addEventListener("events", (ev) => {
      try { merge(JSON.parse((ev as MessageEvent).data)); } catch { /* ignore */ }
    });
    es.addEventListener("error", () => setConnected(false));

    return () => es.close();
  }, [isOwner]);

  const t = summary?.totals;
  const failureRate = useMemo(() => {
    if (!t || t.actions === 0) return null;
    return Math.round((t.failures / t.actions) * 100);
  }, [t]);

  if (accessLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (!isOwner) return <NotFound />;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6" data-testid="admin-analytics">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" /> Behaviour
          </h1>
          <p className="text-sm text-muted-foreground">
            Every page opened and every action taken, as it happens. Only you can see this.
          </p>
        </div>
        <div className="flex gap-1">
          {[1, 7, 30].map((d) => (
            <Button
              key={d} size="sm" variant={days === d ? "default" : "outline"}
              onClick={() => setDays(d)} data-testid={`window-${d}`}
            >
              {d === 1 ? "24h" : `${d}d`}
            </Button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat
          icon={<Radio className="h-3 w-3" />} label="Here now"
          value={summary?.onlineNow ?? "—"}
          sub={`active in ${ONLINE_WINDOW_MINUTES} min`}
        />
        <Stat
          icon={<Users className="h-3 w-3" />} label="People"
          value={t?.visitors ?? "—"} sub={`${t?.accounts ?? 0} signed in`}
        />
        <Stat
          icon={<Clock className="h-3 w-3" />} label="Visits"
          value={t?.sessions ?? "—"}
        />
        <Stat
          icon={<Eye className="h-3 w-3" />} label="Pages"
          value={t?.pageViews ?? "—"}
        />
        <Stat
          icon={<MousePointerClick className="h-3 w-3" />} label="Actions"
          value={t?.actions ?? "—"}
          sub={failureRate == null ? undefined : `${failureRate}% failed`}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Events per hour</CardTitle>
        </CardHeader>
        <CardContent>
          <HourBars data={summary?.byHour ?? []} />
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* --- Live feed ------------------------------------------------ */}
        <Card className="lg:row-span-2">
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              Live
              <span
                className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"}`}
                title={connected ? "Streaming" : "Reconnecting"}
              />
            </CardTitle>
            <Button
              size="sm" variant="ghost" className="h-7 text-xs"
              onClick={() => setPaused((p) => !p)} data-testid="toggle-pause"
            >
              {paused ? "Resume" : "Pause"}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[520px]">
              {live.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-16">
                  {connected ? "Waiting for someone to do something." : "Connecting…"}
                </p>
              ) : (
                <ul className="divide-y divide-border/50">
                  {live.map((e) => (
                    <li key={e.seq} className="px-4 py-2 flex items-start gap-2.5 hover:bg-muted/40">
                      <span
                        className="mt-1.5 h-2 w-2 rounded-full shrink-0"
                        style={{ background: `hsl(${hueOf(e.visitorId)} 65% 55%)` }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug">
                          <button
                            className="font-medium hover:underline"
                            onClick={() => setOpenSession(e.sessionId)}
                          >
                            {nameOf(e)}
                          </button>
                          <span className="text-muted-foreground"> · {e.label}</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                          {timeAgo(e.at)}
                          {e.durationMs != null && <span>· {e.durationMs}ms</span>}
                          {isFailure(e.status) && (
                            <Badge variant="destructive" className="text-[9px] h-3.5 px-1">
                              {e.status}
                            </Badge>
                          )}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* --- Who's here ----------------------------------------------- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Here right now</CardTitle>
          </CardHeader>
          <CardContent>
            {!online || online.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Nobody on the site.</p>
            ) : (
              <ul className="space-y-2">
                {online.map((o) => (
                  <li key={o.visitorId} className="flex items-center gap-2.5 text-sm">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: `hsl(${hueOf(o.visitorId)} 65% 55%)` }}
                    />
                    <button
                      className="font-medium hover:underline shrink-0"
                      onClick={() => setOpenSession(o.sessionId)}
                    >
                      {nameOf(o)}
                    </button>
                    <span className="text-muted-foreground truncate">{o.doing}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground shrink-0">
                      {timeAgo(o.lastSeen)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* --- Where they go -------------------------------------------- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Most visited</CardTitle>
          </CardHeader>
          <CardContent>
            {!summary?.topPages.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No page views yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {summary.topPages.map((p) => (
                  <li key={p.pattern} className="flex items-baseline gap-2 text-sm">
                    <span className="truncate">{p.label}</span>
                    <span className="flex-1 border-b border-dashed border-border/60" />
                    <span className="tabular-nums shrink-0">{p.n}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 w-16 text-right">
                      {p.people} {p.people === 1 ? "person" : "people"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* --- What they do --------------------------------------------- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">What people did</CardTitle>
          </CardHeader>
          <CardContent>
            {!summary?.topActions.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No actions yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {summary.topActions.map((a) => (
                  <li key={`${a.method}${a.pattern}`} className="flex items-baseline gap-2 text-sm">
                    <span className="truncate">{a.label}</span>
                    <span className="flex-1 border-b border-dashed border-border/60" />
                    <span className="tabular-nums shrink-0">{a.n}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 w-16 text-right">
                      {a.people} {a.people === 1 ? "person" : "people"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* --- What broke ------------------------------------------------ */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <FileWarning className="h-3.5 w-3.5 text-destructive" /> Where people got stuck
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!summary?.failing.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Nothing failed in this window.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {summary.failing.map((f, i) => (
                  <li key={i} className="flex items-baseline gap-2 text-sm">
                    <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">{f.status}</Badge>
                    <span className="truncate">{f.label}</span>
                    <span className="flex-1 border-b border-dashed border-border/60" />
                    <span className="tabular-nums shrink-0">{f.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* --- Visits ------------------------------------------------------ */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Recent visits</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!sessions?.length ? (
            <p className="text-sm text-muted-foreground py-10 text-center">No visits in the last week.</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {sessions.map((s) => (
                <li key={s.sessionId}>
                  <button
                    className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-muted/40 text-left"
                    onClick={() => setOpenSession(s.sessionId)}
                    data-testid={`session-${s.sessionId}`}
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: `hsl(${hueOf(s.visitorId)} 65% 55%)` }}
                    />
                    <span className="font-medium text-sm shrink-0">{nameOf(s)}</span>
                    {s.email && (
                      <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">
                        {s.email}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground shrink-0 tabular-nums">
                      <span>{s.events} events</span>
                      <span>{duration(s.durationMs)}</span>
                      <span>{timeAgo(s.endedAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* --- One visit, in order ----------------------------------------- */}
      <Dialog open={!!openSession} onOpenChange={(o) => !o && setOpenSession(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>This visit, in order</DialogTitle>
            <DialogDescription>
              {sessionDetail?.length
                ? `${sessionDetail.length} events · ${nameOf(sessionDetail[0])}`
                : "Loading…"}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 min-h-0 -mx-1 px-1">
            {!sessionDetail ? (
              <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            ) : (
              <ol className="relative border-l border-border/70 ml-2 space-y-3 py-2">
                {sessionDetail.map((e) => (
                  <li key={e.seq} className="ml-4">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-primary/70" />
                    <p className="text-sm leading-snug">
                      {e.label}
                      {isFailure(e.status) && (
                        <Badge variant="destructive" className="ml-1.5 text-[9px] h-3.5 px-1">
                          {e.status}
                        </Badge>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(e.at).toLocaleTimeString()}
                      {e.durationMs != null && ` · ${e.durationMs}ms`}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
