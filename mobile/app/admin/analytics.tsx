import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { API_URL, api, getAccessToken } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Icon, Loading, Screen, Segments, type IconName } from "../../src/components/ui";
import { PageIntro, Pill, TitledCard } from "../../src/components/MoreKit";
import { Sheet } from "../../src/components/Sheet";
import { CountRow, NotFoundScreen, formatPercent, text } from "../../src/components/more/AdminKit";

/** shared/analytics.ts, restated. */
const ONLINE_WINDOW_MINUTES = 5;
const isFailure = (status: number | null | undefined) => typeof status === "number" && status >= 400;
function ago(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface FeedEvent {
  id: string; seq: number; at: string; kind: "page" | "action" | "session"; label: string; path: string;
  method: string | null; status: number | null; durationMs: number | null;
  visitorId: string; sessionId: string; userId: string | null; who: string | null; email: string | null;
}
interface OnlineRow { visitorId: string; sessionId: string; userId: string | null; who: string | null; email: string | null; lastSeen: string; doing: string }
interface SessionRow {
  sessionId: string; visitorId: string; userId: string | null; who: string | null; email: string | null;
  startedAt: string; endedAt: string; events: number; durationMs: number;
}
interface Summary {
  windowDays: number;
  onlineNow: number;
  totals: { events: number; visitors: number; sessions: number; accounts: number; pageViews: number; actions: number; failures: number } | null;
  topPages: { pattern: string; label: string; n: number; people: number }[];
  topActions: { pattern: string; label: string; method: string | null; n: number; people: number }[];
  failing: { pattern: string; label: string; method: string | null; status: number | null; n: number }[];
  signupSources: { source: string; medium: string | null; campaign: string | null; signups: number }[];
  byHour: { hour: string; events: number; people: number }[];
  explore?: {
    funnel: { key: string; label: string; sessions: number; ofOpened: number | null }[];
    timeToFirstAction: { sessions: number; p50Ms: number | null; p90Ms: number | null };
    repeat: { people: number; repeated: number; rate: number | null };
    cycles?: { sessions: number; completedOne: number; twoPlus: number; rate: number | null };
  };
}

/** Anonymous visitors have no name; a short id is still a handle to recognise. */
const nameOf = (e: { who: string | null; visitorId: string }) => e.who || `Visitor ${e.visitorId.slice(0, 6)}`;

const duration = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

/** A colour per person, so one visitor's trail is followable down the feed. */
function hueOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h}, 65%, 55%)`;
}

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

const WINDOWS = [{ value: "1", label: "24h" }, { value: "7", label: "7d" }, { value: "30", label: "30d" }];

/**
 * The owner's window onto what people are doing — the web's /admin/analytics.
 * Gated by GET /api/admin/analytics/access rather than the reviewer role; the
 * server answers 404 on every data route to anyone else.
 */
export default function AdminAnalytics() {
  const [days, setDays] = useState("7");
  const [openSession, setOpenSession] = useState<string | null>(null);

  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ["admin-analytics-access"],
    queryFn: () => api<{ owner: boolean }>("/api/admin/analytics/access").catch(() => ({ owner: false })),
    retry: false,
  });
  const isOwner = !!access?.owner;

  const { data: summary, refetch, isRefetching } = useQuery({
    queryKey: ["admin-analytics-summary", days],
    queryFn: () => api<Summary>(`/api/admin/analytics/summary?days=${days}`),
    enabled: isOwner,
    refetchInterval: 15_000,
  });
  const { data: online } = useQuery({
    queryKey: ["admin-analytics-online"],
    queryFn: () => api<OnlineRow[]>("/api/admin/analytics/online"),
    enabled: isOwner,
    refetchInterval: 10_000,
  });
  const { data: sessions } = useQuery({
    queryKey: ["admin-analytics-sessions"],
    queryFn: () => api<SessionRow[]>("/api/admin/analytics/sessions?limit=25"),
    enabled: isOwner,
    refetchInterval: 20_000,
  });

  const t = summary?.totals;
  const failureRate = useMemo(() => (!t || t.actions === 0 ? null : Math.round((t.failures / t.actions) * 100)), [t]);

  if (accessLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Stack.Screen options={{ title: "Behaviour" }} />
        <Loading />
      </View>
    );
  }
  if (!isOwner) return <NotFoundScreen title="Behaviour" />;

  const ex = summary?.explore;

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <Stack.Screen options={{ title: "Behaviour" }} />
      <Screen canvas onRefresh={() => refetch()} refreshing={isRefetching}>
        <PageIntro icon="pulse" title="Behaviour" body="Every page opened and every action taken, as it happens. Only you can see this." />
        <Segments options={WINDOWS} value={days} onChange={setDays} />

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          <Tile icon="radio" label="Here now" value={summary?.onlineNow ?? "—"} sub={`active in ${ONLINE_WINDOW_MINUTES} min`} />
          <Tile icon="people" label="People" value={t?.visitors ?? "—"} sub={`${t?.accounts ?? 0} signed in`} />
          <Tile icon="time" label="Visits" value={t?.sessions ?? "—"} />
          <Tile icon="eye" label="Pages" value={t?.pageViews ?? "—"} />
          <Tile icon="hand-left" label="Actions" value={t?.actions ?? "—"} sub={failureRate == null ? undefined : `${failureRate}% failed`} />
        </View>

        <TitledCard title="Events per hour">
          <HourBars data={summary?.byHour ?? []} />
        </TitledCard>

        <LiveFeed onOpen={setOpenSession} />

        <TitledCard title="Here right now">
          {!online?.length ? <Text style={[text.meta, { textAlign: "center", paddingVertical: spacing.md }]}>Nobody on the site.</Text>
            : online.map((o) => (
              <Pressable key={o.visitorId} onPress={() => setOpenSession(o.sessionId)} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4 }}>
                <Dot id={o.visitorId} />
                <Text style={text.strong}>{nameOf(o)}</Text>
                <Text style={[text.small, { flex: 1 }]} numberOfLines={1}>{o.doing}</Text>
                <Text style={text.small}>{ago(o.lastSeen)}</Text>
              </Pressable>
            ))}
        </TitledCard>

        <TitledCard title="Most visited">
          {!summary?.topPages.length ? <EmptyLine text="No page views yet." />
            : summary.topPages.map((p) => <CountRow key={p.pattern} label={p.label} value={p.n} note={people(p.people)} />)}
        </TitledCard>

        <TitledCard title="Where signups came from">
          {!summary?.signupSources?.length ? <EmptyLine text="No signups in this window." />
            : summary.signupSources.map((r, i) => (
              <CountRow
                key={i}
                label={`${r.source}${r.campaign ? ` · ${r.campaign}` : ""}${r.medium && r.medium !== "direct" ? ` (${r.medium})` : ""}`}
                value={r.signups}
              />
            ))}
        </TitledCard>

        <TitledCard title="Explore loop">
          {!ex || !ex.funnel[0]?.sessions ? <EmptyLine text="Nobody opened Discover in this window." /> : (
            <>
              {ex.funnel.map((step) => (
                <CountRow
                  key={step.key}
                  label={step.label}
                  value={step.sessions}
                  note={step.ofOpened == null ? "" : `${Math.round(step.ofOpened * 100)}%`}
                  share={step.ofOpened ?? 0}
                />
              ))}
              <Text style={text.small}>Sessions, as a share of those that opened Discover.</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm }}>
                <BigNumber
                  label="Time to first action"
                  value={ex.timeToFirstAction.p50Ms == null ? "—" : duration(ex.timeToFirstAction.p50Ms)}
                  sub={`median${ex.timeToFirstAction.p90Ms != null ? ` · 90% within ${duration(ex.timeToFirstAction.p90Ms)}` : ""} · ${ex.timeToFirstAction.sessions} session${ex.timeToFirstAction.sessions === 1 ? "" : "s"}`}
                />
                <BigNumber
                  label="Repeat rate"
                  value={ex.repeat.rate == null ? "—" : formatPercent(ex.repeat.rate * 100)}
                  sub={`${ex.repeat.repeated} of ${ex.repeat.people} came back on another visit`}
                />
                {ex.cycles ? (
                  <BigNumber
                    label="Two or more full loops"
                    value={ex.cycles.rate == null ? "—" : formatPercent(ex.cycles.rate * 100)}
                    sub={`${ex.cycles.twoPlus} of ${ex.cycles.sessions} sessions went open → act → back, twice`}
                  />
                ) : null}
              </View>
            </>
          )}
        </TitledCard>

        <TitledCard title="What people did">
          {!summary?.topActions.length ? <EmptyLine text="No actions yet." />
            : summary.topActions.map((a) => <CountRow key={`${a.method}${a.pattern}`} label={a.label} value={a.n} note={people(a.people)} />)}
        </TitledCard>

        <TitledCard title="Where people got stuck" icon="document-text" tint={colors.danger}>
          {!summary?.failing.length ? <EmptyLine text="Nothing failed in this window." />
            : summary.failing.map((f, i) => (
              <CountRow key={i} label={f.label} value={f.n} leading={<Pill label={String(f.status ?? "")} color={colors.danger} />} />
            ))}
        </TitledCard>

        <TitledCard title="Recent visits">
          {!sessions?.length ? <EmptyLine text="No visits in the last week." />
            : sessions.map((s) => (
              <Pressable
                key={s.sessionId}
                onPress={() => setOpenSession(s.sessionId)}
                style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 8, borderTopWidth: 1, borderColor: colors.borderSubtle }, pressed && { opacity: 0.65 }]}
              >
                <Dot id={s.visitorId} />
                <View style={{ flex: 1 }}>
                  <Text style={text.strong} numberOfLines={1}>{nameOf(s)}</Text>
                  {s.email ? <Text style={text.small} numberOfLines={1}>{s.email}</Text> : null}
                </View>
                <Text style={[text.small, { textAlign: "right" }]}>
                  {s.events} events · {duration(s.durationMs)}{"\n"}{ago(s.endedAt)}
                </Text>
                <Icon name="chevron-forward" size={15} color={colors.textTertiary} />
              </Pressable>
            ))}
        </TitledCard>
      </Screen>

      {openSession ? <SessionSheet id={openSession} onClose={() => setOpenSession(null)} /> : null}
    </View>
  );
}

/**
 * The live tail. The web uses EventSource, which a phone doesn't have and which
 * can't carry a Bearer token anyway — so this reads the same text/event-stream
 * over XHR as it arrives, reconnecting after a drop. A reconnect replays the
 * backfill, hence the de-duplication by `seq`.
 */
function LiveFeed({ onOpen }: { onOpen: (sessionId: string) => void }) {
  const [live, setLive] = useState<FeedEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    let xhr: XMLHttpRequest | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const merge = (incoming: FeedEvent[]) => {
      if (pausedRef.current || !incoming.length) return;
      setLive((prev) => {
        const seen = new Set(prev.map((e) => e.seq));
        const fresh = incoming.filter((e) => !seen.has(e.seq));
        if (fresh.length === 0) return prev;
        // Newest first, and capped: the list runs for as long as the screen is open.
        return [...fresh.reverse(), ...prev].slice(0, 300);
      });
    };

    const connect = async () => {
      if (stopped) return;
      // A cheap authenticated call first, so an expired token is refreshed before the stream needs it.
      await api("/api/admin/analytics/access").catch(() => null);
      const token = await getAccessToken();
      if (stopped) return;
      const req = new XMLHttpRequest();
      xhr = req;
      let read = 0;
      let buffer = "";
      req.open("GET", `${API_URL}/api/admin/analytics/live`);
      if (token) req.setRequestHeader("Authorization", `Bearer ${token}`);
      req.setRequestHeader("Accept", "text/event-stream");
      req.onreadystatechange = () => {
        if (req.readyState >= 2 && req.status === 200) setConnected(true);
        if (req.readyState < 3) return;
        const chunk = req.responseText.slice(read);
        read = req.responseText.length;
        buffer += chunk;
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          let event = "message";
          let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if ((event === "backfill" || event === "events") && data) {
            try { merge(JSON.parse(data)); } catch { /* ignore */ }
          }
        }
        if (req.readyState === 4) {
          setConnected(false);
          if (!stopped) retry = setTimeout(connect, 3000);
        }
      };
      req.onerror = () => {
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, 3000);
      };
      req.send();
    };

    void connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      xhr?.abort();
    };
  }, []);

  return (
    <TitledCard
      title="Live"
      action={
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: connected ? colors.success : colors.border }} accessibilityLabel={connected ? "Streaming" : "Reconnecting"} />
          <Btn label={paused ? "Resume" : "Pause"} small variant="ghost" onPress={() => setPaused((p) => !p)} />
        </View>
      }
    >
      {live.length === 0 ? (
        <Text style={[text.meta, { textAlign: "center", paddingVertical: spacing.lg }]}>
          {connected ? "Waiting for someone to do something." : "Connecting…"}
        </Text>
      ) : (
        <ScrollView style={{ maxHeight: 380 }} nestedScrollEnabled>
          {live.map((e) => (
            <View key={e.seq} style={{ flexDirection: "row", gap: spacing.sm, paddingVertical: 6, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
              <View style={{ paddingTop: 6 }}><Dot id={e.visitorId} /></View>
              <View style={{ flex: 1 }}>
                <Text style={text.body}>
                  <Text onPress={() => onOpen(e.sessionId)} style={{ fontFamily: fontFamily.semibold }}>{nameOf(e)}</Text>
                  <Text style={{ color: colors.textSecondary }}> · {e.label}</Text>
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={text.small}>{ago(e.at)}{e.durationMs != null ? ` · ${e.durationMs}ms` : ""}</Text>
                  {isFailure(e.status) ? <Pill label={String(e.status)} color={colors.danger} solid /> : null}
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </TitledCard>
  );
}

/** One visit, in order. */
function SessionSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["admin-analytics-session", id],
    queryFn: () => api<FeedEvent[]>(`/api/admin/analytics/sessions/${id}`),
  });
  return (
    <Sheet
      visible
      onClose={onClose}
      title="This visit, in order"
      subtitle={data?.length ? `${data.length} events · ${nameOf(data[0])}` : "Loading…"}
    >
      {!data ? <View style={{ height: 120 }}><Loading /></View> : (
        <ScrollView style={{ maxHeight: 440 }}>
          <View style={{ borderLeftWidth: 1, borderColor: colors.border, marginLeft: 5, paddingLeft: spacing.md, gap: spacing.sm, paddingVertical: 4 }}>
            {data.map((e) => (
              <View key={e.seq}>
                <View style={{ position: "absolute", left: -spacing.md - 5, top: 5, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary, opacity: 0.75 }} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Text style={text.body}>{e.label}</Text>
                  {isFailure(e.status) ? <Pill label={String(e.status)} color={colors.danger} solid /> : null}
                </View>
                <Text style={text.small}>{new Date(e.at).toLocaleTimeString()}{e.durationMs != null ? ` · ${e.durationMs}ms` : ""}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </Sheet>
  );
}

function Tile({ icon, label, value, sub }: { icon: IconName; label: string; value: string | number; sub?: string }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: "30%", minWidth: 100, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Icon name={icon} size={12} color={colors.textTertiary} />
        <Text style={text.small}>{label}</Text>
      </View>
      <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>{value}</Text>
      {sub ? <Text style={text.small}>{sub}</Text> : null}
    </View>
  );
}

/** Events per hour, as bars — one series, no chart library. */
function HourBars({ data }: { data: Summary["byHour"] }) {
  if (data.length === 0) return <EmptyLine text="Nothing yet." />;
  const peak = Math.max(...data.map((d) => d.events), 1);
  const busiest = data.reduce((a, b) => (b.events > a.events ? b : a), data[0]);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height: 96 }}>
        {data.map((d) => (
          <View key={d.hour} style={{ flex: 1, height: `${Math.max(3, (d.events / peak) * 100)}%`, backgroundColor: colors.primary, opacity: 0.7, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
        ))}
      </View>
      <Text style={text.small}>
        Busiest: {new Date(busiest.hour).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" })} — {busiest.events} events, {people(busiest.people)}
      </Text>
    </View>
  );
}

function BigNumber({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: "45%", gap: 2 }}>
      <Text style={text.over}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>{value}</Text>
      <Text style={text.small}>{sub}</Text>
    </View>
  );
}

const EmptyLine = ({ text: t }: { text: string }) => (
  <Text style={[text.meta, { textAlign: "center", paddingVertical: spacing.md }]}>{t}</Text>
);

const Dot = ({ id }: { id: string }) => <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: hueOf(id) }} />;
