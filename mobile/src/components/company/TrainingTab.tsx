/**
 * Private training seasons — the phone's half of
 * client/src/components/company/training-tab.tsx and simulation-seats.tsx.
 *
 * A company sets up a market simulation for its own people: five of them take
 * the seats of one company and run it for a fortnight. All eleven routes in
 * `server/company-season-routes.ts` had no phone caller, which left the one
 * screen a facilitator actually wants mid-session — who has filed, which table
 * is waiting — on a laptop at the front of the room.
 *
 * Running a session is the clearest case on this whole surface for a phone.
 * The facilitator is walking between tables.
 *
 * ## Seats, and the one thing not offered here
 *
 * Seats are sold two ways on the server: out of the credit balance, and through
 * a Stripe checkout. Only the balance is offered on iOS. Selling a digital good
 * for a card inside an iOS app is against Apple's rules, and the app already
 * draws that line once — `topUpRoute` is "appstore" on iOS and "stripe"
 * everywhere else — so this follows it rather than inventing a second answer.
 * The balance itself is topped up through the App Store there.
 */
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { api } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Btn, Field, Loading, Row, errText, timeAgo } from "../ui";
import { Callout, TitledCard } from "../MoreKit";
import { Pill } from "../nova/Pill";
import { text } from "../more/AdminKit";
import { Sheet, type Notice } from "../Sheet";
import { topUpRoute } from "../Pay";
import { hasPower } from "../../companies";
import { money } from "../../projectData";
import { PERIOD_NAME, type Cadence } from "../sim/period";
import {
  BOT_TEAMS_MAX, SEAT_KINDS, SEAT_PRICE_CENTS, SEASON_MODES,
  canStart, seasonTone, type SeasonMode, type SeasonRow, type SeatKind, type SeatsView,
} from "./seasons";
import { companyKey, type CompanyView } from "./kit";
import { SeasonSheet } from "./SeasonSheet";

