/**
 * The pieces the market screen is made of.
 *
 * Sits beside DeskKit the way DeskKit sits beside SimKit: the same gradient,
 * the same section headings, the same stepper-first number entry — a player
 * arriving here from the desk should be on the next screen of the same
 * product, not in a store.
 *
 * ## What is deliberately not here
 *
 * There is no component for "other bidders", "current high bid", "interest in
 * this listing" or anything else of the kind, and there is no place to put one.
 * The bids are sealed: the server sends your own and nothing about anybody
 * else's, on purpose (see the top of server/simulation-market-routes.ts), and
 * the entire value of the mechanic is that the question stays "what is this
 * worth to us" rather than "am I winning". A component that hinted at the
 * field would undo that from the phone, quietly, and it would look like a
 * helpful addition while it did it.
 */
import React from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { colors, font, fontFamily, radius, shadow, spacing } from "../../theme";
import { Btn, Icon, NovaGradient } from "../ui";
import { Pill, tintSoft } from "../MoreKit";
import { exact, money, type ReportMarketNote } from "./desk";
import {
  KIND_ICON, KIND_LABEL, effectLines, lifePill, lifeRead, saleRead,
  type BidCheck, type Holding, type MarketListing, type SellingRow,
} from "./market";

/**
 * The top of the market: the year, and what the company can actually back.
 *
 * `funds` is cash plus the unused credit line — the same definition the desk's
 * commitment meter calls "available" — because a team that reads two different
 * numbers for the money it has on two screens of the same app stops trusting
 * both of them.
 */
export function MarketBanner({ year, funds, outstanding }: {
  year: number;
  funds: number;
  outstanding: { count: number; overcommitted: boolean; line: string | null };
}) {
  return (
    <NovaGradient style={{ borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm, ...shadow.card }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: font.xs, fontFamily: fontFamily.semibold, letterSpacing: 0.6 }}>
            YEAR {year} · THE MARKET
          </Text>
          <Text style={{ color: "#FFFFFF", fontSize: font.xl, fontFamily: fontFamily.bold, letterSpacing: -0.3 }}>
            Sealed bids
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.92)", fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
            Everyone in the season sees the same things for sale. Nobody sees anybody's bid — including yours — until the year
            resolves, and the highest offer over the reserve takes it.
          </Text>
        </View>
        <View
          testID="market-funds"
          accessibilityLabel={`${exact(funds)} to bid with`}
          style={{
            alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
            borderRadius: radius.sm, backgroundColor: "rgba(0,0,0,0.18)", minWidth: 86,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 20, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
            {money(funds)}
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 10, fontFamily: fontFamily.semibold, letterSpacing: 0.4 }}>
            TO BID WITH
          </Text>
        </View>
      </View>

      {outstanding.line ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name={outstanding.overcommitted ? "warning" : "pricetags-outline"} size={14} color="#FFFFFF" />
          <Text style={{ flex: 1, color: "rgba(255,255,255,0.92)", fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.medium }}>
            {outstanding.line}
          </Text>
        </View>
      ) : null}
    </NovaGradient>
  );
}

