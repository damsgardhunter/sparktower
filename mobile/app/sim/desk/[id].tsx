import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../../src/theme";
import { Btn, Card, Empty, Icon, Loading, Screen, errText } from "../../../src/components/ui";
import { Callout, Pill, isSwitchedOff } from "../../../src/components/MoreKit";
import { NoticeBanner, useNotice } from "../../../src/components/Sheet";
import { SimSectionTitle } from "../../../src/components/sim/SimKit";
import {
  ChallengeCard, ChoiceField, CitiesField, CommitmentMeter, DeskBanner, DilutionNote,
  DistressCard, EconomyStrip, EventCard, FiledRow, LastChallengeCard, NumberField,
  PipelineNote, ReportCard, RivalRow, ScoreBar, Stat,
} from "../../../src/components/sim/DeskKit";
import { MarketResultCard } from "../../../src/components/sim/MarketKit";
import { marketNotesRead } from "../../../src/components/sim/market";
import { ROOM_POLL_MS, useDesk } from "../../../src/components/sim/useSim";
import {
  ROLE_ORDER, challengeProgress, challengeStanding, commitment, discretionarySpend,
  draftMatches, exact, formatUntil, inTrouble, money, reachOf, reachRead, secondsUntil,
  shareOwnedRead, tableStatus, validateDraft, validateRecovery, withYourDraft,
  type DeskDistress, type DeskRole, type FileDecisionResult, type RecoveryKind,
} from "../../../src/components/sim/desk";

/**
 * The desk: one seat's day, in the order a person actually wants it.
 *
 * Four things about this screen are deliberate and easy to undo by accident.
 *
 * **Last year comes before this year.** Somebody opens this on the way to work
 * to find out how yesterday went. Putting the form first would make them
 * scroll past their own decision to find the result of the last one, and then
 * scroll back up having forgotten it.
 *
 * **The table's commitment is the loudest thing here.** Not because it is the
 * most interesting number — the report is — but because it is the only one no
 * individual seat could work out alone, and the only one whose absence
 * bankrupts the company quietly. See the long comment at the top of
 * shared/simulation/levers.ts for the failure it exists to prevent.
 *
 * **That total is recomputed on this phone as you type.** The server's
 * `preview` is authoritative and arrives on the next poll; but a number that
 * only updates after you file is a number that cannot change your mind, which
 * was the entire point of showing it. src/components/sim/desk.ts mirrors the
 * engine's arithmetic, and desk.test.ts is what keeps the mirror honest.
 *
 * **Nothing here is optimistic.** A decision that appears filed and wasn't is
 * how a team discovers on the tick that the CFO's year never existed. The
 * button waits, and the server's field errors land under the fields that
 * caused them.
 */
