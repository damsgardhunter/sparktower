/**
 * The pieces the acquisitions screen is made of.
 *
 * Sits beside MarketKit the way MarketKit sits beside DeskKit: the same
 * gradient header, the same section headings, the same stepper-first number
 * entry. Somebody arriving here from the market should be on the next screen
 * of the same product.
 *
 * ## What every component in this file is written to avoid
 *
 * Making an accepted offer look like a defeat. The team that sells keeps the
 * company, every seat, their reputation, their capacity and a great deal of
 * cash — they carry on, small and rich, in a market where the buyer is now the
 * thing to beat. So there is no skull, no "eliminated", no greyed-out row and
 * no red banner on the seller's side of this screen. The accept control is
 * deliberate and two-handed, because it is a large decision, and deliberate is
 * a different feeling from fatal.
 *
 * The sentences that carry this come from the engine
 * (shared/simulation/mergers.ts) and from the respond route, quoted through
 * offers.ts rather than rewritten here.
 */
import React from "react";
import { Text, TextInput, View } from "react-native";
import { colors, font, fontFamily, radius, shadow, spacing } from "../../theme";
import { Btn, Icon, NovaGradient } from "../ui";
import { Pill, tintSoft } from "../MoreKit";
import { exact, money } from "./desk";
import { MoneyInput, StepSquare } from "./MarketKit";
import {
  DISTRESS_NOTE, GOES_WITH_THE_BUSINESS, KEEP_LINES, MONEY_IS_A_POSITION_NOT_AN_INCOME,
  NOT_AN_ELIMINATION, offerStatusRead, purchaseRead, ratioRead, serviceGap, verdictRead,
  type MadeOffer, type OfferCheck, type OfferTarget, type ReceivedOffer, type YourValuation,
} from "./offers";

/**
 * The top of the screen: what the company could back, and what it is worth.
 *
 * Both numbers together on purpose. Reach is what you could spend on somebody
 * else; `fair` is what somebody else would be spending on you. Seeing them
 * side by side is the whole strategic question of this screen in one glance —
 * are we the buyer here, or the thing worth buying?
 */
export function OffersBanner({ year, totalYears, reach, you, pendingIn }: {
  year: number;
  totalYears: number;
  reach: number;
  you: YourValuation;
  /** How many offers are sitting unanswered on your table. */
  pendingIn: number;
}) {
  return (
    <NovaGradient style={{ borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm, ...shadow.card }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: font.xs, fontFamily: fontFamily.semibold, letterSpacing: 0.6 }}>
            YEAR {year} OF {totalYears} · ACQUISITIONS
          </Text>
          <Text style={{ color: "#FFFFFF", fontSize: font.xl, fontFamily: fontFamily.bold, letterSpacing: -0.3 }}>
            Buying a business
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.92)", fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
            An offer buys the customers, what a company owns and what it owes. It never buys the people: whoever sells keeps
            their company, their seats and their reputation, and the money. Nobody is bought without saying yes.
          </Text>
        </View>
        <View
          testID="offers-reach"
          accessibilityLabel={`${exact(reach)} you could back an offer with`}
          style={{
            alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
            borderRadius: radius.sm, backgroundColor: "rgba(0,0,0,0.18)", minWidth: 86,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 20, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
            {money(reach)}
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 10, fontFamily: fontFamily.semibold, letterSpacing: 0.4 }}>
            YOUR REACH
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={pendingIn > 0 ? "mail-unread" : "pricetag-outline"} size={14} color="#FFFFFF" />
        <Text style={{ flex: 1, color: "rgba(255,255,255,0.92)", fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.medium }}>
          {pendingIn > 0
            ? `${pendingIn === 1 ? "One offer is" : `${pendingIn} offers are`} on your table. ${you.name} is valued at ${exact(you.fair)}.`
            : `${you.name} is valued at ${exact(you.fair)} — and everybody in the season can see that number.`}
        </Text>
      </View>
    </NovaGradient>
  );
}

/**
 * What your own company is worth, with the reasoning.
 *
 * Shown to you because it is shown to everybody else. The valuation is
 * published to both sides deliberately (see the route's comment): a
 * negotiation where only one side can do the arithmetic is a trick played on
 * whoever is newer to the game, and the argument worth having — what is it
 * worth *to you* — only starts once the boring part is settled.
 */
