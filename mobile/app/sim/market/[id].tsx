import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../src/api/client";
import { colors, font, fontFamily, spacing } from "../../../src/theme";
import { Btn, Card, Empty, Icon, Loading, Screen, errText } from "../../../src/components/ui";
import { Callout, isSwitchedOff } from "../../../src/components/MoreKit";
import { NoticeBanner, useNotice } from "../../../src/components/Sheet";
import { SimSectionTitle } from "../../../src/components/sim/SimKit";
import { HoldingCard, ListingCard, MarketBanner, SellingRowView } from "../../../src/components/sim/MarketKit";
import { ROOM_POLL_MS, useMarket } from "../../../src/components/sim/useSim";
import { bidsOutstanding, canSell, validateBid, validateReserve, type BidResult } from "../../../src/components/sim/market";
import { formatUntil, secondsUntil } from "../../../src/components/sim/desk";

/**
 * The market: three things for sale, whatever other teams have put up, and the
 * question of what any of it is worth to *this* company.
 *
 * Three things about this screen exist to protect the mechanic rather than to
 * look nice, and all three are easy to undo by accident.
 *
 * **Nothing here knows about other bidders, and nothing should.** The response
 * carries your own bid and no signal whatsoever about anyone else's — not
 * amounts, not a count, not "popular this year". That is deliberate on the
 * server (the comment at the top of server/simulation-market-routes.ts says
 * why) and the phone honours it: the moment a screen hints at the field, the
 * sealed bid becomes an auction with a countdown and the decision stops being
 * "what is this worth to us".
 *
 * **The bid is said to be invisible, out loud.** A player who is not told will
 * assume the screen is broken, bid low to "test", and lose the asset for
 * nothing. The sentence is on the banner and on every card that has a bid.
 *
 * **Overreaching warns rather than refuses.** The server accepts a bid the
 * company cannot currently back, because the money may be back by the tick and
 * refusing now would leak that it had moved. So the button stays live and the
 * warning is honest — the one hard local stop is a bid under the reserve,
 * which can never buy anything at all.
 */