export default function Desk() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();

  const { data, isLoading, error, refetch, isRefetching } = useDesk(id);

  const [draft, setDraft] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  /*
   * Seed the form from the server once per year, and only once.
   *
   * The desk re-polls every couple of seconds; a form that re-seeded on every
   * response would eat what you were typing. But when the tick rolls the year
   * over underneath the screen, the old draft belongs to a year that has
   * already resolved — so the year, not the response, is what re-seeds it.
   */
  const seededYear = useRef<number | null>(null);
  useEffect(() => {
    if (!data || data.phase !== "running" || data.year == null) return;
    if (seededYear.current === data.year) return;
    seededYear.current = data.year;
    setDraft({ ...(data.draft ?? {}) });
    setErrors({});
  }, [data?.year, data?.phase]);

  // One re-render a second so the countdown moves; the value itself is derived
  // from Date.now() at render, so a poll or a keystroke shows the right number
  // rather than whatever the last tick left behind.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!data?.resolvesAt) return;
    const timer = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, [data?.resolvesAt]);

  /*
   * A field the server rejected stops being rejected the moment it's touched.
   * The message belongs to the value that caused it, and leaving it under a
   * number that has since changed is how a form looks broken.
   */
  const clearFieldError = (fieldId: string) =>
    setErrors((current) => {
      if (!(fieldId in current)) return current;
      const next = { ...current };
      delete next[fieldId];
      return next;
    });

  const file = useMutation({
    mutationFn: () => api<FileDecisionResult>(`/api/sim/ventures/${id}/decisions`, { method: "POST", body: { decision: draft } }),
    onSuccess: (result) => {
      // The server cleans the payload (numbers coerced, fields this seat
      // doesn't own dropped), so the form takes its answer back rather than
      // keeping the strings it was holding.
      setDraft({ ...result.draft });
      setErrors({});
      show({ tone: "success", text: "Filed. You can still change it until the tick." });
      void qc.invalidateQueries({ queryKey: ["sim-desk", id] });
    },
    onError: (err: any) => {
      const fieldErrors = err?.body?.errors;
      if (err?.status === 400 && fieldErrors && typeof fieldErrors === "object") {
        setErrors(fieldErrors);
        show({ tone: "error", text: errText(err, "Some of that doesn't add up.") });
        return;
      }
      // 409 is the season having moved — finished, or ticked while the screen
      // was open — which is news rather than a failure of theirs.
      const moved = err?.status === 409;
      show({ tone: moved ? "info" : "error", text: errText(err, "Couldn't file that. Try again.") });
      if (moved) void qc.invalidateQueries({ queryKey: ["sim-desk", id] });
    },
  });

  /*
   * The recovery move the chief executive is considering.
   *
   * Seeded from what is already filed, once, and then left alone: the desk
   * re-polls every couple of seconds, and a picker that re-seeded on every
   * response would drag somebody's half-made choice back to the committed one
   * while they were still reading the costs. `null` means "nothing filed and
   * nothing chosen", which is a different state from "the filed one".
   */
  const [recoveryKind, setRecoveryKind] = useState<RecoveryKind | null>(null);
  const [recoverySeat, setRecoverySeat] = useState<DeskRole | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const seededRecovery = useRef<string | null>(null);

  useEffect(() => {
    const filed = data?.distress?.filed ?? null;
    const key = `${data?.year ?? ""}:${filed?.kind ?? ""}:${filed?.seat ?? ""}`;
    if (seededRecovery.current === key) return;
    seededRecovery.current = key;
    setRecoveryKind(filed?.kind ?? null);
    setRecoverySeat((filed?.seat as DeskRole | null) ?? null);
    setRecoveryError(null);
  }, [data?.year, data?.distress?.filed?.kind, data?.distress?.filed?.seat]);

  const recovery = useMutation({
    mutationFn: (body: { kind: RecoveryKind; seat?: string }) =>
      api(`/api/sim/ventures/${id}/recovery`, { method: "POST", body }),
    onSuccess: () => {
      setRecoveryError(null);
      show({ tone: "success", text: "Committed. It takes effect before next year runs, and you can change it until the tick." });
      void qc.invalidateQueries({ queryKey: ["sim-desk", id] });
    },
    onError: (err: any) => {
      // 403 not_ceo and 409 not_available are both the server saying something
      // true about the position, so they are shown where the choice was made
      // rather than as a transient banner that scrolls away with the reason.
      setRecoveryError(errText(err, "Couldn't commit to that."));
      show({ tone: "error", text: errText(err, "Couldn't commit to that.") });
      if (err?.status === 409) void qc.invalidateQueries({ queryKey: ["sim-desk", id] });
    },
  });

  const clearRecovery = useMutation({
    mutationFn: () => api(`/api/sim/ventures/${id}/recovery`, { method: "DELETE" }),
    onSuccess: () => {
      setRecoveryKind(null);
      setRecoverySeat(null);
      setRecoveryError(null);
      seededRecovery.current = null;
      show({ tone: "info", text: "Cleared. Nothing is committed for this year." });
      void qc.invalidateQueries({ queryKey: ["sim-desk", id] });
    },
    onError: (err: any) => show({ tone: "error", text: errText(err, "Couldn't clear that.") }),
  });

  const fields = data?.fields ?? [];
  const company = data?.company;
  const economy = data?.economy;

  /**
   * The table's position, with your unsaved edits standing in for your seat.
   *
   * Wrapped, and falling back to the server's own `preview.commitment` if the
   * mirror throws. A live total is a nicety; the desk is the screen a player
   * opens to find out how their company is doing, and a white screen because
   * one field of the payload changed shape is not a trade worth making. The
   * web app already lost this argument once — `company.seats` arrived later
   * than the code that read it, and `fixedCosts` took the whole screen down.
   * A stale-by-one-poll number is a bad day; a blank screen is a bug report.
   */
  const live = useMemo(() => {
    if (!company || !economy || !data?.preview) return null;
    try {
      return commitment({
        company,
        decisions: withYourDraft(data.filed, data.yourRole, data.yourRole ? draft : null),
        costIndex: economy.costIndex,
        /*
         * The cities the company is *already* open in, not the ones this
         * year's draft would open. The engine charges the fixed bill against
         * the footprint it had when the year began — opening somewhere costs
         * its entry fee now and raises the base from next year — so a preview
         * that used the draft's selection would show the table a bill it has
         * not been sent yet.
         */
        reach: reachOf(data.cities),
        /*
         * And the map itself, so the cost of opening somewhere lands on the
         * marketing seat's line as it does on the server. It is the largest
         * single movement of cash this table can make, and it used to be the
         * only one the meter never mentioned.
         */
        cities: data.cities,
      });
    } catch {
      return null;
    }
  }, [company, economy, data?.preview, data?.filed, data?.yourRole, data?.cities, draft]);

  const localCheck = useMemo(
    () => (company ? validateDraft(fields, draft, company, data?.yourRole ?? null) : { ok: true, errors: {} }),
    [fields, draft, company, data?.yourRole],
  );

  if (isLoading) {
    return (<><Stack.Screen options={{ title: "Your desk" }} /><Loading label="Opening the desk…" /></>);
  }

  if (error || !data) {
    const gone = (error as any)?.status === 404;
    return (
      <>
        <Stack.Screen options={{ title: "Your desk" }} />
        <Screen canvas>
          {gone ? (
            <Empty icon="lock-closed-outline" title="This desk isn't yours"
              body="It either doesn't exist or you're not at that table."
              action="Pick a market" onAction={() => router.replace("/sim")} />
          ) : isSwitchedOff(error) ? (
            <Empty icon="pause-circle-outline" title="Simulations are paused"
              body="The market simulation is switched off right now." />
          ) : (
            <Empty icon="cloud-offline-outline" title="Lost the desk"
              body={errText(error)} action="Try again" onAction={() => refetch()} />
          )}
        </Screen>
      </>
    );
  }

  const title = data.name || data.niche?.name || "Your desk";

  /*
   * A season that hasn't started has a seat and nothing to decide with it.
   * The response is deliberately near-empty in this state (see the early
   * return in server/simulation-desk-routes.ts), so this branch cannot reach
   * for company, economy or fields — every one of them is absent.
   */
  if (data.phase === "not_started") {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <Screen canvas>
          <Card accent={colors.info}>
            <SimSectionTitle icon="hourglass" title="Year one hasn't started" color={colors.info} />
            <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular }}>
              The table is still filling. Once the season opens, this is where you'll file a decision each day — one real day is
              one year of trading, and the year resolves for all five of you at once.
            </Text>
            {data.yourRole ? (
              <Pill label={`Your seat: ${data.yourRole.toUpperCase()}`} icon="ribbon-outline" color={colors.primary} />
            ) : null}
            <Btn label="Back to the room" icon="arrow-back" variant="outline" onPress={() => router.replace(`/sim/${id}`)} testID="desk-back-to-room" />
          </Card>
        </Screen>
      </>
    );
  }

  const finished = data.phase === "finished";
  const seconds = secondsUntil(data.resolvesAt, Date.now());
  const preview = data.preview;
  const filedBySeat = new Map((live ?? preview?.commitment)?.bySeat.map((s) => [s.role, s.spend]) ?? []);
  const titleOf = (role: string) =>
    data.table?.find((s) => s.role === role)?.title ?? role.toUpperCase();

  /*
   * The three things the year is about besides the levers: your own objective,
   * the money the covenant cares about, and how much trouble the company is in.
   *
   * `committedSpend` is the live discretionary sum — the same number the
   * commitment meter is drawing — so a "without spending your way there"
   * target and a creditor's cap both answer to what is being typed right now
   * rather than to what was filed an hour ago.
   */
  const distress: DeskDistress | undefined = data.distress;
  const committed = live ?? preview?.commitment ?? null;
  /*
   * The capped spend is its own sum, not a slice of the meter.
   *
   * The meter counts two things a creditor's cap and a challenge target both
   * ignore: the fee for opening a city, which the engine takes out of cash,
   * and research, which buys nothing this year. Reading the cap off the meter
   * would tell a table it had broken a ceiling it was nowhere near — see
   * discretionarySpend() in desk.ts, which mirrors the engine's two sums.
   */
  const committedSpend = discretionarySpend(
    withYourDraft(data.filed, data.yourRole, data.yourRole ? draft : null),
  );

  /*
   * Last year's market outcomes, as the report carries them.
   *
   * Their own field rather than a slice of `notes`: the one line somebody has
   * been waiting a day for shouldn't read as a footnote among the year's other
   * prose, and each outcome arrives with its own `kind` so nothing here has to
   * work out from a sentence whether it was good news. Absent on a year with
   * no bids, in which case the card simply isn't there.
   */
  const marketNews = data.lastYear?.market ?? [];

  const challenge = data.challenge ?? null;
  const progress = challenge ? challengeProgress(challenge, { company: company ?? null, committedSpend }) : [];
  const standing = challenge ? challengeStanding(progress).line : null;

  const recoveryCheck = validateRecovery({
    kind: recoveryKind,
    seat: recoverySeat,
    options: distress?.options ?? [],
    seats: company?.seats,
    role: data.yourRole,
  });

  /** The state is worth putting above the year's results only when it's the year's news. */
  const severeTrouble = distress?.level === "distressed" || distress?.level === "insolvent";

  const distressCard = distress && inTrouble(distress.level) ? (
    <DistressCard
      distress={distress}
      yourRole={data.yourRole}
      seats={company?.seats}
      spend={committedSpend}
      chosen={recoveryKind}
      chosenSeat={recoverySeat}
      onChoose={(kind) => {
        setRecoveryKind(kind);
        setRecoveryError(null);
        // A move that doesn't take a seat shouldn't quietly carry one into the
        // request, where the server would ignore it and the screen would keep
        // showing it as part of the choice.
        if (kind !== "dissolve_seat") setRecoverySeat(null);
      }}
      onChooseSeat={(seat) => { setRecoverySeat(seat); setRecoveryError(null); }}
      onFile={() => {
        if (!recoveryCheck.ok || !recoveryKind) { setRecoveryError(recoveryCheck.error); return; }
        recovery.mutate(recoverySeat ? { kind: recoveryKind, seat: recoverySeat } : { kind: recoveryKind });
      }}
      onClear={() => clearRecovery.mutate()}
      filing={recovery.isPending || clearRecovery.isPending}
      error={recoveryError ?? (recoveryKind ? recoveryCheck.error : null)}
    />
  ) : null;

  const dirty = !draftMatches(data.yourRole ? (data.filed?.[data.yourRole] ?? null) : null, draft);
  const canFile = !finished && !!data.yourRole && localCheck.ok && !file.isPending;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Screen canvas onRefresh={refetch} refreshing={isRefetching}>
          <DeskBanner
            company={data.name || "Your company"}
            product={data.product ?? null}
            year={data.year ?? 1}
            totalYears={data.totalYears ?? 14}
            title={data.yourTitle ?? null}
            seconds={seconds}
            submitted={!!data.submitted}
            finished={finished}
          />

          {finished && (
            <Callout
              icon="flag-outline"
              tone="info"
              title="The season is over"
              body="Nothing left to file. What's below is where the company finished and the last year that ran."
            />
          )}

          {/* A company in real trouble is told before it is told anything else:
              at this point "how did last year go" is a less useful question
              than "how much runway is there", and the answer changes every
              number below it. A merely stretched company gets the same card
              lower down, beside the money it applies to. */}
          {severeTrouble ? distressCard : null}

          {/* 1. The year something happened, above the figures it explains.
              A season where nothing ever happens is one people stop opening on
              about day five, and when an event does land it is the most
              interesting thing on this screen. Typed, so nothing here has to
              recognise a sentence — and deliberately not removed from the
              report's notes below, because matching prose in order to dedupe
              is the same fragile trick in the other direction. */}
          {data.lastYear?.event ? (
            <EventCard event={data.lastYear.event} year={data.lastYear.year} />
          ) : null}

          {/* 1a. What happened to the company. Before anything about what to do next. */}
          {data.lastYear ? (
            <ReportCard report={data.lastYear} />
          ) : (
            <Card style={{ borderStyle: "dashed" }}>
              <SimSectionTitle icon="newspaper-outline" title="No results yet" color={colors.textTertiary} />
              <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
                This is year one — nothing has resolved yet. Whatever the five of you file today becomes the first year on the
                record, and tomorrow this is where it'll be.
              </Text>
            </Card>
          )}

          {/* 1a. What the bids you filed a day ago actually did. Directly under
              the report, because it is the other half of a mechanic that is
              deliberately silent until it settles. */}
          {marketNews.length > 0 ? (
            <MarketResultCard
              market={marketNews}
              summary={marketNotesRead(marketNews)}
              onOpen={() => router.push(`/sim/market/${id}`)}
            />
          ) : null}

          {/* 1b. How your own year went, and what this one asks of you.
              Directly under the company's report because that is the order the
              question arrives in: the team's year, then mine. */}
          {data.lastChallenge ? <LastChallengeCard result={data.lastChallenge} /> : null}

          {challenge ? (
            <ChallengeCard
              challenge={challenge}
              progress={progress}
              standing={standing}
              seatTitle={data.yourTitle ?? data.yourRole?.toUpperCase() ?? null}
            />
          ) : null}

          {/* 2. Where the company stands. */}
          {company && (
            <Card>
              <SimSectionTitle icon="business" title="Where the company stands" />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
                <Stat label="Cash" value={money(company.cash)} tone={company.cash <= 0 ? colors.danger : colors.success} />
                <Stat label="Debt" value={money(company.debt)} hint={`${money(Math.max(0, company.creditLimit - company.debt))} still borrowable`}
                  tone={company.debt >= company.creditLimit ? colors.danger : undefined} />
                <Stat label="Customers" value={money(company.customers)} hint={`${money(company.capacity)} of capacity`}
                  tone={company.customers > company.capacity ? colors.danger : undefined} />
                <Stat label="Price" value={exact(company.price)} hint={`${exact(company.unitCost)} to make`}
                  tone={company.price <= company.unitCost ? colors.danger : undefined} />
                {/* What the five of them own. Beside the cash rather than in a
                    footnote: it is what the league table is ordered by, it only
                    ever goes down, and the day it moves is the day somebody
                    filed a raise. */}
                <Stat label="Founders own" value={shareOwnedRead(company.founderShare ?? 1)}
                  hint={(company.founderShare ?? 1) >= 0.999 ? "All of it, still" : "The rest belongs to investors"}
                  tone={(company.founderShare ?? 1) < 0.5 ? colors.warning : undefined} />
                {/* Research that has already been paid for. Shown even at zero
                    for the seat that can move it, because "nothing is coming"
                    is the fact that makes the lever worth pulling. */}
                <Stat label="Landing next year" value={company.pipeline ? `+${company.pipeline}` : "Nothing"}
                  hint={company.pipeline ? "Quality already bought and waiting" : "No research in the pipeline"}
                  tone={company.pipeline ? colors.info : undefined} />
              </View>

              {/* The ceiling on everything below it: a company can only be
                  chosen by people in a city it has opened, so a brilliant
                  product at 30% reach is a brilliant product 70% of this
                  market will never see. */}
              {data.cities && data.cities.length > 0 ? (
                <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
                  <Icon name="map-outline" size={14} color={colors.info} />
                  <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
                    {reachRead(reachOf(data.cities))}{" "}
                    Open in {data.cities.filter((c) => c.open).length} of {data.cities.length} places.
                  </Text>
                </View>
              ) : null}

              {/* Who the company has declared itself for, which changes what
                  every other number means. Named rather than left implicit:
                  four seats are spending money inside this decision. */}
              {company.positioning ? (
                <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
                  <Icon name="flag-outline" size={14} color={colors.novaPurple} />
                  <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
                    Positioned for {data.segments?.find((seg) => seg.id === company.positioning)?.name ?? company.positioning} — more
                    appealing to them, slightly less to everybody else.
                  </Text>
                </View>
              ) : null}

              <View style={{ gap: spacing.sm, paddingTop: spacing.xs }}>
                <ScoreBar label="Reputation" value={company.reputation} color={colors.primary}
                  hint="What the market thinks of you, and what decides your credit limit." />
                <ScoreBar label="Quality" value={company.quality} color={colors.info}
                  hint="What the product is. Worth nothing until people have heard of it." />
                <ScoreBar label="Brand" value={company.brand} color={colors.novaPurple}
                  hint="Whether they've heard of it." />
                <ScoreBar label="Service" value={company.service} color={colors.novaEmerald}
                  hint="What happens after they buy." />
              </View>

              {company.customers > company.capacity ? (
                <Callout
                  icon="warning"
                  tone="warn"
                  title="You're over capacity"
                  body="More people want you than you can serve. The ones turned away cost reputation as well as revenue."
                />
              ) : null}
              {company.bankruptSince != null ? (
                <Callout
                  icon="alert-circle"
                  tone="danger"
                  title={`Insolvent since year ${company.bankruptSince}`}
                  body="The company is trading on credit it can't service. Repaying and cutting is the only way back."
                />
              ) : null}

              {economy ? <EconomyStrip economy={economy} /> : null}
            </Card>
          )}

          {/* Stretched, rather than sinking: the moves are cheap now and
              expensive later, which is a thing to read next to the money
              rather than at the top of the screen. */}
          {!severeTrouble ? distressCard : null}

          {/* The market. A link rather than a section: bidding is a decision
              with its own screen, and it is the one place a company in trouble
              can turn what it owns into the cash the card above is about. */}
          <Card onPress={() => router.push(`/sim/market/${id}`)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <Icon name="storefront" size={20} color={colors.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>The market</Text>
                <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
                  What's for sale this year, what you own, and what you've bid. Bids are sealed and settle on the tick.
                </Text>
              </View>
              <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
            </View>
          </Card>

          {/* Where everybody stands, and who could be bought. Links rather
              than sections, for the same reason the market is one: both are
              decisions with their own screen, and both answer a question the
              desk structurally cannot — whether the year was any good, and
              what this company is worth to somebody else. */}
          <Card onPress={() => router.push(`/sim/standings/${id}`)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <Icon name="podium" size={20} color={colors.info} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>Standings</Text>
                <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
                  Every team and every incumbent in one table, and the shape of your season year by year.
                </Text>
              </View>
              <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
            </View>
          </Card>

          <Card onPress={() => router.push(`/sim/offers/${id}`)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <Icon name="briefcase" size={20} color={colors.novaPurple} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>Acquisitions</Text>
                <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
                  What every company is worth, offers on your table, and who you could buy. Nobody is bought without agreeing to it.
                </Text>
              </View>
              <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
            </View>
          </Card>

          {/* 3 & 4. The table's money, then your levers. The total sits above the
              form on purpose: it is the context every number below it changes. */}
          {live || preview ? (
            <CommitmentMeter commitment={live ?? preview!.commitment} live={!!live && dirty} titleOf={titleOf} />
          ) : null}

          {/* 5. The server's warnings, loud; its notes, as advice. */}
          {preview?.warnings.map((warning, i) => (
            <Callout key={`warn-${i}`} icon="warning" tone="danger" body={warning} />
          ))}

          {preview && preview.notes.length > 0 && (
            <Card accent={colors.info}>
              <SimSectionTitle icon="git-compare" title="How your decisions collide" color={colors.info} />
              <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
                What the five of you are doing to each other, said before the year runs rather than after it.
              </Text>
              {preview.notes.map((note, i) => (
                <View key={`note-${i}`} style={{ flexDirection: "row", gap: 6 }}>
                  <Icon name="arrow-forward" size={13} color={colors.info} />
                  <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
                    {note}
                  </Text>
                </View>
              ))}
            </Card>
          )}

          {/* Your levers. */}
          {!data.yourRole ? (
            <Card style={{ borderStyle: "dashed" }}>
              <Empty icon="person-outline" title="You don't hold a seat"
                body="You're at this table but without a role, so there's nothing for you to file. The room is where seats are settled."
                action="Back to the room" onAction={() => router.replace(`/sim/${id}`)} />
            </Card>
          ) : fields.length === 0 ? (
            <Card style={{ borderStyle: "dashed" }}>
              <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
                This seat has no levers this year.
              </Text>
            </Card>
          ) : (
            <Card accent={colors.primary}>
              <SimSectionTitle icon="options" title={`Your levers · ${data.yourTitle ?? data.yourRole.toUpperCase()}`} />
              {(data.yourLevers ?? []).length > 0 && (
                <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
                  {(data.yourLevers ?? []).join(" · ")}
                </Text>
              )}

              {/* The chief executive spends nothing and decides the most.
                  Worth saying outright, because a seat whose controls are all
                  qualitative reads as decorative next to four seats moving
                  millions. Focus multiplies what everyone else's money buys
                  (FOCUS_EFFECTS in shared/simulation/decisions.ts) and
                  positioning decides who all of it is aimed at. */}
              {data.yourRole === "ceo" && (
                <Callout
                  icon="flash"
                  tone="info"
                  title="You spend nothing and move everything"
                  body="Focus multiplies what everyone else's money buys — how far marketing reaches, how fast the product improves, what a unit costs. Positioning decides who all of that is aimed at: naming a segment makes the company markedly more appealing to those people and slightly less to everyone else, and the other four then have to work inside your answer."
                />
              )}

              <View style={{ gap: spacing.lg, paddingTop: spacing.xs }}>
                {fields.map((field) => {
                  // The server's message wins while it stands: it is the one
                  // that actually refused the submission.
                  const message = errors[field.id] || localCheck.errors[field.id];
                  const change = (next: any) => {
                    setDraft((d) => ({ ...d, [field.id]: next }));
                    clearFieldError(field.id);
                  };
                  const disabled = finished || file.isPending;

                  /*
                   * Where the company sells. Its own control rather than a row
                   * of pills: every other lever is a multiplier and this one is
                   * the gate — nobody outside an open city can choose this
                   * company at all — and the two costs it carries (a fee now, a
                   * higher fixed base for ever) both need saying where the
                   * decision is made.
                   */
                  if (field.kind === "cities") {
                    return (
                      <CitiesField
                        key={field.id}
                        field={field}
                        cities={data.cities}
                        value={draft[field.id]}
                        error={message}
                        disabled={disabled}
                        onChange={change}
                      />
                    );
                  }

                  /*
                   * Positioning and rehiring are both single-select lists the
                   * server fills in, so they take the same control as focus.
                   * The value is normalised to "" because "for everybody" is a
                   * real answer with an empty value, and an undefined draft
                   * would leave that option looking unchosen when it is what
                   * the company is currently doing.
                   */
                  if (field.kind === "choice" || field.kind === "segment") {
                    return (
                      <ChoiceField
                        key={field.id}
                        field={field}
                        value={draft[field.id] ?? (field.kind === "segment" ? "" : undefined)}
                        error={message}
                        disabled={disabled}
                        emptyNote={field.id === "rehire"
                          ? "Every seat is filled, so there is nobody to bring back. This only has something in it after a seat has been dissolved in a bad year."
                          : undefined}
                        onChange={change}
                      />
                    );
                  }

                  return (
                    <View key={field.id} style={{ gap: 6 }}>
                      <NumberField
                        field={field}
                        value={draft[field.id]}
                        error={message}
                        disabled={disabled}
                        onChange={change}
                      />
                      {/* The two money levers whose cost is not the money.
                          Both are attached to the control rather than written
                          into the section, because the number they are about
                          is the one under somebody's thumb. */}
                      {field.id === "raiseAmount" ? (
                        <DilutionNote
                          founderShare={company?.founderShare}
                          worth={data.valuation ?? null}
                          raise={draft[field.id]}
                        />
                      ) : null}
                      {field.id === "researchSpend" ? (
                        <PipelineNote
                          pipeline={company?.pipeline}
                          spend={draft[field.id]}
                          innovationPace={data.innovationPace}
                        />
                      ) : null}
                    </View>
                  );
                })}
              </View>

              {errors._ ? (
                <Text style={{ color: colors.danger, fontSize: font.sm, fontFamily: fontFamily.medium }}>{errors._}</Text>
              ) : null}

              {!finished && (
                <>
                  <Btn
                    label={
                      file.isPending ? "Filing…"
                        : !data.submitted ? "File this year's decision"
                          : dirty ? "Update what you filed" : "Filed — nothing to change"
                    }
                    icon={data.submitted && !dirty ? "checkmark-circle" : "send"}
                    variant={data.submitted && !dirty ? "outline" : "primary"}
                    loading={file.isPending}
                    disabled={!canFile || (data.submitted && !dirty)}
                    onPress={() => file.mutate()}
                    testID="desk-file"
                  />
                  <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular, textAlign: "center" }}>
                    {seconds == null
                      ? "Filing stays open until the year resolves."
                      : `Resolves in ${formatUntil(seconds)} — you can change this right up to the tick.`}
                  </Text>
                </>
              )}
            </Card>
          )}

          {/* 6. Who you're waiting on. */}
          {data.table && data.table.length > 0 && (
            <Card>
              <SimSectionTitle icon="people" title="The table" />
              <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
                {tableStatus(data.table)}
              </Text>
              {[...data.table]
                .sort((a, b) => rank(a.role) - rank(b.role))
                .map((seat) => (
                  <FiledRow key={seat.userId} seat={seat} spend={seat.role ? filedBySeat.get(seat.role) : undefined} />
                ))}
            </Card>
          )}

          {/* 8. Who you're up against. */}
          {data.rivals && data.rivals.length > 0 && company && (
            <Card>
              <SimSectionTitle icon="shield-half" title="Who you're up against" color={colors.danger} />
              <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
                As they stood at the end of last year. What they'll do next is their business.
              </Text>
              {data.rivals.map((rival) => (
                <RivalRow key={rival.id} rival={rival} yourCustomers={company.customers} />
              ))}
            </Card>
          )}

          {data.segments && data.segments.length > 0 && company && (
            <Card>
              <SimSectionTitle icon="people-circle" title="Who your customers are" color={colors.info} />
              {data.segments.map((segment) => (
                <View key={segment.id} style={{ gap: 3, paddingVertical: 7, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{segment.name}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.medium, fontVariant: ["tabular-nums"] }}>
                      {money(segment.yours)} yours
                    </Text>
                  </View>
                  <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
                    {segment.description} They expect to pay about {exact(segment.referencePrice)}.
                  </Text>
                </View>
              ))}
            </Card>
          )}

          {!finished && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", paddingTop: spacing.xs }}>
              <Icon name="sync" size={12} color={colors.textTertiary} />
              <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
                Live — the table refreshes every {ROOM_POLL_MS / 1000} seconds
              </Text>
            </View>
          )}
        </Screen>
      </KeyboardAvoidingView>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </View>
  );
}

/** Seats read in the same order everywhere: the way the five of them are listed. */
const rank = (role: DeskRole | null): number => (role ? ROLE_ORDER.indexOf(role) : ROLE_ORDER.length);
