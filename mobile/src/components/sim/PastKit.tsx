/**
 * Last year's record, drawn for a phone.
 *
 * Two cards, the same two the web's Past tab has. The first is the record —
 * who decided what, and what was bid and who took it. The second is the map,
 * except it is a list: the web plots price against quality and that is the
 * right drawing for a mouse, while the same argument on a phone reads better
 * sorted by what everyone charges.
 *
 * Both are deliberately blunt. A report that flatters the reader is a report
 * nobody learns from, and the numbers are the team's own.
 *
 * The arithmetic is all in `past.ts`, which has no React Native in it so the
 * mirror test can check it against the web. Keep it that way: this file draws.
 */
import { Text, View } from "react-native";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Card, Icon } from "../ui";
import { Pill, tintSoft } from "../MoreKit";
import { SimSectionTitle } from "./SimKit";
import { exact, money } from "./desk";
import {
  creditPlace, lotLabel, lotOutcome, marketRows, readDecision,
  type AuctionRow, type Standing,
} from "./past";

export interface PastSeat {
  userId: string;
  name: string;
  role: string | null;
  title: string | null;
  isYou: boolean;
}

/**
 * Card one: what the five of you actually did.
 *
 * Every lever as it was filed, not a curated subset — the point of the card is
 * that nothing quietly goes unrecorded, including a seat that filed nothing at
 * all, which is the most useful thing on it.
 */