export default function Market() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();

  const { data, isLoading, error, refetch, isRefetching } = useMarket(id);

  /*
   * Selling what the company owns is the chief executive's or the finance
   * seat's call. The seat comes down with the market itself, so the control is
   * either shown or not shown — a screen that offered it to all five and let
   * the server refuse four of them would be teaching people to distrust its
   * own buttons.
   */
  const selling = canSell(data?.yourRole ?? null);

  /*
   * One editor open at a time, with the amount held here rather than in the
   * card.
   *
   * The market re-polls every couple of seconds, and a bid input seeded from
   * every response would take a number out of somebody's hands mid-thought.
   * Holding the draft above the list means a poll can replace the listing
   * underneath an open editor without touching what is being typed into it.
   */
  const [editing, setEditing] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [sellingAsset, setSellingAsset] = useState<string | null>(null);
  const [reserve, setReserve] = useState("");

  // A year rolling over settles every bid there was; whatever was half-typed
  // belonged to a market that no longer exists.
  const seededYear = useRef<number | null>(null);
  useEffect(() => {
    if (data?.year == null || seededYear.current === data.year) return;
    seededYear.current = data.year;
    setEditing(null);
    setAmount("");
    setSellingAsset(null);
    setReserve("");
  }, [data?.year]);

  const bid = useMutation({
    mutationFn: (body: { listingId: string; amount: number }) =>
      api<BidResult>(`/api/sim/ventures/${id}/bids`, { method: "POST", body }),
    onSuccess: (result) => {
      setEditing(null);
      show({ tone: "success", text: `Bid of ${result.amount.toLocaleString()} is in. Nobody sees it until the tick — you can change it until then.` });
      void qc.invalidateQueries({ queryKey: ["sim-market", id] });
    },
    onError: (err: any) => show({ tone: "error", text: errText(err, "Couldn't place that bid.") }),
  });

  const withdraw = useMutation({
    mutationFn: (listingId: string) => api(`/api/sim/ventures/${id}/bids/${listingId}`, { method: "DELETE" }),
    onSuccess: () => {
      setEditing(null);
      show({ tone: "info", text: "Bid withdrawn. The money is free again." });
      void qc.invalidateQueries({ queryKey: ["sim-market", id] });
    },
    onError: (err: any) => show({ tone: "error", text: errText(err, "Couldn't withdraw that.") }),
  });

  const list = useMutation({
    mutationFn: (body: { assetId: string; reserve: number }) =>
      api(`/api/sim/ventures/${id}/listings`, { method: "POST", body }),
    onSuccess: () => {
      setSellingAsset(null);
      setReserve("");
      show({ tone: "success", text: "It's on the market. Every team in the season can see it; none of them can see each other's offers." });
      void qc.invalidateQueries({ queryKey: ["sim-market", id] });
    },
    onError: (err: any) => show({ tone: "error", text: errText(err, "Couldn't list that.") }),
  });

  const unlist = useMutation({
    mutationFn: (listingId: string) => api(`/api/sim/ventures/${id}/listings/${listingId}`, { method: "DELETE" }),
    onSuccess: () => {
      show({ tone: "info", text: "Taken off the market." });
      void qc.invalidateQueries({ queryKey: ["sim-market", id] });
    },
    onError: (err: any) => show({ tone: "error", text: errText(err, "Couldn't withdraw that listing.") }),
  });

  const outstanding = useMemo(
    () => bidsOutstanding(data?.listings, data?.funds ?? 0),
    [data?.listings, data?.funds],
  );

  if (isLoading) {
    return (<><Stack.Screen options={{ title: "The market" }} /><Loading label="Opening the market…" /></>);
  }

  if (error || !data) {
    const gone = (error as any)?.status === 404;
    return (
      <>
        <Stack.Screen options={{ title: "The market" }} />
        <Screen canvas>
          {gone ? (
            <Empty icon="lock-closed-outline" title="No market here"
              body="Either this company isn't yours, or its season isn't running."
              action="Back to your desk" onAction={() => router.replace(`/sim/desk/${id}`)} />
          ) : isSwitchedOff(error) ? (
            <Empty icon="pause-circle-outline" title="Simulations are paused"
              body="The market simulation is switched off right now." />
          ) : (
            <Empty icon="cloud-offline-outline" title="Lost the market"
              body={errText(error)} action="Try again" onAction={() => refetch()} />
          )}
        </Screen>
      </>
    );
  }

  /** What is already promised elsewhere, so one bid isn't judged in isolation. */
  const otherBidsThan = (listingId: string) =>
    data.listings.reduce((sum, l) => sum + (l.id !== listingId && l.yourBid != null ? l.yourBid : 0), 0);

  /** The open listing for a holding, by the asset's own id rather than its name. */
  const listingFor = (assetId: string) =>
    data.selling.find((s) => s.assetId === assetId && s.status === "open") ?? null;

  const busy = bid.isPending || withdraw.isPending;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: "The market" }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Screen canvas onRefresh={refetch} refreshing={isRefetching}>
          <MarketBanner year={data.year} funds={data.funds} outstanding={outstanding} />

          {/* When "the tick" actually is. "Settles on the tick" is not a time
              anybody can plan around. Recomputed on each poll, which is close
              enough for a deadline measured in hours. */}
          {data.resolvesAt ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center" }}>
              <Icon name="time-outline" size={13} color={colors.textTertiary} />
              <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.medium }}>
                Bids settle in {formatUntil(secondsUntil(data.resolvesAt, Date.now()))} — change or withdraw yours until then
              </Text>
            </View>
          ) : null}

          {outstanding.overcommitted ? (
            <Callout
              icon="warning"
              tone="warn"
              title="Your bids add up to more than you have"
              body="Each one is judged on its own at settlement, and a bid the company can't back simply loses. Winning two of these isn't something you could pay for."
            />
          ) : null}

          {/* What's for sale. */}
          <SimSectionTitle icon="storefront" title={`For sale in year ${data.year}`} />
          {data.listings.length === 0 ? (
            <Card style={{ borderStyle: "dashed" }}>
              <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
                Nothing is on the market this year. The open market deals a fresh hand each year, and other teams list their own
                things when they need the money.
              </Text>
            </Card>
          ) : (
            data.listings.map((listing) => {
              const open = editing === listing.id;
              const check = validateBid({
                amount: open ? amount : listing.yourBid ?? "",
                reserve: listing.reserve,
                funds: data.funds,
                otherBids: otherBidsThan(listing.id),
              });
              return (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  open={open}
                  draft={open ? amount : ""}
                  check={check}
                  busy={busy && open}
                  onOpen={() => {
                    setEditing(listing.id);
                    // Opening on the reserve rather than on zero: it is the
                    // lowest number that could ever win, so it is the only
                    // sensible place to start arguing from.
                    setAmount(String(listing.yourBid ?? listing.reserve));
                  }}
                  onDraft={setAmount}
                  onBid={() => {
                    if (!check.ok) return;
                    bid.mutate({ listingId: listing.id, amount: Number(amount) });
                  }}
                  onWithdraw={() => withdraw.mutate(listing.id)}
                />
              );
            })
          )}

          {/* What you own. */}
          <SimSectionTitle icon="cube" title="What the company owns" color={colors.info} />
          {data.holdings.length === 0 ? (
            <Card style={{ borderStyle: "dashed" }}>
              <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
                Nothing yet. What you buy here works on top of what the five of you build — a patent lowers what every unit costs,
                a distribution deal lets you serve people you couldn't reach.
              </Text>
            </Card>
          ) : (
            data.holdings.map((holding) => {
              const open = sellingAsset === holding.id;
              // `listed` is the server's own answer; the row is what the
              // withdraw route needs. They agree, and the first is the one to
              // believe if they ever don't.
              const already = listingFor(holding.id);
              const check = validateReserve({ reserve: open ? reserve : holding.willingSale, willingSale: holding.willingSale });
              return (
                <HoldingCard
                  key={holding.id}
                  holding={holding}
                  canSell={selling}
                  open={open}
                  draft={open ? reserve : ""}
                  check={check}
                  busy={list.isPending || unlist.isPending}
                  listedReserve={holding.listed && already ? already.reserve : null}
                  onOpen={() => { setSellingAsset(holding.id); setReserve(String(Math.round(holding.willingSale))); }}
                  onDraft={setReserve}
                  onList={() => { if (check.ok) list.mutate({ assetId: holding.id, reserve: Number(reserve) }); }}
                  onUnlist={() => { if (already) unlist.mutate(already.id); }}
                />
              );
            })
          )}

          {!selling && data.holdings.length > 0 ? (
            <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular, paddingHorizontal: 2 }}>
              Selling what the company owns is the chief executive's or the finance seat's call. Bidding is anyone's.
            </Text>
          ) : null}

          {data.selling.length > 0 && (
            <Card accent={colors.warning}>
              <SimSectionTitle icon="pricetags" title="Yours, on the market" color={colors.warning} />
              <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
                An open listing settles on the tick; if nobody meets the reserve it comes back to you, unsold and unchanged.
                This year's settled ones stay here with what became of them.
              </Text>
              {data.selling.map((row) => (
                <SellingRowView
                  key={row.id}
                  row={row}
                  canSell={selling}
                  busy={unlist.isPending}
                  onUnlist={() => unlist.mutate(row.id)}
                />
              ))}
            </Card>
          )}

          <Btn label="Back to your desk" icon="arrow-back" variant="outline" onPress={() => router.back()} testID="market-back" />

          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", paddingTop: spacing.xs }}>
            <Icon name="lock-closed" size={12} color={colors.textTertiary} />
            <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
              Sealed until the tick · refreshes every {ROOM_POLL_MS / 1000} seconds
            </Text>
          </View>
        </Screen>
      </KeyboardAvoidingView>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </View>
  );
}
