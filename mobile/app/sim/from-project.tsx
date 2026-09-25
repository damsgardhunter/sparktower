/**
 * A season built around one of your own projects, on the phone.
 *
 * The web has had this on the project's Simulations tab for a while: Nova
 * reads what the project is and writes the market it is actually in — who
 * buys, where they are, and the four companies that already have them — then
 * stands a company up behind it so nobody fills in a form about an
 * organisation that does not exist. The phone had the market game and no way
 * to reach any of that, so somebody whose whole business is in this app could
 * only play one of the seven invented markets.
 *
 * It lives under `sim/` rather than on the project page because that page is
 * the public one — overview, updates, followers — and this is the owner's
 * door: pressing the button creates a company. Someone coming to play opens
 * Simulations, which is where this is linked from.
 *
 * Everything here is the same API the web calls. The market, the four rivals,
 * the share left open, the opening bank and the seat rules are all decided by
 * the server; this screen's only job is to ask which project, how often you
 * want to decide, and whether this is a market you already own.
 */
import { useState } from "react";
import { Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Body, Btn, Card, Empty, Label, Loading, Meta, Screen, Segments, errText } from "../../src/components/ui";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";

/** What the server hands back when a market is built or played again. */
interface Built {
  companyId: string;
  companyName: string;
  seasonId: string;
  inviteCode: string | null;
  market: {
    name: string;
    premise: string;
    written: boolean;
    segments: { name: string; description: string; size: number }[];
    regions: { name: string; note: string }[];
    rivals: { name: string; knock: string; share: number; posture: string }[];
    openShare: number;
  };
  cadence: string;
  periodName: string;
  replayed: boolean;
  seatsHeld: number;
  seatPriceCents: number;
  openingCash: number;
  currency: string;
  solo: boolean;
  fellBack: boolean;
}

interface ProjectRow { id: string; title: string | null }

interface Replayable {
  seasonId: string;
  name: string;
  marketName: string | null;
  rivals: string[];
  plays: number;
  lastFinish: { rank: number; field: number; marketShare: number; profitable: boolean; bankrupt: boolean; year: number } | null;
}

const SYMBOLS: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", CAD: "$", AUD: "$", NZD: "$", JPY: "¥", INR: "₹" };
const symbolFor = (code: string | null | undefined) => SYMBOLS[String(code ?? "USD").toUpperCase()] ?? "$";