export function WhatTheTableDecided({ year, seats, filed }: {
  year: number;
  seats: PastSeat[];
  filed: Record<string, Record<string, unknown>> | null | undefined;
}) {
  const chairs = seats.filter((s) => s.role);
  return (
    <Card testID="past-what-we-decided">
      <SimSectionTitle icon="hammer-outline" title={`What the table decided in year ${year}`} />
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular, marginTop: 2 }}>
        Every lever, as it was filed. The year you are about to decide is judged against this one.
      </Text>

      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        {chairs.length === 0 ? (
          <Text style={{ color: colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.regular }}>
            Nobody was sitting at this table last year.
          </Text>
        ) : chairs.map((seat) => {
          const lines = readDecision(filed?.[seat.role as string], money);
          return (
            <View
              key={seat.userId}
              testID={`past-decided-${seat.role}`}
              style={{
                gap: 6, padding: spacing.md, borderRadius: radius.sm,
                borderWidth: 1, borderColor: colors.border,
                backgroundColor: seat.isYou ? tintSoft(colors.primary, 0.06) : "transparent",
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" }}>
                <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{seat.name}</Text>
                {seat.isYou ? <Pill label="You" color={colors.primary} /> : null}
                <View style={{ flex: 1 }} />
                <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>
                  {seat.title ?? seat.role?.toUpperCase()}
                </Text>
              </View>

              {lines.length === 0 ? (
                /*
                 * Named rather than left blank. A seat that filed nothing had its
                 * levers run by the caretaker on last year's numbers, and a table
                 * reading this card is usually trying to work out why a year went
                 * the way it did.
                 */
                <Text
                  testID={`past-filed-nothing-${seat.role}`}
                  style={{ color: colors.danger, fontSize: font.xs, fontFamily: fontFamily.medium }}
                >
                  Filed nothing. The caretaker ran the seat.
                </Text>
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
                  {lines.map((line) => (
                    <Text
                      key={line.label}
                      style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.regular }}
                    >
                      {line.label}{" "}
                      <Text style={{ color: colors.text, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>
                        {line.value}
                      </Text>
                    </Text>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

/**
 * The auction, which used to leave no trace at all on a phone.
 *
 * Bids are deleted the moment they settle, so this report is the only record
 * that a lot was ever contested — and sealed bidding means it is the only place
 * a team ever learns what it was up against. Rows rather than a table: five
 * columns do not fit a phone, so each lot gets two lines and the outcome gets
 * said in words.
 */
export function AtAuction({ auctions, yourCompanyId }: {
  auctions: AuctionRow[];
  yourCompanyId: string | null;
}) {
  if (auctions.length === 0) return null;
  const toneOf = (outcome: string) =>
    outcome === "won" ? colors.success : outcome === "outbid" ? colors.danger : colors.textTertiary;

  return (
    <Card testID="past-auctions">
      <SimSectionTitle icon="pricetags-outline" title="At auction" />
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular, marginTop: 2 }}>
        Sealed bids are deleted once they settle. This is the only record of them.
      </Text>

      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        {auctions.map((row) => {
          const outcome = lotOutcome(row, yourCompanyId);
          return (
            <View
              key={row.listingId}
              testID={`past-auction-${row.listingId}`}
              style={{ gap: 4, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" }}>
                <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>
                  {row.name}
                  <Text style={{ color: colors.textTertiary, fontFamily: fontFamily.regular }}>
                    {" · "}{row.kind.replace(/_/g, " ")}
                  </Text>
                </Text>
                <Pill label={lotLabel(outcome)} color={toneOf(outcome)} />
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.regular, fontVariant: ["tabular-nums"] }}>
                Reserve {money(row.reserve)}
                {" · "}
                {Number(row.yourBid) > 0 ? `you bid ${money(Number(row.yourBid))}` : "you did not bid"}
                {" · "}
                {row.bidders === 1 ? "1 bidder" : `${row.bidders} bidders`}
                {row.winner ? ` · taken by ${row.winner} for ${money(row.price ?? 0)}` : " · unsold"}
              </Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

/**
 * Where everybody sits, as a list.
 *
 * Sorted by price, because that is the axis a table argues about, with each
 * company's three scores beside it and a credit grade for the teams. The scores
 * are the whole reason to look: "they charge less than us" is a different
 * conversation from "they charge less than us and their product is better".
 */
export function WhereTheMarketSits({ standing, voice }: {
  standing: Standing[];
  voice?: Record<string, string> | undefined;
}) {
  const rows = marketRows(standing);
  if (rows.length === 0) return null;
  const credit = creditPlace(standing);
  const head = voice?.customers ?? "customers";

  return (
    <Card testID="past-market-sits">
      <SimSectionTitle icon="map-outline" title="Where the market sits" />
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular, marginTop: 2 }}>
        What everyone charges, and what they are worth charging it for.
      </Text>

      {credit ? (
        <View style={{ marginTop: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" }}>
          <Icon name="card-outline" size={14} color={colors.textSecondary} />
          <Text
            testID="past-credit-place"
            style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.regular }}
          >
            Your credit is{" "}
            <Text style={{ color: colors.text, fontFamily: fontFamily.semibold }}>{credit.grade}</Text>
            {" — "}
            {credit.place} of {credit.of} {credit.of === 1 ? "team" : "teams"}, which is what sets what you can borrow.
          </Text>
        </View>
      ) : null}

      <View style={{ gap: 0, marginTop: spacing.md }}>
        {rows.map((row) => (
          <View
            key={row.id}
            testID={`past-market-row-${row.id}`}
            style={{
              gap: 4, paddingVertical: spacing.sm,
              borderTopWidth: 1, borderTopColor: colors.border,
              paddingHorizontal: row.isYou ? spacing.sm : 0,
              borderRadius: row.isYou ? radius.sm : 0,
              backgroundColor: row.isYou ? tintSoft(colors.primary, 0.06) : "transparent",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" }}>
              <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{row.name}</Text>
              {row.isYou ? <Pill label="You" color={colors.primary} /> : null}
              {row.kind === "incumbent" ? <Pill label="Incumbent" color={colors.textTertiary} /> : null}
              {row.grade ? <Pill label={row.grade} color={colors.info} /> : null}
              <View style={{ flex: 1 }} />
              <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
                {money(row.price)}
              </Text>
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.regular, fontVariant: ["tabular-nums"] }}>
              quality {row.quality} · service {row.service} · brand {row.brand} · {exact(row.customers)} {head}
              {row.positioning ? ` · for ${row.positioning}` : ""}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}