export function YourWorthCard({ you }: { you: YourValuation }) {
  return (
    <View
      testID="offers-your-worth"
      style={{
        borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.sm,
        borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: colors.novaPurple, ...shadow.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="calculator" size={16} color={colors.novaPurple} />
        <Text style={{ flex: 1, color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>
          What {you.name} is worth
        </Text>
        <Text testID="offers-your-fair" style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
          {exact(you.fair)}
        </Text>
      </View>
      <ValuationNotes notes={you.notes} />
      <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
        Every team sees this figure, and you see theirs. It's a reference, not a price — a company that fits what a buyer
        already has is worth more to them than to anybody else.
      </Text>
    </View>
  );
}

/** The reasoning behind a valuation, in the words both sides will argue in. */
export function ValuationNotes({ notes }: { notes: string[] }) {
  if (!notes || notes.length === 0) return null;
  return (
    <View style={{ gap: 4 }}>
      {notes.map((note, i) => (
        <View key={`${i}-${note.slice(0, 12)}`} style={{ flexDirection: "row", gap: 6 }}>
          <Text style={{ color: colors.textTertiary, fontSize: font.sm, lineHeight: 18 }}>·</Text>
          <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.sm, lineHeight: 18, fontFamily: fontFamily.regular }}>
            {note}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * An amount drawn against what the business is worth.
 *
 * The bar is scaled so that `fair` sits two-thirds of the way along, which
 * leaves room above it: an offer can be generous, and a scale that topped out
 * at the asking price would make every good offer look identical to a
 * merely adequate one.
 */
export function AmountAgainstFair({ amount, fair, color }: { amount: number; fair: number; color: string }) {
  const ceiling = fair > 0 ? fair * 1.5 : Math.max(amount, 1);
  const fraction = Math.max(0, Math.min(1, amount / ceiling));
  return (
    <View style={{ gap: 4 }}>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
        <View style={{ width: `${fraction * 100}%`, height: "100%", backgroundColor: color }} />
      </View>
      {/* The asking price, marked where it falls rather than only stated. */}
      <View style={{ height: 12 }}>
        <View style={{ position: "absolute", left: "66.6%", alignItems: "center" }}>
          <View style={{ width: 1, height: 5, backgroundColor: colors.textTertiary }} />
          <Text style={{ color: colors.textTertiary, fontSize: 9, fontFamily: fontFamily.medium }}>{exact(fair)}</Text>
        </View>
      </View>
    </View>
  );
}

/**
 * An offer for your company.
 *
 * Everything the team needs to argue about it, in one card: the amount against
 * what the business is worth, the server's verdict and its sentence, and
 * whatever the buyer wrote. The accept control is two-handed — a press opens
 * the panel that says what goes and what stays, and a second press agrees —
 * because this is the biggest decision anybody makes in a season. Two taps for
 * weight, not for friction, and the panel it opens is the case *for* selling
 * as much as the warning about it.
 */
export function ReceivedOfferCard({
  offer, isCeo, confirming, onConfirm, onCancel, onAccept, onDecline, busy,
}: {
  offer: ReceivedOffer;
  isCeo: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onAccept: () => void;
  onDecline: () => void;
  busy: boolean;
}) {
  const verdict = verdictRead(offer.verdict);
  const status = offerStatusRead(offer.status, "received");

  return (
    <View
      testID={`offers-received-${offer.id}`}
      style={{
        borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.md,
        borderWidth: status.live ? 2 : 1, borderColor: status.live ? colors.primary : colors.border, ...shadow.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <View style={{
          width: 34, height: 34, borderRadius: 9, backgroundColor: tintSoft(colors.primary),
          alignItems: "center", justifyContent: "center",
        }}>
          <Icon name="mail-open-outline" size={17} color={colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>
            {offer.from} want to buy the business
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
            <Pill label={verdict.label} color={verdict.color} />
            <Pill label={status.label} color={status.color} />
          </View>
        </View>
        <Text testID={`offers-amount-${offer.id}`} style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
          {money(offer.amount)}
        </Text>
      </View>

      <AmountAgainstFair amount={offer.amount} fair={offer.fair} color={verdict.color} />
      <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.medium }}>
        {exact(offer.amount)} against a valuation of {exact(offer.fair)}. {ratioRead(offer.ratio)}
      </Text>
      {/* The engine's own sentence about this verdict, shown rather than
          paraphrased — it is written to be read by the person deciding. */}
      <Text style={{ color: verdict.color, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.medium }}>
        {offer.note}
      </Text>

      {offer.message ? (
        <View style={{ gap: 3, padding: spacing.md, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised }}>
          <Text style={{ color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.semibold, letterSpacing: 0.4 }}>
            {offer.from.toUpperCase()} WROTE
          </Text>
          <Text style={{ color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
            {offer.message}
          </Text>
        </View>
      ) : null}

      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
        {status.line}
      </Text>

      {!status.live || !isCeo ? null : confirming ? (
        <WhatSellingMeans
          amount={offer.amount}
          buyer={offer.from}
          busy={busy}
          onAccept={onAccept}
          onCancel={onCancel}
          offerId={offer.id}
        />
      ) : (
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Btn
            label="Consider selling"
            icon="git-compare-outline"
            small
            disabled={busy}
            onPress={onConfirm}
            style={{ flex: 1 }}
            testID={`offers-consider-${offer.id}`}
          />
          <Btn label="Decline" icon="close-circle-outline" variant="outline" small disabled={busy}
            onPress={onDecline} testID={`offers-decline-${offer.id}`} />
        </View>
      )}
    </View>
  );
}

/**
 * The panel that opens before a yes: what leaves, and what stays.
 *
 * The order is deliberate. What goes is listed first, because it is the part
 * that cannot be undone; what stays is listed second and at greater length,
 * because it is the part players get wrong. Being bought here is not an exit —
 * it is a company with no customers, no debts and more money than anybody
 * else, which is a position a good team can win from.
 */
export function WhatSellingMeans({ amount, buyer, busy, onAccept, onCancel, offerId }: {
  amount: number;
  buyer: string;
  busy: boolean;
  onAccept: () => void;
  onCancel: () => void;
  offerId: string;
}) {
  return (
    <View
      testID={`offers-confirm-${offerId}`}
      style={{ gap: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderColor: colors.borderSubtle }}
    >
      <View style={{ gap: 4 }}>
        <Text style={{ color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.semibold, letterSpacing: 0.4 }}>
          WHAT GOES TO {buyer.toUpperCase()}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
          {GOES_WITH_THE_BUSINESS}
        </Text>
      </View>

      <View style={{ gap: 6, padding: spacing.md, borderRadius: radius.sm, backgroundColor: tintSoft(colors.success, 0.08) }}>
        <Text style={{ color: colors.success, fontSize: 10, fontFamily: fontFamily.semibold, letterSpacing: 0.4 }}>
          WHAT YOU KEEP
        </Text>
        {KEEP_LINES.map((line) => (
          <View key={line} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
            <Icon name="checkmark-circle" size={14} color={colors.success} />
            <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
              {line}
            </Text>
          </View>
        ))}
        <Text style={{ color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.semibold }}>
          {NOT_AN_ELIMINATION}
        </Text>
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
          {exact(amount)} lands when the year resolves, and the market you rebuild into is one where {buyer} are now the
          company to beat.
        </Text>
        {/* The one part of "you keep the money" that invites a wrong
            conclusion. The proceeds arrive and then the year runs anyway. */}
        <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
          {MONEY_IS_A_POSITION_NOT_AN_INCOME}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Btn
          label={busy ? "Agreeing…" : "Sell the business"}
          icon="hand-right-outline"
          small
          loading={busy}
          disabled={busy}
          onPress={onAccept}
          style={{ flex: 1 }}
          testID={`offers-accept-${offerId}`}
        />
        <Btn label="Not yet" variant="ghost" small disabled={busy} onPress={onCancel} testID={`offers-cancel-${offerId}`} />
      </View>
    </View>
  );
}

/**
 * A company you could buy, valued in public.
 *
 * The notes are the server's reasoning and are shown in full: the same
 * sentences are on the other team's screen, which is what makes an offer an
 * argument rather than a bluff.
 */
export function TargetCard({
  target, you, isCeo, open, draft, message, check, busy, yourOffer,
  onOpen, onClose, onDraft, onMessage, onSend, onWithdraw,
}: {
  target: OfferTarget;
  /** Your own capacity and customers, for the sum that decides whether this is a good idea. */
  you: YourValuation;
  isCeo: boolean;
  open: boolean;
  draft: string;
  message: string;
  check: OfferCheck;
  busy: boolean;
  /** Your live offer to this company, if one is on their table. */
  yourOffer: MadeOffer | null;
  onOpen: () => void;
  onClose: () => void;
  onDraft: (next: string) => void;
  onMessage: (next: string) => void;
  onSend: () => void;
  onWithdraw: () => void;
}) {
  const note = target.distress ? DISTRESS_NOTE[target.distress] : null;
  const amount = Number(draft);
  const lines = purchaseRead(target, Number.isFinite(amount) ? amount : 0);
  const service = serviceGap({ you, target });

  return (
    <View
      testID={`offers-target-${target.id}`}
      style={{
        borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.sm,
        borderWidth: yourOffer ? 2 : 1, borderColor: yourOffer ? colors.primary : colors.border,
        ...shadow.card, opacity: target.hollow ? 0.72 : 1,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{target.name}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
            <Pill label={`${money(target.customers)} customers`} icon="people-outline" color={colors.textSecondary} />
            {target.distress && target.distress !== "healthy" ? (
              <Pill
                label={target.distress === "insolvent" ? "Insolvent" : target.distress === "distressed" ? "In trouble" : "Stretched"}
                color={target.distress === "strained" ? colors.warning : colors.danger}
              />
            ) : null}
            {target.hollow ? <Pill label="Already sold" icon="checkmark-done-outline" color={colors.textTertiary} /> : null}
          </View>
        </View>
        <View style={{ alignItems: "flex-end", gap: 1 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.semibold, letterSpacing: 0.4 }}>VALUED AT</Text>
          <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
            {exact(target.fair)}
          </Text>
        </View>
      </View>

      <ValuationNotes notes={target.notes} />
      {note ? (
        <Text style={{ color: target.distress === "strained" ? colors.warning : colors.danger, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.medium }}>
          {note}
        </Text>
      ) : null}

      {target.hollow ? (
        <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
          They have already sold the business to somebody else. What is left is the company, the seats and the cash — theirs,
          and not for sale. They are still in the season, and rebuilding.
        </Text>
      ) : yourOffer ? (
        <View style={{ gap: spacing.sm, paddingTop: spacing.xs, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
          <Text style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>
            Your offer: {exact(yourOffer.amount)}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
            {offerStatusRead(yourOffer.status, "made").line}
          </Text>
          {/* Only a pending offer can be revised or withdrawn; an agreed one is waiting on the tick. */}
          {isCeo && yourOffer.status === "pending" ? (
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Btn label="Revise it" icon="create-outline" variant="outline" small disabled={busy}
                onPress={onOpen} style={{ flex: 1 }} testID={`offers-revise-${target.id}`} />
              <Btn label="Withdraw" icon="close-circle-outline" variant="danger" small disabled={busy}
                onPress={onWithdraw} testID={`offers-withdraw-${target.id}`} />
            </View>
          ) : null}
        </View>
      ) : null}

      {!isCeo || target.hollow ? null : open ? (
        <View style={{ gap: spacing.sm, paddingTop: spacing.xs, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
          <OfferAmount targetId={target.id} value={draft} onChange={onDraft} disabled={busy} fair={target.fair} />

          <View style={{ gap: 4 }}>
            {lines.map((line) => (
              <Text key={line} style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
                {line}
              </Text>
            ))}
            {/* The sum that decides whether this purchase is a triumph or the
                year everybody found out what you are like: customers bought
                are customers who have to be served. */}
            {service.line ? (
              <View
                testID={`offers-capacity-${target.id}`}
                style={{
                  flexDirection: "row", alignItems: "flex-start", gap: 6, padding: spacing.sm,
                  borderRadius: radius.sm,
                  backgroundColor: service.over ? tintSoft(colors.danger, 0.1) : colors.surfaceRaised,
                }}
              >
                <Icon name={service.over ? "warning" : "checkmark-circle"} size={14}
                  color={service.over ? colors.danger : colors.success} />
                <Text style={{
                  flex: 1, color: service.over ? colors.danger : colors.textSecondary,
                  fontSize: font.xs, lineHeight: 17,
                  fontFamily: service.over ? fontFamily.medium : fontFamily.regular,
                }}>
                  {service.line}
                </Text>
              </View>
            ) : null}
          </View>

          {/* The message is the negotiation. An offer with a reason attached
              gets answered; a bare number gets ignored, and the target has a
              day and four other things to think about. */}
          <TextInput
            testID={`offers-message-${target.id}`}
            value={message}
            onChangeText={onMessage}
            editable={!busy}
            multiline
            maxLength={280}
            placeholder="Say why, if you like. They read this before answering."
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="A message with your offer"
            style={{
              minHeight: 64, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border,
              borderRadius: radius.sm, padding: spacing.md, color: colors.text, fontSize: font.sm,
              fontFamily: fontFamily.regular, textAlignVertical: "top",
            }}
          />

          {check.error ? (
            <Text testID={`offers-error-${target.id}`} style={{ color: colors.danger, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.medium }}>
              {check.error}
            </Text>
          ) : null}
          {check.warning ? (
            <Text testID={`offers-warning-${target.id}`} style={{ color: colors.warning, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.medium }}>
              {check.warning}
            </Text>
          ) : null}

          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Btn
              label={yourOffer ? "Send the revised offer" : "Make the offer"}
              icon="paper-plane-outline"
              small
              loading={busy}
              disabled={!check.ok || busy}
              onPress={onSend}
              style={{ flex: 1 }}
              testID={`offers-send-${target.id}`}
            />
            <Btn label="Cancel" variant="ghost" small disabled={busy} onPress={onClose} testID={`offers-close-${target.id}`} />
          </View>
          <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
            Their chief executive decides, and only theirs. An offer nobody answers lapses when the year resolves.
          </Text>
        </View>
      ) : yourOffer ? null : (
        <Btn label="Offer to buy them" icon="cash-outline" variant="outline" small onPress={onOpen}
          testID={`offers-open-${target.id}`} />
      )}
    </View>
  );
}

/**
 * The amount, on steppers anchored to the asking price.
 *
 * It opens on the valuation rather than on zero — the same bargain the
 * market's bid input makes with the reserve — because the published figure is
 * the only sensible place to start arguing from, and a hundred thousand a tap
 * is a stride rather than a shuffle at these prices.
 */
export function OfferAmount({ targetId, value, onChange, disabled, fair }: {
  targetId: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  fair: number;
}) {
  const numeric = Number(value);
  const step = 100_000;
  const move = (direction: 1 | -1) => {
    const current = Number.isFinite(numeric) ? numeric : 0;
    const snapped = direction > 0
      ? Math.floor(current / step + 1e-9) * step + step
      : Math.ceil(current / step - 1e-9) * step - step;
    onChange(String(Math.max(0, snapped)));
  };

  const ratio = fair > 0 && Number.isFinite(numeric) ? numeric / fair : null;

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>
          What it's worth to you
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>
          {money(Number.isFinite(numeric) ? numeric : 0)}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <StepSquare icon="remove" label="Lower the offer" disabled={disabled} onPress={() => move(-1)} testID={`offers-down-${targetId}`} />
        <MoneyInput value={value} onChange={onChange} disabled={disabled} testID={`offers-field-${targetId}`} label="Your offer" />
        <StepSquare icon="add" label="Raise the offer" disabled={disabled} onPress={() => move(1)} testID={`offers-up-${targetId}`} />
      </View>
      {ratio != null ? (
        <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
          {ratioRead(ratio)} They see that reading too.
        </Text>
      ) : null}
    </View>
  );
}

/** One offer you have made, once it is no longer live on a target's card. */
export function MadeOfferRow({ offer }: { offer: MadeOffer }) {
  const status = offerStatusRead(offer.status, "made");
  return (
    <View
      testID={`offers-made-${offer.id}`}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: 7 }}
    >
      <Icon
        name={offer.status === "accepted" ? "checkmark-circle" : offer.status === "declined" ? "close-circle-outline" : "time-outline"}
        size={16}
        color={status.color}
      />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>
          {exact(offer.amount)} for {offer.to}
        </Text>
        <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
          {status.line}
        </Text>
      </View>
    </View>
  );
}

/** A row that says what a seat can and cannot do here — said once, at the top. */
export function SeatNote({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, paddingHorizontal: 2 }}>
      <Icon name="information-circle-outline" size={14} color={colors.textTertiary} />
      <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
        {children}
      </Text>
    </View>
  );
}

/** A tappable section header, kept here so the two halves of the screen match. */
export function HalfHeader({ icon, title, count, color }: {
  icon: React.ComponentProps<typeof Icon>["name"];
  title: string;
  count?: number;
  color: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2 }}>
      <Icon name={icon} size={16} color={color} />
      <Text style={{ flex: 1, color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{title}</Text>
      {count !== undefined && count > 0 ? <Pill label={String(count)} color={color} solid /> : null}
    </View>
  );
}
