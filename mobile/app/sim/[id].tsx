import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Card, Empty, Icon, Label, Loading, Screen, errText } from "../../src/components/ui";
import { Callout, Pill, isSwitchedOff } from "../../src/components/MoreKit";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { EmptySeatRow, LeverList, OpenSeatCard, PhaseBanner, SeatRow, SimSectionTitle } from "../../src/components/sim/SimKit";
import { ROOM_POLL_MS, useCountdown, useNiches, useVenture } from "../../src/components/sim/useSim";
import { phaseCopy, type SimRole } from "../../src/components/sim/lobby";

/**
 * The room: five people, one screen, changing under all of them.
 *
 * Three things about this screen are not like the rest of the app.
 *
 * **It polls, and the polling is load-bearing.** The server advances the phase
 * when the room is read (`advance()` in server/simulation-routes.ts), so asking
 * is also what moves the clock on. See useSim.ts for why it's 2.5 seconds and
 * not one.
 *
 * **The countdown is the server's.** `secondsLeft` is re-anchored on every
 * poll and only interpolated in between, because five phones each confident
 * about when the phase ends is five phones disagreeing.
 *
 * **Claiming is a race, so there is no optimistic UI.** Showing a seat as
 * yours before the server agrees means showing some of the room a lie, and
 * taking it back a second later is worse than the half-second wait. The one
 * request in flight is the only thing that decides, and a 409 is an answer —
 * "Dana got there first" — not an error.
 */