export function TrainingTab({ companyId, notify }: { companyId: string; notify: (n: Notice) => void }) {
  const qc = useQueryClient();
  const nav = useRouter();
  const { data: view } = useQuery<CompanyView>({ queryKey: companyKey(companyId) });
  const [making, setMaking] = useState(false);
  const [open, setOpen] = useState<SeasonRow | null>(null);

  const key = ["company-seasons", companyId];
  const seasons = useQuery({
    queryKey: key,
    queryFn: () => api<{ seasons: SeasonRow[] }>(`/api/companies/${companyId}/seasons`),
    /* A facilitator leaves this on screen while the room plays. */
    refetchInterval: 15_000,
  });

  if (!view) return null;
  const mayRun = hasPower(view.me, "run_seasons");
  const rows = seasons.data?.seasons ?? [];

  return (
    <View style={{ gap: spacing.md }}>
      {!mayRun ? (
        <Callout
          icon="eye"
          tone="info"
          body="You can see the company's seasons and join one you have a seat in. Setting one up, inviting people and starting it need the Run training seasons power."
        />
      ) : null}

      {mayRun ? <Seats companyId={companyId} notify={notify} /> : null}

      <TitledCard icon="game-controller" title={`Seasons · ${rows.length}`}>
        <Text style={text.meta}>
          Five people take the five seats of one company in an invented market and run it for a fortnight.
        </Text>
        {seasons.isLoading ? <Loading /> : null}
        {!seasons.isLoading && !rows.length ? <Text style={text.small}>None yet.</Text> : null}
        {rows.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => setOpen(s)}
            testID={`season-${s.id}`}
            style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border, gap: 3 }}
          >
            <Row between center>
              <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }} numberOfLines={1}>{s.name}</Text>
              <Pill label={s.status} tone={seasonTone(s.status)} />
            </Row>
            <Text style={{ color: colors.textTertiary, fontSize: font.xs }}>
              {[
                s.niche.name,
                `${s.players} ${s.players === 1 ? "person" : "people"}`,
                s.bots ? `${s.bots} stand-ins` : null,
                s.rooms ? `${s.roomsReady}/${s.rooms} tables ready` : null,
              ].filter(Boolean).join(" · ")}
            </Text>
            <Text style={{ color: colors.textTertiary, fontSize: font.xs }}>
              {s.status === "running"
                ? `${PERIOD_NAME[(s.cadence ?? "yearly") as Cadence].one} ${s.year} of ${s.totalPeriods}${s.nextTickAt ? ` · next ${timeAgo(s.nextTickAt)}` : ""}`
                : `set up ${timeAgo(s.createdAt)}`}
            </Text>
            {/* The join code, because the next thing a facilitator does is read it out. */}
            {s.inviteCode && canStart(s) ? (
              <Pressable
                testID={`copy-code-${s.id}`}
                onPress={async () => {
                  await Clipboard.setStringAsync(s.joinUrl ?? s.inviteCode!).catch(() => {});
                  notify({ text: "Join link copied", tone: "success" });
                }}
              >
                <Text style={{ color: colors.primary, fontSize: font.xs, fontFamily: fontFamily.semibold }}>
                  Code {s.inviteCode} — tap to copy the link
                </Text>
              </Pressable>
            ) : null}
            {/*
              * The player's own table is a venture, and `app/sim/[id].tsx` is
              * already the room — so this links into the surface another
              * session built rather than drawing a second one.
              */}
            {s.myVentureId ? (
              <Btn
                small
                variant="outline"
                label="Go to my table"
                onPress={() => nav.push(`/sim/${s.myVentureId}`)}
                testID={`my-table-${s.id}`}
              />
            ) : null}
          </Pressable>
        ))}
        {mayRun ? (
          <Row gap={spacing.sm} style={{ marginTop: spacing.sm }}>
            <Btn label="Set one up" onPress={() => setMaking(true)} testID="new-season" />
          </Row>
        ) : null}
      </TitledCard>

      {making ? (
        <NewSeason
          companyId={companyId}
          onClose={() => setMaking(false)}
          onMade={() => { void qc.invalidateQueries({ queryKey: key }); setMaking(false); }}
          notify={notify}
        />
      ) : null}

      {open ? (
        <SeasonSheet
          companyId={companyId}
          season={open}
          mayRun={mayRun}
          members={view.members}
          onClose={() => setOpen(null)}
          onChanged={() => void qc.invalidateQueries({ queryKey: key })}
          notify={notify}
        />
      ) : null}
    </View>
  );
}

/**
 * Seats held, and the two ways to get more.
 *
 * `shortBy` comes off the server and is counted against the whole company,
 * which is the most a season could ever need; the gate at the start line counts
 * who actually sat down, so nobody pays for a colleague who never joined. Both
 * numbers are shown because the difference is the point.
 */
