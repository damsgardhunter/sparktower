import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../src/api/client";
import { colors, font, fontFamily, spacing } from "../../../src/theme";
import { Btn, Card, Empty, Icon, Loading, Screen, errText } from "../../../src/components/ui";
import { Callout, isSwitchedOff } from "../../../src/components/MoreKit";
import { NoticeBanner, useNotice } from "../../../src/components/Sheet";
import {
  HalfHeader, MadeOfferRow, OffersBanner, ReceivedOfferCard, SeatNote, TargetCard, YourWorthCard,
} from "../../../src/components/sim/OffersKit";
import { ROOM_POLL_MS, useOffers } from "../../../src/components/sim/useSim";
import {
  canTrade, isLive, liveOffers, outstandingOffer, sortTargets, validateOffer,
  type OfferResponseResult,
} from "../../../src/components/sim/offers";
import { seasonOver } from "../../../src/components/sim/lobby";
import { formatUntil, secondsUntil } from "../../../src/components/sim/desk";

/**
 * Acquisitions: who would buy you, and who you could buy.
 *
 * ## What this screen has to get right
 *
 * Being acquired is not an elimination, and every sentence on this screen is
 * written so that nobody could come away thinking otherwise. A team that
 * accepts an offer keeps the company, every seat, their reputation and their
 * capacity, and they take the cash — they carry on small and rich in a market
 * where the buyer is now the thing to beat. Selling is a legitimate strategy:
 * cash out of a position you cannot defend and rebuild from in front.
 *
 * Where the engine has already said this well, it is quoted rather than
 * paraphrased (shared/simulation/mergers.ts, and the accept message from the
 * respond route). Those sentences are maintained where the mechanic is.
 *
 * ## The rest of the shape
 *
 * **Offers received come first.** An offer for your company is a question
 * somebody else has asked you and is waiting on; a list of people you could
 * buy is browsing. The question goes above the browsing.
 *
 * **Accepting takes two presses.** Not friction for its own sake — the first
 * press opens the panel that says what leaves and what stays, which is the
 * case for selling as much as the warning about it. The second agrees.
 *
 * **Non-chairs see everything and are told once.** The argument about whether
 * to sell belongs to all five; the signature belongs to the chair. Said at the
 * top of each half rather than repeated under every dead button.
 */