export default function Room() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();

  const { data: venture, isLoading, error, dataUpdatedAt, refetch } = useVenture(id);
  // Role titles and levers live with the markets, not the room — one cached
  // request rather than restating shared/simulation/types.ts on the phone.
  const { data: meta } = useNiches();

  const { seconds, text: clock } = useCountdown(venture?.secondsLeft, dataUpdatedAt);

  const roles: SimRole[] = meta?.roles ?? [];
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const titleOf = (role: string | null) => (role ? roleById.get(role)?.title ?? role.toUpperCase() : null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["sim-venture", id] });

  /**
   * Take a seat. No optimistic write, one request at a time.
   *
   * A 409 means the room moved while you were reaching: someone was faster, or
   * the phase ended under you. Both are news about the room rather than a
   * failure of yours, so they get the server's sentence — which names whoever
   * beat you — in an ordinary notice, and a refresh so the screen catches up
   * with what it's just been told.
   */
  const claim = useMutation({
    mutationFn: (role: string) => api(`/api/sim/ventures/${id}/claim`, { method: "POST", body: { role } }),
    onSuccess: () => { void refresh(); },
    onError: (err: any) => {
      if (err?.status === 409) {
        show({ tone: "info", text: errText(err, "Someone got there first.") });
        void refresh();
        return;
      }
      show({ tone: "error", text: errText(err, "Couldn't take that seat. Try again.") });
    },
  });

  const release = useMutation({
    mutationFn: () => api(`/api/sim/ventures/${id}/release`, { method: "POST" }),
    onSuccess: () => { void refresh(); },
    onError: (err: any) => {
      // Too late to swap is the clock doing its job, not a broken button.
      show({ tone: err?.status === 409 ? "info" : "error", text: errText(err, "Couldn't let go of that seat.") });
      void refresh();
    },
  });

  const [name, setName] = useState("");
  const [product, setProduct] = useState("");
  // Seed the form from the server once, and once only: the room re-polls every
  // couple of seconds and a form that re-seeds on each one eats what you type.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !venture) return;
    if (venture.phase !== "naming") return;
    seeded.current = true;
    setName(venture.name ?? "");
    setProduct(venture.product ?? "");
  }, [venture?.phase]);

  const submitName = useMutation({
    mutationFn: () => api(`/api/sim/ventures/${id}/name`, { method: "POST", body: { name: name.trim(), product: product.trim() } }),
    onSuccess: () => { void refresh(); },
    onError: (err: any) => {
      // 403 means the seat changed hands, 409 that the clock beat you — both
      // are the room having moved on, and the refresh shows what it moved to.
      const moved = err?.status === 403 || err?.status === 409;
      show({ tone: moved ? "info" : "error", text: errText(err, "Couldn't name the company.") });
      if (moved) void refresh();
    },
  });

  if (isLoading) return (<><Stack.Screen options={{ title: "The room" }} /><Loading label="Opening the room…" /></>);

  if (error || !venture) {
    const gone = (error as any)?.status === 404;
    return (
      <>
        <Stack.Screen options={{ title: "The room" }} />
        <Screen canvas>
          {gone ? (
            <Empty icon="lock-closed-outline" title="This room isn't yours"
              body="It either doesn't exist or you're not in it. Rooms are private to the five people in them."
              action="Pick a market" onAction={() => router.replace("/sim")} />
          ) : isSwitchedOff(error) ? (
            <Empty icon="pause-circle-outline" title="Simulations are paused"
              body="The market simulation is switched off right now." />
          ) : (
            <Empty icon="cloud-offline-outline" title="Lost the room"
              body={errText(error)} action="Try again" onAction={() => refetch()} />
          )}
        </Screen>
      </>
    );
  }

  const seats = venture.seats ?? [];
  const you = seats.find((s) => s.isYou);
  const ceo = seats.find((s) => s.role === "ceo");
  const waiting = Math.max(0, venture.lobbySize - seats.length);
  const live = venture.phase === "filling" || venture.phase === "claiming" || venture.phase === "naming";
  const copy = phaseCopy({
    phase: venture.phase,
    here: seats.length,
    lobbySize: venture.lobbySize,
    yourRoleTitle: titleOf(venture.you?.role ?? null),
    isCeo: !!venture.you?.isCeo,
    ceoName: ceo?.name ?? null,
    companyName: venture.name,
  });

  const openSeats = (venture.openRoles ?? [])
    .map((r) => roleById.get(r) ?? { id: r, title: r.toUpperCase(), levers: [] })
    .filter(Boolean) as SimRole[];

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: venture.name || venture.niche?.name || "The room" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Screen canvas>
          <PhaseBanner copy={copy} clock={clock} seconds={seconds} showClock={live} />

          {venture.niche?.name ? (
            <View style={{ flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" }}>
              <Pill label={venture.niche.name} icon="map-outline" color={colors.info} />
              <Pill label={`${seats.length} of ${venture.lobbySize} here`} icon="people-outline" />
              {venture.product ? <Pill label={venture.product} icon="cube-outline" color={colors.novaEmerald} /> : null}
            </View>
          ) : null}

          {/* Everyone in the room. Always visible, in every phase — the point
              of a lobby is the four other people, and hiding them behind the
              current task is how a room feels like a form. */}
          <Card>
            <SimSectionTitle icon="people" title={`In the room (${seats.length}/${venture.lobbySize})`} />
            {seats.length === 0 ? (
              <Text style={{ color: colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.regular }}>
                Nobody here yet. That includes you, which shouldn't be possible — pull back and try again.
              </Text>
            ) : (
              seats.map((seat) => <SeatRow key={seat.userId} seat={seat} roleTitle={titleOf(seat.role)} />)
            )}
            {venture.phase === "filling" && Array.from({ length: waiting }, (_, i) => <EmptySeatRow key={`empty-${i}`} index={i} />)}
          </Card>

          {venture.phase === "claiming" && (
            <ClaimingSection
              openSeats={openSeats}
              yourRole={venture.you?.role ?? null}
              yourRoleTitle={titleOf(venture.you?.role ?? null)}
              yourLevers={roleById.get(venture.you?.role ?? "")?.levers ?? []}
              claimingRole={claim.isPending ? (claim.variables as string) : null}
              busy={claim.isPending || release.isPending}
              onClaim={(role) => claim.mutate(role)}
              onRelease={() => release.mutate()}
              releasing={release.isPending}
            />
          )}

          {venture.phase === "naming" && (
            venture.you?.isCeo ? (
              <Card>
                <SimSectionTitle icon="create" title="Name it" />
                <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
                  The other four are watching this happen. Take their suggestions or don't — it's your call, and you can still
                  change it in year one.
                </Text>
                <View style={{ gap: spacing.xs }}>
                  <Label>Company name</Label>
                  <TextInput
                    testID="sim-name-input"
                    value={name}
                    onChangeText={setName}
                    placeholder="Northwind Works"
                    placeholderTextColor={colors.textTertiary}
                    maxLength={60}
                    autoCapitalize="words"
                    style={inputStyle}
                  />
                </View>
                <View style={{ gap: spacing.xs }}>
                  <Label>What it sells</Label>
                  <TextInput
                    testID="sim-product-input"
                    value={product}
                    onChangeText={setProduct}
                    placeholder="A training app for people who actually train"
                    placeholderTextColor={colors.textTertiary}
                    maxLength={120}
                    multiline
                    style={[inputStyle, { minHeight: 76, textAlignVertical: "top" }]}
                  />
                </View>
                <Btn
                  label="Name the company"
                  icon="checkmark"
                  loading={submitName.isPending}
                  disabled={name.trim().length < 2}
                  onPress={() => submitName.mutate()}
                  testID="sim-name-submit"
                />
                {name.trim().length > 0 && name.trim().length < 2 ? (
                  <Text style={{ color: colors.danger, fontSize: font.xs, fontFamily: fontFamily.regular }}>
                    At least two characters.
                  </Text>
                ) : null}
              </Card>
            ) : (
              <Card>
                <SimSectionTitle icon="hourglass" title={`${ceo?.name ?? "Your chief executive"}'s call`} />
                <Callout
                  icon="chatbubbles-outline"
                  tone="info"
                  body={`Only ${ceo?.name ?? "the chief executive"} can submit a name. Say what you think it should be — that's the whole point of the two minutes — but the button is theirs.`}
                />
                <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
                  If the clock beats them, the company starts under a placeholder name and they can change it in year one.
                </Text>
              </Card>
            )
          )}

          {venture.phase === "running" && (
            <Card accent={colors.success}>
              <SimSectionTitle icon="flag" title="Year one has begun" color={colors.success} />
              <Text style={{ color: colors.text, fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular }}>
                {venture.name ? `${venture.name} is trading` : "Your company is trading"}
                {venture.product ? `, selling ${venture.product}` : ""}
                {venture.niche?.name ? ` in ${venture.niche.name}` : ""}. Your seat is
                {venture.you?.role ? ` ${titleOf(venture.you.role)}` : " settled"}, and it's yours for the season.
              </Text>
              {/* Honest rather than a link to nothing: the screens for playing
                  a year aren't built on the phone yet, and a dead button is a
                  worse hand-off than a sentence. */}
              <Callout
                icon="construct-outline"
                tone="warn"
                title="Playing the year isn't on the phone yet"
                body="The lobby is where the app stops for now — the decision screens for a year don't exist here. Nothing is lost: the venture is real, the seats are settled, and this room will show you where you ended up."
              />
              <Btn label="Back to the markets" icon="arrow-back" variant="outline" onPress={() => router.replace("/sim")} testID="sim-back-to-markets" />
            </Card>
          )}

          {venture.phase === "retired" && (
            <Card style={{ borderStyle: "dashed" }}>
              <Empty icon="close-circle-outline" title="This room was retired"
                body="Not enough people joined before the clock ran out. Nothing was lost — start another."
                action="Pick a market" onAction={() => router.replace("/sim")} />
            </Card>
          )}

          {live && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", paddingTop: spacing.xs }}>
              <Icon name="sync" size={12} color={colors.textTertiary} />
              <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
                Live — this room refreshes every {ROOM_POLL_MS / 1000} seconds
              </Text>
            </View>
          )}
        </Screen>
      </KeyboardAvoidingView>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </View>
  );
}