function Seats({ companyId, notify }: { companyId: string; notify: (n: Notice) => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<SeatKind>("play");
  const [count, setCount] = useState("5");

  const key = ["company-seats", companyId];
  const q = useQuery({ queryKey: key, queryFn: () => api<SeatsView>(`/api/companies/${companyId}/simulation-seats`) });

  const buy = useMutation({
    mutationFn: () => api(`/api/companies/${companyId}/simulation-seats/buy`, {
      method: "POST",
      body: { kind, seats: Math.max(1, Number(count) || 1) },
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: key }); notify({ text: "Seats added", tone: "success" }); },
    /* The server says what the balance is short by, which is the actionable half. */
    onError: (e) => notify({ text: errText(e, "Couldn't buy those seats."), tone: "error" }),
  });

  const checkout = useMutation({
    mutationFn: () => api<{ url: string }>(`/api/companies/${companyId}/simulation-seats/checkout`, {
      method: "POST",
      body: { kind, seats: Math.max(1, Number(count) || 1) },
    }),
    onSuccess: async (r) => { if (r.url) await WebBrowser.openBrowserAsync(r.url); },
    onError: (e) => notify({ text: errText(e, "Couldn't start that checkout."), tone: "error" }),
  });

  const held = q.data?.seats.find((s) => s.kind === kind);

  return (
    <TitledCard icon="ticket" title="Seats">
      <Text style={text.meta}>
        A seat is one person at a table for the life of a season. Bought once, not monthly — a company that runs one
        away day a year should not pay for the eleven months between.
      </Text>
      {q.isLoading ? <Loading /> : null}
      {q.data ? (
        <>
          <Row gap={6} wrap>
            {SEAT_KINDS.filter((k) => k === "play" || k === "nova").map((k) => (
              <Pressable
                key={k}
                onPress={() => setKind(k)}
                testID={`seat-kind-${k}`}
                style={{
                  paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1,
                  borderColor: kind === k ? colors.primary : colors.border,
                  backgroundColor: kind === k ? colors.primarySoft : "transparent",
                }}
              >
                <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: kind === k ? colors.primary : colors.textSecondary }}>
                  {k === "nova" ? "Built by Nova" : "One of our markets"} · {money(SEAT_PRICE_CENTS[k])}
                </Text>
              </Pressable>
            ))}
          </Row>
          <Text style={text.small}>
            {held?.paid ?? 0} paid for. {q.data.people} {q.data.people === 1 ? "person" : "people"} in the company
            {held?.shortBy ? `, so seating everyone would need ${held.shortBy} more.` : " — enough for everyone."}
          </Text>
          <Field label="How many to add" value={count} onChangeText={setCount} numeric testID="seat-count" />
          <Row gap={spacing.sm}>
            <Btn
              label={`Buy from the balance · ${money(SEAT_PRICE_CENTS[kind] * Math.max(1, Number(count) || 1))}`}
              loading={buy.isPending}
              onPress={() => buy.mutate()}
              testID="buy-seats"
            />
          </Row>
          {/*
            * The card route, and only where a card is allowed. On iOS this is
            * absent by design: Apple requires digital goods to go through the
            * App Store, which is how the balance above is topped up there.
            */}
          {topUpRoute === "stripe" ? (
            <Btn
              small
              variant="ghost"
              label="Pay by card instead"
              loading={checkout.isPending}
              onPress={() => checkout.mutate()}
              testID="checkout-seats"
            />
          ) : null}
        </>
      ) : null}
    </TitledCard>
  );
}

/**
 * Setting one up.
 *
 * Two ways: one of our markets, or Nova builds a market from the company's own
 * project. They are different routes and different seat prices, so they are
 * one sheet with a choice rather than two buttons that look alike.
 */