export default function Offers() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();

  const { data, isLoading, error, refetch, isRefetching } = useOffers(id);

  const isCeo = canTrade(data?.yourRole ?? null);

  /*
   * One offer being composed at a time, with the draft held above the list —
   * the same arrangement as the market screen, for the same reason: this
   * screen re-polls every couple of seconds, and a card that reseeded itself
   * from every response would eat what somebody was typing into it.
   */
  const [editing, setEditing] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  /** The received offer whose "what selling means" panel is open. */
  const [considering, setConsidering] = useState<string | null>(null);

  // A year rolling over lapses every offer there was; a half-typed number
  // belonged to a negotiation that has already been answered for you.
  const seededYear = useRef<number | null>(null);
  useEffect(() => {
    if (data?.year == null || seededYear.current === data.year) return;
    seededYear.current = data.year;
    setEditing(null);
    setAmount("");
    setMessage("");
    setConsidering(null);
  }, [data?.year]);

  const offer = useMutation({
    mutationFn: (body: { targetId: string; amount: number; message?: string }) =>
      api(`/api/sim/ventures/${id}/offers`, { method: "POST", body }),
    onSuccess: () => {
      setEditing(null);
      setMessage("");
      show({ tone: "success", text: "Offer sent. Their chief executive decides — nothing happens unless they say yes." });
      void qc.invalidateQueries({ queryKey: ["sim-offers", id] });
    },
    onError: (err: any) => show({ tone: "error", text: errText(err, "Couldn't send that offer.") }),
  });

  const withdraw = useMutation({
    mutationFn: (offerId: string) => api(`/api/sim/ventures/${id}/offers/${offerId}`, { method: "DELETE" }),
    onSuccess: () => {
      setEditing(null);
      show({ tone: "info", text: "Taken back off their table. The money is free again." });
      void qc.invalidateQueries({ queryKey: ["sim-offers", id] });
    },
    /*
     * The 409 this route answers when nothing was pending is the one error on
     * this screen worth handling by name. It means the offer was answered
     * while the screen was being read — quite possibly accepted — and telling
     * somebody their offer is safely withdrawn at that exact moment is the
     * worst thing this screen could say. So: the server's sentence, and an
     * immediate re-read so the card underneath tells the truth.
     */
    onError: (err: any) => {
      show({
        tone: err?.body?.code === "not_pending" ? "info" : "error",
        text: errText(err, "Couldn't withdraw that."),
      });
      void qc.invalidateQueries({ queryKey: ["sim-offers", id] });
    },
  });

  const respond = useMutation({
    mutationFn: (body: { offerId: string; accept: boolean }) =>
      api<OfferResponseResult>(`/api/sim/ventures/${id}/offers/${body.offerId}/respond`, {
        method: "POST", body: { accept: body.accept },
      }),
    onSuccess: (result) => {
      setConsidering(null);
      // The server's own sentence, which is the one that says what an accepted
      // offer actually means for the company that accepted it.
      show({ tone: result.status === "accepted" ? "success" : "info", text: result.message });
      void qc.invalidateQueries({ queryKey: ["sim-offers", id] });
      void qc.invalidateQueries({ queryKey: ["sim-desk", id] });
    },
    // Same race, from the other side: the buyer may have withdrawn it while
    // the panel was open, and the server's refusal is the honest answer.
    onError: (err: any) => {
      setConsidering(null);
      show({
        tone: err?.body?.code === "not_pending" ? "info" : "error",
        text: errText(err, "Couldn't answer that offer."),
      });
      void qc.invalidateQueries({ queryKey: ["sim-offers", id] });
    },
  });

  const targets = useMemo(() => sortTargets(data?.targets), [data?.targets]);
  const pending = useMemo(() => liveOffers(data?.received), [data?.received]);
  const answered = useMemo(() => (data?.received ?? []).filter((o) => !isLive(o.status)), [data?.received]);
  const outstanding = useMemo(() => outstandingOffer(data?.made), [data?.made]);
  const settledMade = useMemo(() => (data?.made ?? []).filter((o) => !isLive(o.status)), [data?.made]);

  if (isLoading) {
    return (<><Stack.Screen options={{ title: "Acquisitions" }} /><Loading label="Valuing the market…" /></>);
  }

  if (error || !data) {
    const gone = (error as any)?.status === 404;
    return (
      <>
        <Stack.Screen options={{ title: "Acquisitions" }} />
        <Screen canvas>
          {gone ? (
            <Empty icon="lock-closed-outline" title="Nothing on the table"
              body="Either this company isn't yours, or its season isn't running."
              action="Back to your desk" onAction={() => router.replace(`/sim/desk/${id}`)} />
          ) : isSwitchedOff(error) ? (
            <Empty icon="pause-circle-outline" title="Simulations are paused"
              body="The market simulation is switched off right now." />
          ) : (
            <Empty icon="cloud-offline-outline" title="Lost the table"
              body={errText(error)} action="Try again" onAction={() => refetch()} />
          )}
        </Screen>
      </>
    );
  }

  const busy = offer.isPending || withdraw.isPending;
  /*
   * A finished season is a final answer. Nothing more changes hands, so the
   * controls go rather than being left live to be refused — the same bargain
   * the desk and the market make with a season that can no longer move.
   */
  const over = seasonOver(data.status);
  const lastYear = data.year >= data.totalYears;
  const trading = isCeo && !over;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: "Acquisitions" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Screen canvas onRefresh={refetch} refreshing={isRefetching}>
          <OffersBanner
            year={data.year}
            totalYears={data.totalYears}
            reach={data.reach}
            you={data.you}
            pendingIn={pending.length}
          />

          {data.resolvesAt && !over ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center" }}>
              <Icon name="time-outline" size={13} color={colors.textTertiary} />
              <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.medium }}>
                The year resolves in {formatUntil(secondsUntil(data.resolvesAt, Date.now()))} — anything unanswered lapses then
              </Text>
            </View>
          ) : null}

          {over ? (
            <Callout
              icon="flag"
              tone="info"
              title="The season is over"
              body="Nothing else changes hands. What's below is how it finished — every offer made, and what each company was worth at the end."
            />
          ) : null}

          {/* Offers for your company, first: this is somebody else's question
              sitting on your table, and it is waiting on an answer. */}
          <HalfHeader icon="mail-open" title="Offers for your company" count={pending.length} color={colors.primary} />

          {!isCeo && !over ? (
            <SeatNote>
              Selling the company is the chief executive's signature, so the accept and decline are theirs. Everything on
              this screen is shown to all five of you on purpose — the argument about whether to take it is the whole point.
            </SeatNote>
          ) : null}

          {pending.length === 0 && answered.length === 0 ? (
            <Card style={{ borderStyle: "dashed" }}>
              <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
                Nobody has made an offer for {data.you.name}. If one arrives, it lands here — and nothing happens to this
                company unless your chief executive agrees to it.
              </Text>
            </Card>
          ) : null}

          {pending.map((received) => (
            <ReceivedOfferCard
              key={received.id}
              offer={received}
              isCeo={trading}
              confirming={considering === received.id}
              busy={respond.isPending}
              onConfirm={() => setConsidering(received.id)}
              onCancel={() => setConsidering(null)}
              onAccept={() => respond.mutate({ offerId: received.id, accept: true })}
              onDecline={() => respond.mutate({ offerId: received.id, accept: false })}
            />
          ))}

          {answered.map((received) => (
            <ReceivedOfferCard
              key={received.id}
              offer={received}
              isCeo={isCeo}
              confirming={false}
              busy={false}
              onConfirm={() => {}}
              onCancel={() => {}}
              onAccept={() => {}}
              onDecline={() => {}}
            />
          ))}

          {/* What your own company is worth, between the two halves: it is the
              answer to "is that a good offer" and the opening bid in any
              argument about somebody else's valuation. */}
          <YourWorthCard you={data.you} />

          <HalfHeader icon="briefcase" title="Who you could buy" color={colors.novaPurple} />

          {over ? null : !isCeo ? (
            <SeatNote>
              Making an offer is the chief executive's call too. The valuations below are published to both sides
              deliberately — the other team is reading the same figures about themselves.
            </SeatNote>
          ) : lastYear ? (
            <Callout
              icon="time"
              tone="warn"
              title="Too late in the season to buy"
              body="Anything bought now would never trade a single year, so the offer routes are closed. What is on the table already still resolves."
            />
          ) : outstanding ? (
            <Callout
              icon="information-circle"
              tone="info"
              title={`One offer at a time — yours is with ${outstanding.to}`}
              body="Withdraw it on their card below if you would rather put the money somewhere else."
            />
          ) : null}

          {targets.length === 0 ? (
            <Card style={{ borderStyle: "dashed" }}>
              <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
                No other teams in this season. The incumbents are not for sale — they were here before you and they intend to
                be here after.
              </Text>
            </Card>
          ) : (
            targets.map((target) => {
              const open = editing === target.id;
              const yours = outstanding && outstanding.toId === target.id ? outstanding : null;
              const check = validateOffer({
                amount: open ? amount : yours?.amount ?? "",
                reach: data.reach,
                target,
                role: data.yourRole,
                year: data.year,
                totalYears: data.totalYears,
                you: data.you,
                status: data.status,
                pendingElsewhere: outstanding && outstanding.toId !== target.id ? outstanding : null,
              });
              return (
                <TargetCard
                  key={target.id}
                  target={target}
                  you={data.you}
                  isCeo={trading}
                  open={open}
                  draft={open ? amount : ""}
                  message={open ? message : ""}
                  check={check}
                  busy={busy}
                  yourOffer={yours}
                  onOpen={() => {
                    setEditing(target.id);
                    // Opening on the published valuation rather than on zero:
                    // it is the number both sides are already arguing from.
                    setAmount(String(yours?.amount ?? Math.round(target.fair)));
                    setMessage(yours?.message ?? "");
                  }}
                  onClose={() => setEditing(null)}
                  onDraft={setAmount}
                  onMessage={setMessage}
                  onSend={() => {
                    if (!check.ok) return;
                    offer.mutate({
                      targetId: target.id,
                      amount: Number(amount),
                      ...(message.trim() ? { message: message.trim() } : {}),
                    });
                  }}
                  onWithdraw={() => { if (yours) withdraw.mutate(yours.id); }}
                />
              );
            })
          )}

          {settledMade.length > 0 ? (
            <Card accent={colors.textSecondary}>
              <HalfHeader icon="receipt-outline" title="Offers you've made" color={colors.textSecondary} />
              <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
                This year's, and what became of them. An offer nobody answers lapses when the year resolves.
              </Text>
              {settledMade.map((made) => <MadeOfferRow key={made.id} offer={made} />)}
            </Card>
          ) : null}

          <Card onPress={() => router.push(`/sim/standings/${id}`)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <Icon name="podium" size={20} color={colors.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>Standings</Text>
                <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
                  Where every one of these companies actually stands, before you decide what one is worth.
                </Text>
              </View>
              <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
            </View>
          </Card>

          <Btn label="Back to your desk" icon="arrow-back" variant="outline" onPress={() => router.back()} testID="offers-back" />

          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", paddingTop: spacing.xs }}>
            <Icon name={over ? "flag-outline" : "hand-left"} size={12} color={colors.textTertiary} />
            <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular, textAlign: "center" }}>
              {over
                ? "Season finished · no company ever changed hands without its own chief executive agreeing"
                : `No company changes hands without its own chief executive agreeing · refreshes every ${ROOM_POLL_MS / 1000} seconds`}
            </Text>
          </View>
        </Screen>
      </KeyboardAvoidingView>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </View>
  );
}