/**
 * The argument: what you hold, and what's still going.
 *
 * Every open seat leads with what it controls, because a seat whose powers
 * aren't legible is a seat nobody argues over — and the arguing is the part
 * that makes five strangers a team.
 */
function ClaimingSection({
  openSeats, yourRole, yourRoleTitle, yourLevers, claimingRole, busy, onClaim, onRelease, releasing,
}: {
  openSeats: SimRole[];
  yourRole: string | null;
  yourRoleTitle: string | null;
  yourLevers: string[];
  claimingRole: string | null;
  busy: boolean;
  onClaim: (role: string) => void;
  onRelease: () => void;
  releasing: boolean;
}) {
  return (
    <>
      {yourRole ? (
        <Card accent={colors.primary}>
          <SimSectionTitle icon="ribbon" title={`Your seat: ${yourRoleTitle}`} />
          <LeverList levers={yourLevers} color={colors.text} />
          <Btn
            label={releasing ? "Letting go…" : "Release it"}
            icon="exit-outline"
            small
            variant="ghost"
            loading={releasing}
            disabled={busy && !releasing}
            onPress={onRelease}
            testID="sim-release"
          />
        </Card>
      ) : (
        <Callout
          icon="alert-circle-outline"
          tone="warn"
          title="You haven't taken a seat"
          body="Pick one before the clock stops, or one gets dealt to you — in join order, from the seats nobody wanted."
        />
      )}

      <SimSectionTitle icon="hand-left" title={openSeats.length > 0 ? `Still open (${openSeats.length})` : "Every seat is taken"} />
      {openSeats.length === 0 ? (
        <Card style={{ borderStyle: "dashed" }}>
          <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
            All five are claimed. The room moves on to naming in a moment — no need to wait out the clock.
          </Text>
        </Card>
      ) : (
        openSeats.map((role) => (
          <OpenSeatCard
            key={role.id}
            role={role}
            claiming={claimingRole === role.id}
            // Everything greys out while one claim is in flight: a second
            // request sent before the first is answered is how one person ends
            // up fighting themselves for two seats.
            disabled={busy && claimingRole !== role.id}
            onClaim={() => onClaim(role.id)}
          />
        ))
      )}
    </>
  );
}

const inputStyle = {
  backgroundColor: colors.surfaceRaised,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.sm,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.md,
  color: colors.text,
  fontSize: font.base,
  fontFamily: fontFamily.regular,
} as const;