/** "$60k", "$1.2m" — the opening bank as somebody would say it out loud. */
function money(n: number, code: string): string {
  const sym = symbolFor(code);
  if (n >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${sym}${Math.round(n / 1_000)}k`;
  return `${sym}${Math.round(n)}`;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** "1st", "2nd" — a finishing position reads as a place, not a number. */
const ordinal = (n: number): string => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

/** The same three the web offers, in the same words. */
const CADENCES = [
  { value: "monthly", label: "Every month" },
  { value: "quarterly", label: "Every quarter" },
  { value: "yearly", label: "Every year" },
] as const;

const CADENCE_NOTE: Record<string, string> = {
  monthly: "Closest to your actual week. Two simulated years of decisions.",
  quarterly: "A planning rhythm. Four years, sixteen decisions.",
  yearly: "The long view: strategy, and living with it. Eight years.",
};

/**
 * Who holds the market, as a bar.
 *
 * The one thing somebody wants before deciding to play is whether there is
 * room for them, and that is a comparison — so the slice nobody holds sits on
 * the same bar as the four who do. The numbers are the engine's own, not a
 * summary of them, so this and the first year agree.
 */
function WhoHoldsIt({ rivals, open }: { rivals: Built["market"]["rivals"]; open: number }) {
  if (!rivals.length) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Label>Who already has this market</Label>
        <Text style={{ color: colors.primary, fontSize: font.xs, fontFamily: fontFamily.semibold }}>
          {pct(open)} is open
        </Text>
      </View>

      <View style={{ flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", backgroundColor: colors.border }}>
        {rivals.map((r, i) => (
          <View
            key={r.name}
            style={{ width: `${r.share * 100}%`, backgroundColor: colors.primary, opacity: 0.85 - i * 0.15 }}
          />
        ))}
        <View style={{ flex: 1, backgroundColor: colors.primary, opacity: 0.12 }} />
      </View>

      <View style={{ gap: spacing.sm }}>
        {rivals.map((r) => (
          <View key={r.name} style={{ flexDirection: "row", gap: spacing.md }}>
            <Text style={{ width: 46, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.bold }}>
              {pct(r.share)}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>
                {r.name}
                <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
                  {"  "}{String(r.posture).toUpperCase()}
                </Text>
              </Text>
              <Meta>{r.knock}</Meta>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function FromProjectScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();

  const [projectId, setProjectId] = useState<string | null>(null);
  const [cadence, setCadence] = useState<string>("quarterly");
  const [built, setBuilt] = useState<Built | null>(null);
  /** Which market is being played again, so only that row shows its spinner. */
  const [replaying, setReplaying] = useState<string | null>(null);

  const projects = useQuery({
    queryKey: ["my-projects"],
    queryFn: () => api<ProjectRow[]>("/api/user/projects"),
  });

  const chosen = projectId ?? projects.data?.[0]?.id ?? null;

  /*
   * The project's company, which is also where the markets it already owns
   * are listed. Only asked once a project is chosen — before that there is no
   * question to ask.
   */
  const company = useQuery({
    queryKey: ["project-company", chosen],
    queryFn: () => api<{ company: { id: string; name: string } | null; replayable?: Replayable[] }>(
      `/api/projects/${chosen}/company`,
    ),
    enabled: !!chosen,
  });

  const build = useMutation({
    mutationFn: (fromSeasonId?: string) =>
      api<Built>(`/api/projects/${chosen}/simulation`, {
        method: "POST",
        body: { cadence, ...(fromSeasonId ? { fromSeasonId } : {}) },
      }),
    onSuccess: (b) => {
      setBuilt(b);
      clear();
      // The project has a company now, and a market more than it had.
      qc.invalidateQueries({ queryKey: ["project-company", chosen] });
    },
    onError: (err: any) => show({ tone: "error", text: errText(err, "Couldn't build that. Try again in a moment.") }),
    onSettled: () => setReplaying(null),
  });

  if (projects.isLoading) {
    return (<><Stack.Screen options={{ title: "A season from your project" }} /><Loading label="Finding your projects…" /></>);
  }

  const mine = projects.data ?? [];
  if (!mine.length) {
    return (
      <>
        <Stack.Screen options={{ title: "A season from your project" }} />
        <Screen canvas>
          <Empty
            icon="bulb-outline"
            title="No projects yet"
            body="Nova writes the market from a project — what it sells, who it is for, how far it has got. Start one and this can read it."
            action="Start a project"
            onAction={() => router.push("/project/new" as any)}
          />
        </Screen>
      </>
    );
  }

  /* ── What Nova just wrote, read before anybody plays it. ── */
  if (built) {
    const m = built.market;
    const opening = money(built.openingCash, built.currency);
    return (
      <>
        <Stack.Screen options={{ title: m.name }} />
        <Screen canvas>
          <NoticeBanner notice={notice} onDismiss={clear} />

          <Card>
            <View style={{ gap: spacing.md }}>
              <View style={{ gap: 4 }}>
                <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold }}>{m.name}</Text>
                <Meta>
                  {m.written ? "Written for you" : "The closest market we had"}
                  {built.replayed ? " · played again, free" : ""}
                </Meta>
              </View>

              <Body>{m.premise}</Body>

              {built.fellBack ? (
                <Body style={{ color: colors.warning }}>
                  Nova couldn't write a market for this one, so this is the nearest of ours. It plays properly — it just isn't yours.
                </Body>
              ) : null}

              <WhoHoldsIt rivals={m.rivals} open={m.openShare} />

              <View style={{ backgroundColor: colors.canvas, borderRadius: radius.sm, padding: spacing.md, gap: 4 }}>
                <Body>
                  You start with <Text style={{ fontFamily: fontFamily.semibold }}>{opening}</Text> in the bank, and decide once a{" "}
                  <Text style={{ fontFamily: fontFamily.semibold }}>{built.periodName}</Text>.
                </Body>
                <Meta>
                  {built.solo
                    ? "You take a seat and Nova plays the other four, reading this market — so you can begin on your own."
                    : "Five of you take the seats of one company; any seat nobody takes, Nova plays."}
                  {" "}Your seat is included — bringing somebody else is {money(built.seatPriceCents / 100, built.currency)} a seat, once,
                  and it stays with the company for every season after it.
                </Meta>
              </View>

              <Btn
                label="Open the season"
                icon="arrow-forward"
                onPress={() => router.push(`/sim/${built.seasonId}` as any)}
                testID="button-open-season"
              />
              <Btn label="Not now" variant="ghost" onPress={() => setBuilt(null)} />
            </View>
          </Card>

          <Card>
            <Label>Who buys</Label>
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              {m.segments.slice(0, 4).map((seg) => (
                <View key={seg.name}>
                  <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{seg.name}</Text>
                  <Meta>{seg.description}</Meta>
                </View>
              ))}
            </View>
          </Card>
        </Screen>
      </>
    );
  }

  /* ── Choosing a project, a rhythm, and whether this is a market you own. ── */
  const replayable = company.data?.replayable ?? [];

  return (
    <>
      <Stack.Screen options={{ title: "A season from your project" }} />
      <Screen canvas>
        <NoticeBanner notice={notice} onDismiss={clear} />

        <Card>
          <View style={{ gap: spacing.md }}>
            <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>
              Run a season built around your project
            </Text>
            <Body>
              Nova reads what the project is — who it is for, what it sells, how far it has got — and writes the market it is
              actually in: who buys and what they weigh, where they are, and the four companies that already have them.
            </Body>
            <Meta>
              · Four real competitors, with the share each holds and what is left for you.{"\n"}
              · Sized to a business at your stage, so the opening move is one you could actually make.{"\n"}
              · The seats you don't take are played by Nova, reading your market — so you can start alone.
            </Meta>
          </View>
        </Card>

        {mine.length > 1 ? (
          <Card>
            <Label>Which project</Label>
            <View style={{ marginTop: spacing.sm }}>
              <Segments
                options={mine.slice(0, 8).map((p) => ({ value: p.id, label: p.title ?? "Untitled" }))}
                value={chosen ?? ""}
                onChange={(v) => { setProjectId(v); setBuilt(null); }}
              />
            </View>
          </Card>
        ) : null}

        {replayable.length ? (
          <Card>
            <Label>Markets you've already had written</Label>
            <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
              {replayable.map((r) => (
                <View key={r.seasonId} style={{ gap: 6 }}>
                  <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>
                    {r.marketName ?? r.name}
                  </Text>
                  <Meta>
                    {r.rivals.join(" · ") || "Your own market"}
                    {r.plays > 1 ? ` · played ${r.plays} times` : ""}
                  </Meta>
                  {r.lastFinish ? (
                    <Meta>
                      {r.lastFinish.bankrupt
                        ? `Last time: went under in year ${r.lastFinish.year}`
                        : `Last time: ${r.lastFinish.rank > 0 ? `${ordinal(r.lastFinish.rank)} of ${r.lastFinish.field} · ` : ""}`
                          + `${(r.lastFinish.marketShare * 100).toFixed(1)}% of the market · `
                          + `${r.lastFinish.profitable ? "making money" : "not yet profitable"}`}
                    </Meta>
                  ) : null}
                  <Btn
                    label={replaying === r.seasonId ? "Setting it up…" : "Play it again — free"}
                    variant="outline"
                    small
                    loading={replaying === r.seasonId}
                    disabled={build.isPending}
                    onPress={() => { setReplaying(r.seasonId); build.mutate(r.seasonId); }}
                    testID={`button-replay-${r.seasonId}`}
                  />
                </View>
              ))}
              <Meta>
                The same rivals and the same shares, every time. Costs nothing and asks Nova nothing — pick a different
                rhythm below if you want the same market decided more often.
              </Meta>
            </View>
          </Card>
        ) : null}

        <Card>
          <Label>How often you decide</Label>
          <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
            <Segments options={CADENCES as any} value={cadence} onChange={(v) => setCadence(v)} />
            <Meta>{CADENCE_NOTE[cadence]}</Meta>
          </View>
        </Card>

        <Btn
          label={build.isPending && !replaying ? "Nova is building your market…" : "Have Nova Customize my Season"}
          icon="sparkles-outline"
          loading={build.isPending && !replaying}
          disabled={build.isPending || !chosen}
          onPress={() => build.mutate(undefined)}
          testID="button-customize-season"
        />
        <Meta>
          A company gets stood up behind it, named after the project, so you never fill in a form about an organisation
          that doesn't exist yet.
        </Meta>
      </Screen>
    </>
  );
}
