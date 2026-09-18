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
  ChoiceField, CommitmentMeter, DeskBanner, EconomyStrip, FiledRow, NumberField,
  ReportCard, RivalRow, ScoreBar, Stat,
} from "../../../src/components/sim/DeskKit";
import { ROOM_POLL_MS, useDesk } from "../../../src/components/sim/useSim";
import {
  ROLE_ORDER, commitment, draftMatches, exact, executiveSalariesFrom, formatUntil,
  money, secondsUntil, tableStatus, validateDraft, withYourDraft,
  type DeskRole, type FileDecisionResult,
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

  const fields = data?.fields ?? [];
  const company = data?.company;
  const economy = data?.economy;

  /**
   * The table's position, with your unsaved edits standing in for your seat.
   *
   * The executive half of the fixed bill is backed out of the server's own
   * `fixed` rather than guessed from the table's length — see
   * executiveSalariesFrom() for why `table.length` is the wrong number.
   */
  const live = useMemo(() => {
    if (!company || !economy || !data?.preview) return null;
    const execs = executiveSalariesFrom(
      data.preview.commitment.fixed,
      Number(data.filed?.coo?.headcount ?? 0),
      economy.costIndex,
    );
    return commitment({
      company,
      decisions: withYourDraft(data.filed, data.yourRole, data.yourRole ? draft : null),
      costIndex: economy.costIndex,
      executiveSalaries: execs,
    });
  }, [company, economy, data?.preview, data?.filed, data?.yourRole, draft]);

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

          {/* 1. What happened. Before anything about what to do next. */}
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
              </View>

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

              <View style={{ gap: spacing.lg, paddingTop: spacing.xs }}>
                {fields.map((field) => {
                  // The server's message wins while it stands: it is the one
                  // that actually refused the submission.
                  const message = errors[field.id] || localCheck.errors[field.id];
                  return field.kind === "choice" ? (
                    <ChoiceField
                      key={field.id}
                      field={field}
                      value={draft[field.id]}
                      error={message}
                      disabled={finished || file.isPending}
                      onChange={(next) => { setDraft((d) => ({ ...d, [field.id]: next })); clearFieldError(field.id); }}
                    />
                  ) : (
                    <NumberField
                      key={field.id}
                      field={field}
                      value={draft[field.id]}
                      error={message}
                      disabled={finished || file.isPending}
                      onChange={(next) => { setDraft((d) => ({ ...d, [field.id]: next })); clearFieldError(field.id); }}
                    />
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