/** What a thing does, as chips: the same 0–100 scores the desk draws bars for. */
export function EffectChips({ effect }: { effect: MarketListing["effect"] }) {
  const lines = effectLines(effect);
  if (lines.length === 0) {
    return (
      <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
        Does nothing on its own.
      </Text>
    );
  }
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
      {lines.map((line) => (
        <View
          key={line}
          style={{
            paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm,
            backgroundColor: tintSoft(colors.novaEmerald, 0.14),
          }}
        >
          <Text style={{ color: colors.novaEmerald, fontSize: font.xs, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
            {line}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * One thing for sale, and the only number on it that is anybody's business.
 *
 * `yourBid` is stated plainly when there is one, because the single most
 * useful thing this screen can tell somebody two days later is what they
 * already offered. Everything about the competition is absent, and the card
 * says so in as many words — a player who is not told the bids are sealed will
 * assume the screen is simply failing to show them the leaderboard.
 */
export function ListingCard({
  listing, open, draft, check, onOpen, onDraft, onBid, onWithdraw, busy, canBid = true,
}: {
  listing: MarketListing;
  open: boolean;
  draft: string;
  check: BidCheck;
  onOpen: () => void;
  onDraft: (next: string) => void;
  onBid: () => void;
  onWithdraw: () => void;
  busy: boolean;
  /** Whether this seat may file the bid. Everyone sees it; the chief executive files it. */
  canBid?: boolean;
}) {
  const bid = listing.yourBid;
  return (
    <View
      testID={`market-listing-${listing.id}`}
      style={{
        borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.md,
        borderWidth: bid != null ? 2 : 1, borderColor: bid != null ? colors.primary : colors.border, ...shadow.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <View style={{
          width: 34, height: 34, borderRadius: 9, backgroundColor: tintSoft(colors.primary),
          alignItems: "center", justifyContent: "center",
        }}>
          <Icon name={KIND_ICON[listing.kind] ?? "cube"} size={17} color={colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{listing.name}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
            <Pill label={KIND_LABEL[listing.kind] ?? listing.kind} color={colors.textSecondary} />
            <Pill label={lifePill(listing.expiresIn)} icon="time-outline" color={listing.expiresIn == null ? colors.success : colors.info} />
            {listing.seller ? <Pill label={`From ${listing.seller}`} icon="people-outline" color={colors.novaPurple} /> : null}
          </View>
        </View>
      </View>

      <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
        {listing.blurb}
      </Text>

      <EffectChips effect={listing.effect} />

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.xs, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.semibold, letterSpacing: 0.4 }}>RESERVE</Text>
          <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
            {exact(listing.reserve)}
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 10, lineHeight: 15, fontFamily: fontFamily.regular }}>
            {lifeRead(listing.expiresIn)}
          </Text>
        </View>
        {bid != null ? (
          <View style={{ alignItems: "flex-end", gap: 1 }}>
            <Text style={{ color: colors.primary, fontSize: 10, fontFamily: fontFamily.semibold, letterSpacing: 0.4 }}>
              {canBid ? "YOUR BID" : "THE BID"}
            </Text>
            <Text testID={`market-yourbid-${listing.id}`} style={{ color: colors.primary, fontSize: font.lg, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
              {exact(bid)}
            </Text>
            <Text style={{ color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.regular }}>
              Nobody else can see it
            </Text>
          </View>
        ) : null}
      </View>

      {open ? (
        <View style={{ gap: spacing.sm }}>
          <BidInput
            listingId={listing.id}
            value={draft}
            onChange={onDraft}
            disabled={busy}
            reserve={listing.reserve}
          />
          {check.error ? (
            <Text testID={`market-bid-error-${listing.id}`} style={{ color: colors.danger, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.medium }}>
              {check.error}
            </Text>
          ) : null}
          {/* A warning is never a locked button: the server accepts a bid the
              company can't currently back, because the money may be back by
              the tick. Saying so is the player's business; deciding for them
              isn't. */}
          {check.warning ? (
            <Text testID={`market-bid-warning-${listing.id}`} style={{ color: colors.warning, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.medium }}>
              {check.warning}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Btn
              label={bid != null ? "Revise the bid" : "Place the bid"}
              icon="hammer-outline"
              small
              loading={busy}
              disabled={!check.ok || busy}
              onPress={onBid}
              style={{ flex: 1 }}
              testID={`market-bid-${listing.id}`}
            />
            {bid != null ? (
              <Btn label="Withdraw" icon="close-circle-outline" variant="danger" small disabled={busy}
                onPress={onWithdraw} testID={`market-withdraw-${listing.id}`} />
            ) : null}
          </View>
        </View>
      ) : canBid ? (
        <Btn
          label={bid != null ? "Change or withdraw your bid" : "Bid on this"}
          icon={bid != null ? "create-outline" : "hammer-outline"}
          variant={bid != null ? "outline" : "primary"}
          small
          onPress={onOpen}
          testID={`market-open-${listing.id}`}
        />
      ) : (
        /* Not your call, and not a secret: the bid is the company's. */
        <Text
          testID={`market-watching-${listing.id}`}
          style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}
        >
          {bid != null
            ? "Your chief executive has bid on this. Argue for it before the year resolves."
            : "Nothing bid on this yet. Bidding is the chief executive's call."}
        </Text>
      )}
    </View>
  );
}

/**
 * The amount, on steppers.
 *
 * Fifty thousand a tap, which is the increment the open market prices itself
 * in (shared/simulation/assets.ts rounds every listing to it) — so tapping
 * cannot produce a number that looks like a typo, and the keyboard stays for
 * the person who knows exactly what they want. The same bargain the desk's
 * levers make, for the same reason.
 */
export function BidInput({ listingId, value, onChange, disabled, reserve }: {
  listingId: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  reserve: number;
}) {
  const numeric = Number(value);
  const step = 50_000;
  const move = (direction: 1 | -1) => {
    const current = Number.isFinite(numeric) ? numeric : 0;
    const snapped = direction > 0
      ? Math.floor(current / step + 1e-9) * step + step
      : Math.ceil(current / step - 1e-9) * step - step;
    onChange(String(Math.max(0, snapped)));
  };

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>What it's worth to you</Text>
        <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>
          {money(Number.isFinite(numeric) ? numeric : 0)}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <StepSquare icon="remove" label="Lower the bid" disabled={disabled} onPress={() => move(-1)} testID={`market-bid-down-${listingId}`} />
        <MoneyInput value={value} onChange={onChange} disabled={disabled} testID={`market-bid-field-${listingId}`} label="Your bid" />
        <StepSquare icon="add" label="Raise the bid" disabled={disabled} onPress={() => move(1)} testID={`market-bid-up-${listingId}`} />
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
        Anything under the reserve of {exact(reserve)} buys nothing. You pay what you bid, and only if you win.
      </Text>
    </View>
  );
}

/** The one text input on this screen, so both places that need it agree. */
export function MoneyInput({ value, onChange, disabled, testID, label }: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  testID: string;
  label: string;
}) {
  return (
    <TextInput
      testID={testID}
      value={value}
      onChangeText={(text: string) => onChange(text.replace(/[^0-9]/g, ""))}
      editable={!disabled}
      keyboardType="number-pad"
      placeholder="0"
      placeholderTextColor={colors.textTertiary}
      accessibilityLabel={label}
      style={{
        flex: 1, textAlign: "center",
        backgroundColor: colors.surfaceRaised,
        borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
        paddingVertical: spacing.md, paddingHorizontal: spacing.sm,
        color: colors.text, fontSize: font.lg, fontFamily: fontFamily.semibold,
        fontVariant: ["tabular-nums"],
      }}
    />
  );
}

/**
 * A stepper square, exported because the offers screen types money into the
 * same kind of box for the same reason — a number nudged in round increments
 * cannot come out looking like a typo, and the keyboard is still there for
 * somebody who knows exactly what they want.
 */
export function StepSquare({ icon, label, onPress, disabled, testID }: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [{
        width: 46, height: 46, borderRadius: radius.sm, alignItems: "center", justifyContent: "center",
        backgroundColor: tintSoft(colors.primary), borderWidth: 1, borderColor: tintSoft(colors.primary, 0.3),
      }, pressed && { opacity: 0.6 }, disabled && { opacity: 0.4 }]}
    >
      <Icon name={icon} size={20} color={colors.primary} />
    </Pressable>
  );
}

/**
 * Something the company owns, and the two prices it would fetch.
 *
 * Both numbers always, with the gap between them named. That discount is the
 * entire cost of getting into trouble — the reason a struggling team's assets
 * are worth less precisely when it needs them most — and a team deciding
 * whether to sell now or hold on is choosing between exactly these two
 * figures. Showing only one would hide the decision.
 */
export function HoldingCard({
  holding, canSell, open, draft, check, onOpen, onDraft, onList, busy, listedReserve, onUnlist,
}: {
  holding: Holding;
  canSell: boolean;
  open: boolean;
  draft: string;
  check: BidCheck;
  onOpen: () => void;
  onDraft: (next: string) => void;
  onList: () => void;
  busy: boolean;
  /** The reserve it is already listed at, when it is. */
  listedReserve: number | null;
  onUnlist: () => void;
}) {
  const sale = saleRead(holding);
  return (
    <View
      testID={`market-holding-${holding.id}`}
      style={{
        borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.sm,
        borderWidth: 1, borderColor: listedReserve != null ? colors.warning : colors.border, ...shadow.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon name={KIND_ICON[holding.kind] ?? "cube"} size={17} color={colors.textSecondary} />
        <Text style={{ flex: 1, color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{holding.name}</Text>
        <Pill label={lifePill(holding.expiresIn)} color={holding.expiresIn == null ? colors.success : colors.info} />
      </View>

      <EffectChips effect={holding.effect} />
      <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
        {lifeRead(holding.expiresIn)} · cost {exact(holding.bookValue)}
      </Text>

      <View style={{ flexDirection: "row", gap: spacing.xs }}>
        <SaleFigure label="If you choose to sell" value={holding.willingSale} tone={colors.text} />
        <SaleFigure label="If you have to" value={holding.forcedSale} tone={colors.danger} />
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
        {sale.line}
      </Text>

      {listedReserve != null ? (
        <View style={{ gap: spacing.xs, paddingTop: spacing.xs, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
          <Text style={{ color: colors.warning, fontSize: font.xs, fontFamily: fontFamily.semibold }}>
            On the market at a reserve of {exact(listedReserve)}. It sells on the tick if anybody meets it.
          </Text>
          {canSell ? (
            <Btn label="Take it off the market" icon="arrow-undo-outline" variant="outline" small disabled={busy}
              onPress={onUnlist} testID={`market-unlist-${holding.id}`} />
          ) : null}
        </View>
      ) : !canSell ? null : open ? (
        <View style={{ gap: spacing.sm, paddingTop: spacing.xs, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <MoneyInput value={draft} onChange={onDraft} disabled={busy} testID={`market-reserve-field-${holding.id}`} label="Reserve" />
          </View>
          {check.error ? (
            <Text style={{ color: colors.danger, fontSize: font.xs, fontFamily: fontFamily.medium }}>{check.error}</Text>
          ) : null}
          {check.warning ? (
            <Text style={{ color: colors.warning, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.medium }}>{check.warning}</Text>
          ) : null}
          <Btn label="Put it up for sale" icon="pricetag-outline" small loading={busy} disabled={!check.ok || busy}
            onPress={onList} testID={`market-list-${holding.id}`} />
          <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
            You set the floor; every other team in the season sees it and bids blind. A reserve nobody meets is its own answer.
          </Text>
        </View>
      ) : (
        <Btn label="Sell it" icon="pricetag-outline" variant="outline" small onPress={onOpen} testID={`market-sell-${holding.id}`} />
      )}
    </View>
  );
}

function SaleFigure({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <View style={{ flex: 1, gap: 1, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised }}>
      <Text style={{ color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.semibold, letterSpacing: 0.4 }}>
        {label.toUpperCase()}
      </Text>
      <Text style={{ color: tone, fontSize: font.lg, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
        {money(value)}
      </Text>
    </View>
  );
}

/**
 * What a listing's status means, since the year's settled rows come back in
 * the same list as the live ones.
 */
export const SELLING_STATUS: Record<string, string> = {
  open: "up for sale, settles on the tick",
  sold: "sold",
  unsold: "nobody met the reserve",
  withdrawn: "you took it off the market",
};

/** One of your own things, on the market or already settled. */
export function SellingRowView({ row, canSell, onUnlist, busy }: {
  row: SellingRow;
  canSell: boolean;
  onUnlist: () => void;
  busy: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 7 }}>
      <Icon
        name={row.status === "sold" ? "cash-outline" : row.status === "open" ? "pricetag" : "remove-circle-outline"}
        size={16}
        color={row.status === "sold" ? colors.success : row.status === "open" ? colors.warning : colors.textTertiary}
      />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{row.name}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
          Reserve {exact(row.reserve)} · {SELLING_STATUS[row.status] ?? row.status}
        </Text>
      </View>
      {canSell && row.status === "open" ? (
        <Btn label="Withdraw" variant="ghost" small disabled={busy} onPress={onUnlist} testID={`market-unlist-row-${row.id}`} />
      ) : null}
    </View>
  );
}

/**
 * What last year's bids did, on the desk rather than here.
 *
 * This is the half of a sealed bid that makes it a decision rather than a
 * gamble. A player commits money on Tuesday, sees nothing — by design — and on
 * Wednesday needs to be told plainly whether it worked. The report carries
 * each outcome with its own `kind` (shared/simulation/resolve.ts), so the
 * sentence is the engine's and the colour is not guessed from it.
 *
 * Its own card rather than a line in the year's notes, and a way back to the
 * market from it — because "the money stays where it is" is most useful next
 * to somewhere to spend it.
 */
export function MarketResultCard({ market, summary, onOpen }: {
  market: ReportMarketNote[];
  summary: string;
  onOpen: () => void;
}) {
  return (
    <View
      testID="desk-market-result"
      style={{
        borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.sm,
        borderWidth: 1, borderColor: colors.border,
        borderLeftWidth: 3, borderLeftColor: colors.novaEmerald, ...shadow.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="storefront" size={16} color={colors.novaEmerald} />
        <Text style={{ flex: 1, color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>
          How the market went
        </Text>
      </View>
      {summary ? (
        <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.medium }}>
          {summary}
        </Text>
      ) : null}

      <View style={{ gap: 6 }}>
        {market.map((note, i) => {
          // `lost` is both being outbid and nothing clearing the reserve. They
          // read the same on purpose — the company's position is identical
          // either way — and the engine's sentence says which it was.
          const tone = note.kind === "won" || note.kind === "sold" ? colors.success
            : note.kind === "lost" ? colors.textSecondary
              : colors.warning;
          const icon = note.kind === "won" ? "checkmark-circle"
            : note.kind === "sold" ? "cash-outline"
              : note.kind === "lost" ? "close-circle-outline"
                : "remove-circle-outline";
          return (
            <View key={`${i}-${note.text.slice(0, 16)}`} style={{ flexDirection: "row", gap: 6 }}>
              <Icon name={icon} size={14} color={tone} />
              <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
                {note.text}
              </Text>
            </View>
          );
        })}
      </View>

      <Btn label="This year's market" icon="arrow-forward" variant="outline" small onPress={onOpen} testID="desk-market-open" />
    </View>
  );
}