function NewSeason({
  companyId, onClose, onMade, notify,
}: {
  companyId: string; onClose: () => void; onMade: () => void; notify: (n: Notice) => void;
}) {
  const [built, setBuilt] = useState<"ours" | "nova">("ours");
  const [nicheId, setNicheId] = useState<string | null>(null);
  const [cadence, setCadence] = useState<Cadence>("yearly");
  const [mode, setMode] = useState<SeasonMode>("team");
  const [name, setName] = useState("");
  const [botTeams, setBotTeams] = useState("0");
  const [brief, setBrief] = useState("");

  const niches = useQuery({
    queryKey: ["sim-niches"],
    queryFn: () => api<{ niches: { id: string; name: string; blurb?: string }[] }>("/api/sim/niches"),
    staleTime: 10 * 60_000,
  });

  const create = useMutation({
    mutationFn: () => api(`/api/companies/${companyId}/seasons`, {
      method: "POST",
      body: {
        nicheId, cadence, mode,
        name: name.trim() || undefined,
        botTeams: Math.max(0, Math.min(BOT_TEAMS_MAX, Number(botTeams) || 0)),
      },
    }),
    onSuccess: () => { notify({ text: "Season set up. Read the code out.", tone: "success" }); onMade(); },
    onError: (e) => notify({ text: errText(e, "Couldn't set that up."), tone: "error" }),
  });

  const novaBuild = useMutation({
    mutationFn: () => api(`/api/companies/${companyId}/seasons/nova`, {
      method: "POST",
      body: { brief: brief.trim(), cadence, mode, name: name.trim() || undefined },
    }),
    onSuccess: () => { notify({ text: "Nova is building the market.", tone: "success" }); onMade(); },
    /* A 402 here is the dearer seat not being paid for; the server says which. */
    onError: (e) => notify({ text: errText(e, "Couldn't ask Nova for that."), tone: "error" }),
  });

  return (
    <Sheet visible onClose={onClose} title="A training season" subtitle="For the company's own people">
      <View style={{ gap: spacing.sm }}>
        <Row gap={6}>
          {(["ours", "nova"] as const).map((b) => (
            <Pressable
              key={b}
              onPress={() => setBuilt(b)}
              testID={`season-built-${b}`}
              style={{
                paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1,
                borderColor: built === b ? colors.primary : colors.border,
                backgroundColor: built === b ? colors.primarySoft : "transparent",
              }}
            >
              <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: built === b ? colors.primary : colors.textSecondary }}>
                {b === "ours" ? "One of our markets" : "Nova builds one"}
              </Text>
            </Pressable>
          ))}
        </Row>

        {built === "ours" ? (
          <>
            {niches.isLoading ? <Loading /> : null}
            <Text style={text.small}>The market they will compete in.</Text>
            <View style={{ gap: 4 }}>
              {(niches.data?.niches ?? []).map((n) => (
                <Pressable
                  key={n.id}
                  onPress={() => setNicheId(n.id)}
                  testID={`niche-${n.id}`}
                  style={{
                    padding: spacing.sm, borderRadius: radius.sm, borderWidth: 1,
                    borderColor: nicheId === n.id ? colors.primary : colors.border,
                    backgroundColor: nicheId === n.id ? colors.primarySoft : "transparent",
                  }}
                >
                  <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }}>{n.name}</Text>
                  {n.blurb ? <Text style={{ color: colors.textTertiary, fontSize: font.xs }} numberOfLines={2}>{n.blurb}</Text> : null}
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <Field
            label="What the market should be"
            value={brief}
            onChangeText={setBrief}
            multiline
            placeholder="The business your company is actually in, in a sentence or two."
            testID="nova-brief"
          />
        )}

        <Text style={text.small}>How often the table decides.</Text>
        <Row gap={6} wrap>
          {(["yearly", "quarterly", "monthly"] as Cadence[]).map((c) => (
            <Pressable
              key={c}
              onPress={() => setCadence(c)}
              testID={`cadence-${c}`}
              style={{
                paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1,
                borderColor: cadence === c ? colors.primary : colors.border,
                backgroundColor: cadence === c ? colors.primarySoft : "transparent",
              }}
            >
              <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: cadence === c ? colors.primary : colors.textSecondary }}>
                by the {PERIOD_NAME[c].one}
              </Text>
            </Pressable>
          ))}
        </Row>

        <Text style={text.small}>One table of five, or a table each.</Text>
        <Row gap={6}>
          {SEASON_MODES.map((m) => (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              testID={`season-mode-${m}`}
              style={{
                paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1,
                borderColor: mode === m ? colors.primary : colors.border,
                backgroundColor: mode === m ? colors.primarySoft : "transparent",
              }}
            >
              <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: mode === m ? colors.primary : colors.textSecondary }}>
                {m === "team" ? "Tables of five" : "A table each"}
              </Text>
            </Pressable>
          ))}
        </Row>

        <Field label="Name it (optional)" value={name} onChangeText={setName} maxLength={80} placeholder="Leadership away day" testID="season-name" />
        <Field label="Companies of stand-ins to compete against" value={botTeams} onChangeText={setBotTeams} numeric testID="season-bots" />
        <Text style={text.small}>Up to {BOT_TEAMS_MAX}. Stand-ins are not people and are not charged for.</Text>

        {built === "ours" ? (
          <Btn label="Set it up" loading={create.isPending} disabled={!nicheId} onPress={() => create.mutate()} testID="create-season" />
        ) : (
          <Btn label="Ask Nova to build it" loading={novaBuild.isPending} disabled={brief.trim().length < 10} onPress={() => novaBuild.mutate()} testID="create-nova-season" />
        )}
      </View>
    </Sheet>
  );
}
